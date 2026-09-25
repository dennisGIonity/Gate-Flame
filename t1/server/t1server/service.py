"""Everything the REST API, the dashboard and the MCP tools do, in one place, so the
three surfaces can never disagree with each other."""
from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Callable

import numpy as np

from . import bloom, lists, signing
from .config import COMMANDS, FETCH_TIMEOUT, FP_RATE, KEEP_FILTERS, LEVELS, ONLINE_S, STALE_S, data_path
from .store import Store

# The device reports protectionStatus with the SAME five values as the T3 box, and the
# dashboard maps them the same way. Raw tokens are never shown to a customer.
STATUS_LABEL = {"active": "PROTECTED", "paused": "PAUSED", "bypass": "UNPROTECTED",
                "degraded": "DEGRADED", "applying": "APPLYING"}


class Service:
    def __init__(self, store: Store, fetch: Callable[[str], str] | None = None):
        self.s = store
        self.fetch = fetch or _http_fetch
        self.build_state = {"running": False, "started": None, "finished": None, "log": [], "error": None}
        self._build_lock = threading.Lock()
        self._keys: dict[str, tuple[int, np.ndarray, bloom.Filter]] = {}

    # ── filters ─────────────────────────────────────────────────────────────
    def current_filter(self, level: str) -> dict | None:
        r = self.s.q("SELECT * FROM filters WHERE level=? ORDER BY version DESC LIMIT 1", (level,))
        return r[0] if r else None

    def filter_status(self) -> dict:
        out = {}
        for lv in LEVELS:
            f = self.current_filter(lv)
            out[lv] = None if not f else {
                "version": f["version"], "domains": f["n"], "bytes": f["size"], "k": f["k"],
                "fp_rate": f["fp"], "built": f["built"], "sources": json.loads(f["sources"]),
                "description": lists.describe(lv)}
            if out[lv] is None:
                out[lv] = {"version": 0, "description": lists.describe(lv)}
        return {"levels": out, "build": self.build_state, "allow": self.allow_meta()}

    def build_filters(self, background: bool = True) -> dict:
        if not self._build_lock.acquire(blocking=False):
            return {"started": False, "reason": "a build is already running"}
        self.build_state = {"running": True, "started": time.time(), "finished": None, "log": [], "error": None}
        if background:
            threading.Thread(target=self._build, daemon=True).start()
        else:
            self._build()
        return {"started": True}

    def _log(self, msg: str) -> None:
        self.build_state["log"].append(f"{time.strftime('%H:%M:%S')} {msg}")

    def _build(self) -> None:
        try:
            parsed: dict[str, set[str]] = {}
            report: dict[str, dict] = {}
            for url in lists.all_sources():
                cache = data_path("cache", hashlib.sha1(url.encode()).hexdigest() + ".txt")
                origin = "live"
                try:
                    text = self.fetch(url)
                    cache.write_text(text, encoding="utf-8")
                except Exception as e:  # noqa: BLE001 - any fetch failure falls back to cache
                    if cache.exists():
                        text, origin = cache.read_text(encoding="utf-8"), f"cache ({type(e).__name__})"
                    else:
                        report[url] = {"domains": 0, "origin": f"FAILED: {type(e).__name__}: {e}"[:200]}
                        self._log(f"FAILED {url}")
                        continue
                parsed[url] = lists.parse(text)
                report[url] = {"domains": len(parsed[url]), "origin": origin}
                self._log(f"{len(parsed[url]):>9,} {origin:<6} {url}")
            if not parsed:
                raise RuntimeError("no source could be read, live or cached - nothing to build")
            version = int(time.time())
            for lv in LEVELS:
                urls = lists.sources(lv)
                doms: set[str] = set()
                for u in urls:
                    doms |= parsed.get(u, set())
                bf = bloom.build(doms, lv, version, FP_RATE)
                path = data_path("filters", f"{lv}-{version}.bin")
                path.write_bytes(bf.blob)
                np.save(str(path.with_suffix(".keys.npy")), bf.keys)
                sig = signing.sign(bf.blob)
                self.s.x("INSERT OR REPLACE INTO filters VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                         (lv, version, str(path), len(bf.blob), hashlib.sha256(bf.blob).hexdigest(), sig,
                          bf.n, bf.m, bf.k, bf.fp_rate, time.time(),
                          json.dumps({u: report.get(u) for u in urls})))
                self._log(f"{lv}: {bf.n:,} domains, {len(bf.blob)/1e6:.2f} MB, k={bf.k}, fp={bf.fp_rate:.4%}")
                self._prune_filters(lv)
            self.s.event("filter_built", f"version {version}")
        except Exception as e:  # noqa: BLE001
            self.build_state["error"] = f"{type(e).__name__}: {e}"
            self._log(f"ERROR {self.build_state['error']}")
            self.s.event("filter_build_failed", self.build_state["error"])
        finally:
            self.build_state["running"] = False
            self.build_state["finished"] = time.time()
            self._keys.clear()
            self._build_lock.release()

    def _prune_filters(self, level: str) -> None:
        old = self.s.q("SELECT version, path FROM filters WHERE level=? ORDER BY version DESC", (level,))[KEEP_FILTERS:]
        for r in old:
            for p in (Path(r["path"]), Path(r["path"]).with_suffix(".keys.npy")):
                p.unlink(missing_ok=True)
            self.s.x("DELETE FROM filters WHERE level=? AND version=?", (level, r["version"]))

    def filter_file(self, level: str, version: int) -> Path | None:
        r = self.s.q("SELECT path FROM filters WHERE level=? AND version=?", (level, version))
        return Path(r[0]["path"]) if r and Path(r[0]["path"]).exists() else None

    def check_domain(self, domain: str, level: str = "low") -> dict:
        """What would a T1 box on `level` do with this name - and WHY."""
        norm = bloom.normalise(domain)
        if not norm:
            return {"domain": domain, "verdict": "invalid"}
        f = self.current_filter(level)
        if not f:
            return {"domain": norm, "level": level, "verdict": "no filter built for this level"}
        cached = self._keys.get(level)
        if not cached or cached[0] != f["version"]:
            keys = np.load(str(Path(f["path"]).with_suffix(".keys.npy")))
            cached = (f["version"], keys, bloom.Filter(Path(f["path"]).read_bytes()))
            self._keys[level] = cached
        _, keys, flt = cached
        h1, _ = bloom.domain_hash(norm)
        listed = bool(keys.size) and bool(keys[min(np.searchsorted(keys, np.uint64(h1)), keys.size - 1)] == h1)
        in_filter = flt.contains(norm)
        allowed = bool(self.s.q("SELECT 1 FROM allowlist WHERE domain=?", (norm,)))
        if allowed:
            verdict = "allowed (on the allow-list)"
        elif in_filter and listed:
            verdict = "blocked (on a blocklist)"
        elif in_filter:
            verdict = "blocked (false positive - add it to the allow-list)"
        else:
            verdict = "allowed"
        return {"domain": norm, "level": level, "filter_version": f["version"], "in_filter": in_filter,
                "on_blocklist": listed, "on_allowlist": allowed, "verdict": verdict}

    # ── allow-list ──────────────────────────────────────────────────────────
    def allow_list(self) -> list[dict]:
        return self.s.q("SELECT domain, added, note FROM allowlist ORDER BY domain")

    def allow_add(self, domain: str, note: str = "") -> dict:
        d = bloom.normalise(domain)
        if not d:
            raise ValueError("not a domain")
        self.s.x("INSERT OR REPLACE INTO allowlist VALUES (?,?,?)", (d, time.time(), note[:200]))
        self._write_allow()
        self.s.event("allow_add", d)
        return {"domain": d, "allow": self.allow_meta()}

    def allow_remove(self, domain: str) -> dict:
        d = bloom.normalise(domain) or domain
        self.s.x("DELETE FROM allowlist WHERE domain=?", (d,))
        self._write_allow()
        self.s.event("allow_remove", d)
        return {"domain": d, "allow": self.allow_meta()}

    def _write_allow(self) -> None:
        body = "".join(r["domain"] + "\n" for r in self.allow_list()).encode()
        meta = {"version": int(time.time()), "size": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                "sig": signing.sign(body), "count": body.count(b"\n")}
        data_path("allow.txt").write_bytes(body)
        self.s.kv_set("allow", meta)

    def allow_meta(self) -> dict:
        m = self.s.kv_get("allow")
        if m is None:
            self._write_allow()
            m = self.s.kv_get("allow")
        return m

    # ── device side ─────────────────────────────────────────────────────────
    def manifest_text(self, level: str) -> str:
        level = level if level in LEVELS else "low"
        f = self.current_filter(level)
        a = self.allow_meta()
        lines = [f"level={level}"]
        if f:
            lines += [f"filter_version={f['version']}", f"filter_url=/api/t1/v1/filter/{level}/{f['version']}.bin",
                      f"filter_size={f['size']}", f"filter_sha256={f['sha256']}", f"filter_sig={f['sig']}"]
        else:
            lines.append("filter_version=0")
        lines += [f"allow_version={a['version']}", "allow_url=/api/t1/v1/allow.txt", f"allow_size={a['size']}",
                  f"allow_sha256={a['sha256']}", f"allow_sig={a['sig']}"]
        return "\n".join(lines) + "\n"

    def ingest(self, t: dict, ip: str) -> str:
        """Store one telemetry report; return pending commands as text lines."""
        did = str(t.get("id", ""))[:64]
        if not did:
            raise ValueError("id required")
        now = time.time()
        prev = self.s.q("SELECT * FROM devices WHERE id=?", (did,))
        status = str(t.get("status", "?"))[:16]
        boot = str(t.get("boot", ""))[:32]
        if not prev:
            self.s.x("INSERT INTO devices (id, label, first_seen) VALUES (?,?,?)", (did, did, now))
            self.s.event("device_new", f"first report from {ip}", did)
        else:
            p = prev[0]
            if p["boot"] and p["boot"] != boot:
                self.s.event("device_reboot", f"uptime was {json.loads(p['last'] or '{}').get('uptime', '?')} s", did)
            if p["status"] and p["status"] != status:
                self.s.event("status", f"{p['status']} -> {status}" + (f" ({t.get('err')})" if t.get("err") else ""), did)
        self.s.x("UPDATE devices SET last_seen=?, ip=?, fw=?, level=?, status=?, boot=?, filter_version=?, "
                 "allow_version=?, last=? WHERE id=?",
                 (now, t.get("ip") or ip, str(t.get("fw", ""))[:16], str(t.get("level", ""))[:8], status, boot,
                  int(t.get("filter_version") or 0), int(t.get("allow_version") or 0), json.dumps(t)[:4000], did))
        self.s.x("INSERT INTO telemetry VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (now, did, boot, int(t.get("q", 0)), int(t.get("blk", 0)), int(t.get("fwd", 0)),
                  int(t.get("to", 0)), int(t.get("rssi", 0)), int(t.get("heap_free", 0)), status))
        if t.get("last_cmd_id"):
            cid = int(t["last_cmd_id"])
            r = self.s.q("SELECT result_ts FROM commands WHERE id=? AND device_id=?", (cid, did))
            if r and r[0]["result_ts"] is None:
                self.s.x("UPDATE commands SET result_ok=?, result=?, result_ts=? WHERE id=?",
                         (1 if t.get("last_cmd_ok") else 0, str(t.get("last_cmd_msg", ""))[:200], now, cid))
                self.s.event("command_result", f"#{cid} {'ok' if t.get('last_cmd_ok') else 'FAILED'}: "
                             f"{t.get('last_cmd_msg', '')}", did)
        pend = self.s.q("SELECT id, cmd, arg FROM commands WHERE device_id=? AND delivered IS NULL ORDER BY id LIMIT 4", (did,))
        for c in pend:
            self.s.x("UPDATE commands SET delivered=? WHERE id=?", (now, c["id"]))
        return "ok\n" + "".join(f"cmd {c['id']} {c['cmd']} {c['arg'] or '-'}\n" for c in pend)

    # ── fleet side ──────────────────────────────────────────────────────────
    @staticmethod
    def health(last_seen: float | None) -> str:
        if not last_seen:
            return "offline"
        age = time.time() - last_seen
        return "online" if age < ONLINE_S else "stale" if age < STALE_S else "offline"

    def _device_view(self, d: dict) -> dict:
        last = json.loads(d.get("last") or "{}")
        tel = self.s.q("SELECT * FROM telemetry WHERE device_id=? ORDER BY ts DESC LIMIT 2", (d["id"],))
        qps = bps = None
        if len(tel) == 2 and tel[0]["boot"] == tel[1]["boot"] and tel[0]["ts"] > tel[1]["ts"]:
            dt = tel[0]["ts"] - tel[1]["ts"]
            qps = round((tel[0]["q"] - tel[1]["q"]) / dt, 2)
            bps = round((tel[0]["blk"] - tel[1]["blk"]) / dt, 2)
        cur = self.current_filter(d.get("level") or "low")
        q, blk = int(last.get("q", 0)), int(last.get("blk", 0))
        return {
            "id": d["id"], "label": d["label"], "health": self.health(d["last_seen"]),
            "last_seen": d["last_seen"], "first_seen": d["first_seen"], "ip": d["ip"], "fw": d["fw"],
            "level": d["level"], "status": d["status"], "status_label": STATUS_LABEL.get(d["status"] or "", "UNKNOWN"),
            "err": last.get("err") or None, "filter_version": d["filter_version"],
            "filter_current": bool(cur) and cur["version"] == d["filter_version"],
            "allow_version": d["allow_version"], "uptime": last.get("uptime"), "rssi": last.get("rssi"),
            "heap_free": last.get("heap_free"), "psram_total": last.get("psram_total"),
            "psram_free": last.get("psram_free"), "upstream": last.get("upstream"),
            "paused_left": last.get("paused_left"),
            "queries": q, "blocked": blk, "forwarded": int(last.get("fwd", 0)),
            "timeouts": int(last.get("to", 0)), "blocked_pct": round(100 * blk / q, 1) if q else None,
            "qps": qps, "blocked_per_s": bps}

    def devices(self) -> list[dict]:
        return [self._device_view(d) for d in self.s.q("SELECT * FROM devices ORDER BY id")]

    def device(self, did: str, hours: float = 24) -> dict | None:
        r = self.s.q("SELECT * FROM devices WHERE id=?", (did,))
        if not r:
            return None
        v = self._device_view(r[0])
        v["series"] = self.s.q("SELECT ts, boot, q, blk, fwd, tmo, rssi, status FROM telemetry "
                               "WHERE device_id=? AND ts>? ORDER BY ts", (did, time.time() - hours * 3600))
        v["commands"] = self.s.q("SELECT * FROM commands WHERE device_id=? ORDER BY id DESC LIMIT 20", (did,))
        v["events"] = self.s.q("SELECT * FROM events WHERE device_id=? ORDER BY ts DESC LIMIT 30", (did,))
        return v

    def set_label(self, did: str, label: str) -> None:
        self.s.x("UPDATE devices SET label=? WHERE id=?", (label[:48], did))

    def send_command(self, did: str, cmd: str, arg: str = "") -> dict:
        if cmd not in COMMANDS:
            raise ValueError(f"unknown command {cmd!r}; allowed: {', '.join(COMMANDS)}")
        arg = (arg or "").strip()
        if cmd == "pause":
            mins = int(arg or "30")
            if not 1 <= mins <= 1440:
                raise ValueError("pause minutes must be 1..1440")
            arg = str(mins)
        elif cmd == "set_level":
            if arg not in LEVELS:
                raise ValueError(f"level must be one of {LEVELS}")
        elif cmd == "set_upstream":
            parts = [p for p in arg.replace(" ", ",").split(",") if p]
            if not 1 <= len(parts) <= 2 or not all(_is_ipv4(p) for p in parts):
                raise ValueError("set_upstream takes one or two IPv4 addresses, e.g. 9.9.9.9,149.112.112.112")
            arg = ",".join(parts)
        else:
            arg = ""
        targets = [d["id"] for d in self.s.q("SELECT id FROM devices")] if did == "*" else [did]
        if did != "*" and not self.s.q("SELECT 1 FROM devices WHERE id=?", (did,)):
            raise KeyError(did)
        ids = [self.s.x("INSERT INTO commands (device_id, cmd, arg, created) VALUES (?,?,?,?)",
                        (t, cmd, arg, time.time())) for t in targets]
        for t in targets:
            self.s.event("command_queued", f"{cmd} {arg}".strip(), t)
        return {"queued": ids, "delivers_within_s": 30}

    def events(self, limit: int = 100) -> list[dict]:
        return self.s.q("SELECT * FROM events ORDER BY ts DESC LIMIT ?", (limit,))

    def fleet_summary(self) -> dict:
        devs = self.devices()
        by = {h: sum(1 for d in devs if d["health"] == h) for h in ("online", "stale", "offline")}
        st = {}
        for d in devs:
            st[d["status_label"]] = st.get(d["status_label"], 0) + 1
        return {"devices": len(devs), "health": by, "protection": st,
                "queries": sum(d["queries"] for d in devs), "blocked": sum(d["blocked"] for d in devs),
                "out_of_date": [d["id"] for d in devs if not d["filter_current"]],
                "filters": {lv: (self.current_filter(lv) or {}).get("version", 0) for lv in LEVELS}}


def _is_ipv4(s: str) -> bool:
    p = s.split(".")
    return len(p) == 4 and all(x.isdigit() and 0 <= int(x) <= 255 for x in p)


def _http_fetch(url: str) -> str:
    import httpx
    r = httpx.get(url, timeout=FETCH_TIMEOUT, follow_redirects=True,
                  headers={"User-Agent": "GateFlame-T1-builder/0.1 (+https://www.ionity.today)"})
    r.raise_for_status()
    return r.text
