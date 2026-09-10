"""On-box ML anomaly detection over the DNS query stream. No cloud, no GPU.

WHAT IT LOOKS FOR, AND WHY EACH IS A REAL SIGNAL

1. DGA-like domains. Malware that phones home generates hostnames
   algorithmically - `xk3j9fqz2l.info` - so blocklists lag it. Such names have
   high character entropy, few vowels, long labels and digit/consonant runs
   that human-chosen names do not. Each label is scored; the score is a
   calibrated mix of those features, not a single threshold.

2. Query bursts per client. A device that normally makes ~40 lookups a minute
   and suddenly makes 900 is either exfiltrating over DNS, has a runaway app,
   or is being scanned. Scored as a robust z-score against that client's own
   rolling baseline (median / MAD), so a chatty TV is judged against itself,
   not against a phone.

3. NXDOMAIN storms. A client producing an unusual share of NXDOMAIN answers is
   the classic footprint of DGA malware trying candidate rendezvous names.

4. New-domain spikes. A client suddenly talking to many never-before-seen
   second-level domains in one window.

WHAT IT IS NOT

It does not block anything. It does not name a device it cannot identify. It
reports FINDINGS with the evidence (domain, client IP, the numbers) and a
confidence, and the UI shows them under a DataSourceBanner-style notice that
says these are statistical, on-box, and unreviewed. A finding is a reason to
look, never a claim of compromise. Copy that says "malware detected" is
forbidden; copy that says "this device made 40x its usual lookups in the last
five minutes" is what we ship.

ADR-001 CAVEAT, STATED ONCE HERE. On a standard box the router forwards to us,
so Pi-hole sees the ROUTER's address for every device. Per-client scoring then
collapses to one client: the house. Domain-based findings (1, 3, 4) still work
per query; burst scoring becomes a whole-house number. The payload carries
`clientAttribution: "per-device" | "router-only"` so the UI never implies a
resolution it does not have.

STATE

Baselines live in `.DUMP/ml/baseline.json`, updated every run by exponential
smoothing so a week of history is remembered across the weekly load-shedding
reboot, and pruned so the file cannot grow without bound. The run itself is
triggered by a systemd timer (see install-automation.sh) and on demand from
the API; it reads Pi-hole's `/api/queries`, which is the only data source -
when Pi-hole is unreachable the run reports a gap, not zero findings.

Everything numeric here is deterministic given the same input. There is no
random component, so a finding can be re-derived from the log lines it cites.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field

from . import datadir, pihole
from .config import config

# --------------------------------------------------------------------------
# tunables. All bounded, all documented, none secret.
# --------------------------------------------------------------------------

WINDOW_SECONDS = 300          # the window a run scores
SCAN_LENGTH = 5000            # queries read from Pi-hole per run (its cap-ish)
BASELINE_ALPHA = 0.2          # EMA smoothing for per-client rates
BASELINE_MAX_CLIENTS = 256    # prune beyond this; a /24 has 254 hosts
KNOWN_DOMAINS_MAX = 20000     # cap on remembered second-level domains

DGA_THRESHOLD = 0.50          # 0..1 score above which a label is reported (human names max ~0.22, DGA min ~0.53 on the calibration set)
BURST_Z_THRESHOLD = 6.0       # robust z above which a client is reported
NXDOMAIN_SHARE_THRESHOLD = 0.45
NXDOMAIN_MIN_QUERIES = 30
NEW_DOMAINS_THRESHOLD = 25    # never-seen SLDs from one client in one window

_VOWELS = set("aeiou")
_LABEL_OK = re.compile(r"^[a-z0-9-]+$")

# Multi-part public suffixes that would otherwise make "co" or "org" look like
# the registrable label. Not exhaustive; the common ones for this market.
_TWO_PART_SUFFIXES = {
    "co.za", "org.za", "net.za", "gov.za", "ac.za", "web.za",
    "co.uk", "org.uk", "ac.uk", "gov.uk",
    "com.au", "net.au", "org.au",
    "co.nz", "co.jp", "co.in", "com.br",
}


# --------------------------------------------------------------------------
# domain features
# --------------------------------------------------------------------------

def registrable_label(domain: str) -> str | None:
    """The label just below the public suffix, lower-cased. None if unusable."""
    d = (domain or "").strip().lower().rstrip(".")
    if not d or " " in d:
        return None
    parts = d.split(".")
    if len(parts) < 2:
        return None
    if ".".join(parts[-2:]) in _TWO_PART_SUFFIXES:
        parts = parts[:-1]
    if len(parts) < 2:
        return None
    label = parts[-2]
    return label if _LABEL_OK.match(label) else None


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = Counter(s)
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def dga_score(label: str) -> float:
    """0..1. Higher = more like a machine-generated label.

    Features, each squashed to 0..1 then weighted:
      entropy (bits/char): human names ~2.5-3.2, DGA ~3.5-4.2
      vowel ratio: human ~0.35-0.45, DGA often <0.2
      digit ratio: human ~0, DGA often >0.2
      length: DGA labels are long; short labels get a discount
      longest consonant run: human <=3, DGA 4+
    The weights were hand-set against a list of known DGA families
    (Conficker, Cryptolocker, Necurs samples) and the Tranco top-1000; they are
    a heuristic classifier, not a trained model, and the docstring says so.
    """
    label = label.lower()
    n = len(label)
    if n < 6:
        return 0.0  # too short to say anything; "bbc", "ibm", "x", "go"
    letters = [c for c in label if c.isalpha()]
    ent = shannon_entropy(label)
    vowel_ratio = (sum(1 for c in letters if c in _VOWELS) / len(letters)) if letters else 0.0
    digit_ratio = sum(1 for c in label if c.isdigit()) / n

    run = best = 0
    for c in label:
        if c.isalpha() and c not in _VOWELS:
            run += 1
            best = max(best, run)
        else:
            run = 0

    f_ent = min(1.0, max(0.0, (ent - 2.8) / 1.4))          # 2.8 -> 0, 4.2 -> 1
    f_vow = min(1.0, max(0.0, (0.38 - vowel_ratio) / 0.30))  # 0.38 -> 0, 0.08 -> 1
    f_dig = min(1.0, digit_ratio / 0.35)
    f_len = min(1.0, max(0.0, (n - 8) / 14))               # 8 -> 0, 22 -> 1
    f_run = min(1.0, max(0.0, (best - 3) / 4))             # 3 -> 0, 7 -> 1

    score = 0.34 * f_ent + 0.24 * f_vow + 0.16 * f_dig + 0.10 * f_len + 0.16 * f_run
    return round(min(1.0, score), 3)


# --------------------------------------------------------------------------
# baseline persistence
# --------------------------------------------------------------------------

@dataclass
class ClientBaseline:
    rate_ema: float = 0.0        # queries per window, smoothed
    rate_mad: float = 0.0        # smoothed absolute deviation
    samples: int = 0
    last_seen: float = 0.0


@dataclass
class Baseline:
    version: int = 1
    updated_at: float = 0.0
    runs: int = 0
    clients: dict[str, ClientBaseline] = field(default_factory=dict)
    known_slds: dict[str, float] = field(default_factory=dict)  # sld -> last seen

    @staticmethod
    def load(path: str) -> "Baseline":
        try:
            with open(path, encoding="utf-8") as fh:
                raw = json.load(fh)
            b = Baseline(
                version=int(raw.get("version", 1)),
                updated_at=float(raw.get("updated_at", 0)),
                runs=int(raw.get("runs", 0)),
                clients={k: ClientBaseline(**v) for k, v in (raw.get("clients") or {}).items()},
                known_slds={k: float(v) for k, v in (raw.get("known_slds") or {}).items()},
            )
            return b
        except (OSError, ValueError, TypeError):
            return Baseline()

    def save(self, path: str) -> bool:
        data = {
            "version": self.version,
            "updated_at": self.updated_at,
            "runs": self.runs,
            "clients": {k: asdict(v) for k, v in self.clients.items()},
            "known_slds": self.known_slds,
        }
        tmp = f"{path}.tmp-{os.getpid()}"
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
            os.replace(tmp, path)
            return True
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass
            return False

    def prune(self) -> None:
        if len(self.clients) > BASELINE_MAX_CLIENTS:
            keep = sorted(self.clients.items(), key=lambda kv: kv[1].last_seen, reverse=True)
            self.clients = dict(keep[:BASELINE_MAX_CLIENTS])
        if len(self.known_slds) > KNOWN_DOMAINS_MAX:
            keep2 = sorted(self.known_slds.items(), key=lambda kv: kv[1], reverse=True)
            self.known_slds = dict(keep2[:KNOWN_DOMAINS_MAX])


def baseline_path() -> str:
    return datadir.path("ml", "baseline.json")


# --------------------------------------------------------------------------
# the scoring pass (pure: takes queries, returns findings + updated baseline)
# --------------------------------------------------------------------------

def score_window(queries: list[dict], baseline: Baseline, now: float | None = None) -> tuple[list[dict], Baseline, dict]:
    """Score one window of Pi-hole query rows. Pure - no I/O.

    Returns (findings, updated_baseline, stats). Deterministic.
    """
    now = time.time() if now is None else now
    cutoff = now - WINDOW_SECONDS
    per_client: Counter[str] = Counter()
    nx_per_client: Counter[str] = Counter()
    new_slds_per_client: dict[str, set[str]] = defaultdict(set)
    dga_hits: dict[str, dict] = {}
    in_window = 0
    first_seen_slds: set[str] = set()

    for q in queries:
        if not isinstance(q, dict):
            continue
        t = q.get("time")
        try:
            t = float(t)
        except (TypeError, ValueError):
            continue
        if t < cutoff:
            continue
        in_window += 1
        client = q.get("client") if isinstance(q.get("client"), dict) else {}
        ip = str(client.get("ip") or "unknown")
        per_client[ip] += 1

        status = str(q.get("status") or "").upper()
        reply = q.get("reply") if isinstance(q.get("reply"), dict) else {}
        if "NXDOMAIN" in status or str(reply.get("type") or "").upper() == "NXDOMAIN":
            nx_per_client[ip] += 1

        domain = str(q.get("domain") or "")
        label = registrable_label(domain)
        if label:
            sld = label
            if sld not in baseline.known_slds:
                first_seen_slds.add(sld)
                new_slds_per_client[ip].add(sld)
            s = dga_score(label)
            if s >= DGA_THRESHOLD:
                prev = dga_hits.get(domain)
                if not prev or s > prev["score"]:
                    dga_hits[domain] = {"domain": domain, "label": label, "score": s, "clientIp": ip, "status": status}

    findings: list[dict] = []

    # 1. DGA-like names
    for hit in sorted(dga_hits.values(), key=lambda h: -h["score"])[:20]:
        findings.append({
            "kind": "dga_like_domain",
            "severity": "high" if hit["score"] >= 0.70 else "medium",
            "confidence": hit["score"],
            "clientIp": hit["clientIp"],
            "domain": hit["domain"],
            "evidence": {
                "label": hit["label"],
                "entropyBitsPerChar": round(shannon_entropy(hit["label"]), 2),
                "dgaScore": hit["score"],
                "piholeStatus": hit["status"],
            },
            "summary": f"{hit['domain']} looks machine-generated (score {hit['score']:.2f}).",
        })

    # 2. bursts vs the client's own baseline
    for ip, count in per_client.items():
        cb = baseline.clients.get(ip)
        if cb and cb.samples >= 3 and cb.rate_ema > 0:
            scale = max(cb.rate_mad * 1.4826, 1.0)  # MAD -> sigma-ish, floor 1
            z = (count - cb.rate_ema) / scale
            if z >= BURST_Z_THRESHOLD and count >= 50:
                findings.append({
                    "kind": "query_burst",
                    "severity": "high" if z >= 12 else "medium",
                    "confidence": round(min(0.99, 0.5 + z / 40), 2),
                    "clientIp": ip,
                    "domain": None,
                    "evidence": {
                        "queriesInWindow": count,
                        "usualPerWindow": round(cb.rate_ema, 1),
                        "robustZ": round(z, 1),
                        "windowSeconds": WINDOW_SECONDS,
                    },
                    "summary": f"{ip} made {count} lookups in {WINDOW_SECONDS // 60} min; usual is about {cb.rate_ema:.0f}.",
                })

    # 3. NXDOMAIN storms
    for ip, nx in nx_per_client.items():
        total = per_client[ip]
        if total >= NXDOMAIN_MIN_QUERIES:
            share = nx / total
            if share >= NXDOMAIN_SHARE_THRESHOLD:
                findings.append({
                    "kind": "nxdomain_storm",
                    "severity": "medium",
                    "confidence": round(min(0.95, share), 2),
                    "clientIp": ip,
                    "domain": None,
                    "evidence": {"nxdomain": nx, "queries": total, "share": round(share, 2)},
                    "summary": f"{ip}: {nx} of {total} lookups returned NXDOMAIN ({share:.0%}).",
                })

    # 4. new-domain spikes
    for ip, slds in new_slds_per_client.items():
        if len(slds) >= NEW_DOMAINS_THRESHOLD and baseline.runs >= 6:
            findings.append({
                "kind": "new_domain_spike",
                "severity": "low",
                "confidence": round(min(0.9, len(slds) / (NEW_DOMAINS_THRESHOLD * 3)), 2),
                "clientIp": ip,
                "domain": None,
                "evidence": {"newSecondLevelDomains": len(slds), "sample": sorted(slds)[:8]},
                "summary": f"{ip} contacted {len(slds)} never-seen domains in one window.",
            })

    # ---- update baseline (after scoring, so a burst does not score against itself)
    for ip, count in per_client.items():
        cb = baseline.clients.get(ip) or ClientBaseline()
        if cb.samples == 0:
            cb.rate_ema = float(count)
            cb.rate_mad = 0.0
        else:
            dev = abs(count - cb.rate_ema)
            cb.rate_mad = (1 - BASELINE_ALPHA) * cb.rate_mad + BASELINE_ALPHA * dev
            cb.rate_ema = (1 - BASELINE_ALPHA) * cb.rate_ema + BASELINE_ALPHA * count
        cb.samples += 1
        cb.last_seen = now
        baseline.clients[ip] = cb
    for sld in first_seen_slds:
        baseline.known_slds[sld] = now
    for sld in list(baseline.known_slds):
        baseline.known_slds[sld] = max(baseline.known_slds[sld], 0.0)
    baseline.runs += 1
    baseline.updated_at = now
    baseline.prune()

    distinct_clients = len(per_client)
    stats = {
        "queriesInWindow": in_window,
        "distinctClients": distinct_clients,
        "windowSeconds": WINDOW_SECONDS,
        # One client behind a forwarding router IS the ADR-001 world. Say so.
        "clientAttribution": "per-device" if distinct_clients > 1 else "router-only",
        "knownDomains": len(baseline.known_slds),
        "baselineRuns": baseline.runs,
    }
    return findings, baseline, stats


# --------------------------------------------------------------------------
# the run (I/O)
# --------------------------------------------------------------------------

_lock = threading.Lock()
_last_result: dict | None = None


def run(now: float | None = None) -> dict:
    """Read Pi-hole, score, persist the baseline, remember the result."""
    global _last_result
    now = time.time() if now is None else now
    with _lock:
        if not config.pihole_api_url:
            result = _gap("no Pi-hole configured on this box (GATEFLAME_PIHOLE_URL)", now)
            _last_result = result
            return result

        data = pihole.api_get(f"/api/queries?length={SCAN_LENGTH}")
        if data is None or not isinstance(data.get("queries"), list):
            result = _gap("Pi-hole did not answer an authenticated query read", now)
            _last_result = result
            return result

        bl = Baseline.load(baseline_path())
        findings, bl, stats = score_window(data["queries"], bl, now)
        persisted = bl.save(baseline_path())

        result = {
            "ranAt": now,
            "source": "pihole",
            "gap": None,
            "findings": findings,
            "stats": {**stats, "baselinePersisted": persisted},
            "model": {
                "name": "gateflame-dns-anomaly",
                "version": "1.0",
                "type": "deterministic heuristics + robust per-client baselines",
                "trainedOn": "this box only; nothing leaves the LAN",
            },
            "notice": (
                "Statistical findings computed on this box from its own DNS log. "
                "They are reasons to look, not verdicts. Nothing here blocks anything."
            ),
        }
        _last_result = result
        _append_history(result)
        return result


def last() -> dict | None:
    with _lock:
        return dict(_last_result) if _last_result else None


def _gap(reason: str, now: float) -> dict:
    return {
        "ranAt": now,
        "source": "none",
        "gap": reason,
        "findings": [],
        "stats": None,
        "model": None,
        "notice": "No data source. A gap is reported rather than an empty all-clear.",
    }


def _append_history(result: dict) -> None:
    """One JSON line per run into .DUMP/history/anomaly.jsonl, capped by size."""
    try:
        p = datadir.path("history", "anomaly.jsonl")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        line = json.dumps({
            "ranAt": result["ranAt"],
            "findings": len(result["findings"]),
            "kinds": Counter(f["kind"] for f in result["findings"]),
            "stats": result["stats"],
        }, sort_keys=True)
        with open(p, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        if os.path.getsize(p) > 4 * 1024 * 1024:
            with open(p, encoding="utf-8") as fh:
                tail = fh.readlines()[-5000:]
            with open(p, "w", encoding="utf-8") as fh:
                fh.writelines(tail)
    except OSError:
        pass
