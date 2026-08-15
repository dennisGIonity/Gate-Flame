"""module_wan_audit — monthly data budget accounting and WAN link quality.

────────────────────────────────────────────────────────────────────────────
WHY THIS FILE IS WRITTEN THE WAY IT IS
────────────────────────────────────────────────────────────────────────────
A customer on a capped or metered line trusts this module's number more than
their ISP's portal, because ours updates every minute. That trust is only
earned if the number is *measured*. Two things destroy it:

1. INTERFACE BYTE COUNTERS ARE NOT MONOTONIC. They restart at zero on reboot
   and on interface down/up, and on a 32-bit kernel they wrap at 2**32 bytes
   (4.29 GB — reached in under six minutes on a 100 Mbit link). A naive
   `now - last` therefore produces either a large negative delta or, if the
   sign is clamped away, a phantom multi-gigabyte spike that silently eats a
   month's budget. The whole of `classify_delta()` exists for this.

2. A GUESS LOOKS EXACTLY LIKE A MEASUREMENT ONCE IT IS RENDERED. So: no cap
   configured means `percentOfCap` is null with a reason, not a default cap.
   A probe that fails means latency is null with a reason, not the last good
   value. Bytes we could not attribute are reported as a named anomaly, not
   quietly folded into the total.

STRUCTURE. All decision-making is pure functions over injected values
(`classify_delta`, `summarise_latency`, `project_month_end`). The I/O is three
thin seams — a counter reader, a latency probe and a SQLite store — each
replaceable in a test, exactly as `firewall.py` injects its runner and its
LocalContext. Nothing here needs root, a Pi, or a network to be tested.

CAPABILITY. Which interface faces the WAN cannot be guessed: on this appliance
`eth0` may be LAN and `wlan0` WAN, or the WAN may be a USB modem. Guessing
would attribute LAN traffic to the customer's metered budget. So the interface
is configuration, and without it the module reports `degraded` with the exact
environment variable to set — it never picks an interface and hopes.

TIMEZONE. Month boundaries are the HOST'S LOCAL CIVIL MONTH, not UTC. The
number this module produces exists to be compared against an ISP invoice, and
ISPs reset a cap at local midnight on the 1st. A UTC month would disagree with
the invoice by up to 14 hours of traffic at each end of the month, which on
the last night of a capped month is precisely when the disagreement matters.
Consequence, accepted deliberately: if the operator changes the host timezone
mid-month the month key can shift; historical rows are never rewritten, and
each row also carries UTC epochs so the record stays unambiguous.
"""

from __future__ import annotations

import logging
import os
import socket
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("gateflame.wan")

# 2**32 is the only wrap that happens in practice: a 32-bit `unsigned long`
# rx_bytes on a 32-bit kernel. A 64-bit counter would need ~4,700 years at
# 1 Gbit/s to wrap, so "the counter wrapped" is never a valid explanation for
# a 64-bit value going backwards — that is always a restart.
COUNTER_32BIT_MODULUS = 2**32

# The physical ceiling of the NIC on this appliance (1 Gbit/s ≈ 125 MB/s).
# This is a hardware limit used to reject impossible deltas, NOT a guess about
# the customer's line speed — nothing is ever *attributed* from it.
DEFAULT_MAX_BYTES_PER_SECOND = 125_000_000

# A projection from a few seconds of traffic is astrology. Below this much
# observed wall time in the month, `projectedTotalBytes` is null with a reason.
MIN_PROJECTION_WINDOW_SECONDS = 3600.0

DEFAULT_PROBE_SAMPLES = 5
DEFAULT_PROBE_TIMEOUT_SECONDS = 2.0

SCHEMA = """
CREATE TABLE IF NOT EXISTS wan_month_usage (
    iface TEXT NOT NULL,
    month TEXT NOT NULL,
    rx_bytes INTEGER NOT NULL DEFAULT 0,
    tx_bytes INTEGER NOT NULL DEFAULT 0,
    carry_over_bytes INTEGER NOT NULL DEFAULT 0,
    first_sample_at REAL NOT NULL,
    last_sample_at REAL NOT NULL,
    PRIMARY KEY (iface, month)
);

CREATE TABLE IF NOT EXISTS wan_counter_state (
    iface TEXT PRIMARY KEY,
    rx_bytes INTEGER NOT NULL,
    tx_bytes INTEGER NOT NULL,
    boot_id TEXT,
    carrier_changes INTEGER,
    month TEXT NOT NULL,
    sampled_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS wan_anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    iface TEXT NOT NULL,
    at REAL NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL
);
"""


# ── values ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CounterSample:
    """One reading of one interface.

    `boot_id` and `carrier_changes` are what make reset detection *observed*
    rather than inferred. Either may be None on a host that does not expose
    it; None means "unknown" and is handled as unknown, never as "unchanged".
    """

    iface: str
    rx_bytes: int
    tx_bytes: int
    at: float
    boot_id: str | None = None
    carrier_changes: int | None = None


@dataclass(frozen=True)
class Delta:
    """The outcome of comparing two readings.

    `attributed` is what may be added to the customer's monthly total. It is
    zero whenever we could not honestly attribute anything; `kind` and `note`
    then say why, and the caller surfaces that as an anomaly rather than
    letting the zero pass for a measurement of "no traffic".
    """

    attributed: int
    kind: str
    note: str | None = None

    @property
    def is_anomaly(self) -> bool:
        return self.kind not in ("normal", "first_sample")


# `kind` values, stable strings — the UI and the tests both key off these.
KIND_FIRST_SAMPLE = "first_sample"
KIND_NORMAL = "normal"
KIND_REBOOT = "reset_reboot"
KIND_LINK_BOUNCE = "reset_link_bounce"
KIND_RESET_UNEXPLAINED = "reset_unexplained"
KIND_WRAP32 = "wrap32"
KIND_AMBIGUOUS = "ambiguous_reset_or_wrap"
KIND_IMPLAUSIBLE = "implausible_jump"
KIND_CLOCK = "clock_anomaly"


# ── the important pure function ─────────────────────────────────────────────


def classify_delta(
    previous: int | None,
    current: int,
    elapsed_seconds: float,
    *,
    rebooted: bool | None = None,
    link_bounced: bool | None = None,
    max_bytes_per_second: int = DEFAULT_MAX_BYTES_PER_SECOND,
) -> Delta:
    """How many bytes passed between two counter readings.

    `rebooted` / `link_bounced` are tri-state on purpose: True (observed),
    False (observed not to have happened), None (this host cannot tell us).
    Treating None as False is the bug that turns a reset into a phantom spike,
    so None is carried all the way through to a named ambiguous outcome.

    The order of the branches is load-bearing:

    * A reboot is DEFINITIVE — the counter restarted at zero, so the bytes
      since then are exactly `current`, whether or not `current` happens to be
      larger than the previous reading. Comparing magnitudes first would
      mis-handle a reboot that occurred while the old counter was still small.

    * A forward-moving counter is checked BEFORE the link-bounce signal,
      because a carrier flap does not necessarily reset counters. If the
      counter still moved forward we take the ordinary difference; adding
      `current` there would double-count everything since boot.

    * Backwards movement is the ambiguous case, and only there does it matter
      whether we are looking at a reset or a 32-bit wrap. A wrap is claimed
      ONLY when the host positively told us it did not reboot and the link did
      not bounce, and the implied wrap volume is physically carryable by the
      NIC in the elapsed window. Otherwise the reading is treated as a reset,
      whose delta is `current` — a value the kernel actually counted. That is
      why no reset path can ever synthesise a multi-gigabyte spike: on every
      reset branch the attributed bytes are bounded by the live counter, never
      by the distance back to 2**32.
    """
    if previous is None:
        return Delta(0, KIND_FIRST_SAMPLE, "baseline reading; nothing to attribute yet")
    if current < 0 or previous < 0:
        return Delta(0, KIND_IMPLAUSIBLE, "negative counter value; nothing attributed")
    if elapsed_seconds <= 0:
        # A clock that went backwards (NTP step, RTC-less Pi getting the time
        # for the first time) makes every rate meaningless. Attribute nothing
        # and say so rather than dividing by a bad number.
        return Delta(
            0,
            KIND_CLOCK,
            f"clock did not advance between samples ({elapsed_seconds:.3f}s); nothing attributed",
        )

    budget = elapsed_seconds * max_bytes_per_second

    def bounded(value: int, kind: str, note: str | None) -> Delta:
        if value > budget:
            return Delta(
                0,
                KIND_IMPLAUSIBLE,
                f"{kind} implied {value} bytes in {elapsed_seconds:.1f}s, above the "
                f"{max_bytes_per_second} B/s hardware ceiling; nothing attributed",
            )
        return Delta(value, kind, note)

    if rebooted:
        return bounded(
            current,
            KIND_REBOOT,
            "host rebooted; counters restarted at zero, so traffic between the last "
            "sample and the reboot is unmeasurable and is not counted",
        )

    if current >= previous:
        note = None
        if link_bounced:
            note = (
                "link bounced between samples; if the interface counters reset, the "
                "traffic before the bounce is unmeasurable and is not counted"
            )
        return bounded(current - previous, KIND_NORMAL, note)

    # ── counter moved backwards ────────────────────────────────────────────
    wrap_possible = previous < COUNTER_32BIT_MODULUS and current < COUNTER_32BIT_MODULUS
    wrap_delta = (COUNTER_32BIT_MODULUS - previous) + current if wrap_possible else None
    wrap_fits = wrap_delta is not None and wrap_delta <= budget

    if link_bounced:
        return bounded(
            current,
            KIND_LINK_BOUNCE,
            "interface went down and up; counters restarted at zero, so traffic "
            "before the bounce is unmeasurable and is not counted",
        )

    if rebooted is False and link_bounced is False:
        # The host positively ruled out both restart causes, so a 32-bit wrap
        # is the only remaining explanation — but only if the link could
        # physically have carried that many bytes in the window.
        if wrap_fits:
            return Delta(
                wrap_delta,  # type: ignore[arg-type]
                KIND_WRAP32,
                f"32-bit counter wrapped at {COUNTER_32BIT_MODULUS} bytes",
            )
        return bounded(
            current,
            KIND_RESET_UNEXPLAINED,
            "counter moved backwards with no reboot or link bounce observed, and a "
            "32-bit wrap would not fit the elapsed window; treated as a reset",
        )

    # We do not know whether the host restarted. Both a reset and a wrap
    # explain the reading. `current` is always the smaller of the two
    # candidates (the wrap candidate is `current` plus the distance back to
    # 2**32), so attributing it is the choice that cannot invent traffic. The
    # difference is named in the note so an operator sees the uncertainty
    # instead of inheriting it silently.
    alternative = f"; a 32-bit wrap would instead imply {wrap_delta} bytes" if wrap_fits else ""
    return bounded(
        current,
        KIND_AMBIGUOUS,
        "counter moved backwards and this host exposes no boot id or carrier-change "
        f"count, so a reset could not be ruled out; attributed the smaller reading "
        f"of {current} bytes{alternative}",
    )


def restart_signals(
    previous: CounterSample, current: CounterSample
) -> tuple[bool | None, bool | None]:
    """(rebooted, link_bounced), each tri-state. None means "cannot tell"."""
    rebooted: bool | None
    if previous.boot_id is None or current.boot_id is None:
        rebooted = None
    else:
        rebooted = previous.boot_id != current.boot_id

    bounced: bool | None
    if previous.carrier_changes is None or current.carrier_changes is None:
        bounced = None
    elif current.carrier_changes < previous.carrier_changes:
        # The carrier-change counter itself only resets at boot, so this is a
        # restart even if boot_id was unavailable.
        bounced = True
    else:
        bounced = current.carrier_changes > previous.carrier_changes
    return rebooted, bounced


# ── link quality (pure) ─────────────────────────────────────────────────────


def summarise_latency(samples: list[float | None]) -> dict:
    """Turn probe results into a report. `None` entries are failed probes.

    Jitter is the mean absolute difference between consecutive *successful*
    samples (the RFC 3550 idea, without the smoothing filter — stated here
    because "jitter" means three different things depending on who says it).
    Fewer than two successful samples means jitter is null with a reason; it
    is never reported as 0.0, which would read as "a perfectly stable link".
    """
    ok = [s for s in samples if s is not None]
    attempted = len(samples)
    result: dict = {
        "samples": attempted,
        "successes": len(ok),
        "lossPercent": round(100.0 * (attempted - len(ok)) / attempted, 1) if attempted else None,
        "latencyMinMs": None,
        "latencyAvgMs": None,
        "latencyMaxMs": None,
        "jitterMs": None,
        "gap": None,
    }
    if not attempted:
        result["gap"] = "no probe attempted"
        result["lossPercent"] = None
        return result
    if not ok:
        result["gap"] = "every probe failed — no latency was measured"
        return result
    result["latencyMinMs"] = round(min(ok), 2)
    result["latencyAvgMs"] = round(sum(ok) / len(ok), 2)
    result["latencyMaxMs"] = round(max(ok), 2)
    if len(ok) < 2:
        result["gap"] = "only one probe succeeded — jitter needs at least two samples"
        return result
    diffs = [abs(ok[i] - ok[i - 1]) for i in range(1, len(ok))]
    result["jitterMs"] = round(sum(diffs) / len(diffs), 2)
    return result


def project_month_end(
    used_bytes: int,
    observed_from: float,
    observed_to: float,
    month_end: float,
) -> tuple[int | None, str | None]:
    """(projected total bytes, gap). Rate is taken over the window we actually
    observed, then extended to the end of the month. Returns null plus a
    reason whenever the observed window is too short to extrapolate from —
    a projection off ninety seconds of traffic is a fabrication with a
    decimal point on it."""
    window = observed_to - observed_from
    if window < MIN_PROJECTION_WINDOW_SECONDS:
        return None, (
            f"observed only {max(window, 0.0):.0f}s of this month so far; a projection "
            f"needs at least {int(MIN_PROJECTION_WINDOW_SECONDS)}s of measurement"
        )
    remaining = month_end - observed_to
    if remaining <= 0:
        return used_bytes, None
    rate = used_bytes / window
    return int(used_bytes + rate * remaining), None


# ── month calendar ──────────────────────────────────────────────────────────


class LocalMonthCalendar:
    """Month keys and boundaries in the host's local civil time.

    See the timezone note in the module docstring. `datetime.fromtimestamp`
    with no tzinfo is local time by definition, and `.timestamp()` on a naive
    datetime resolves it back through the local rules, so DST transitions
    inside a month are handled by the platform rather than by arithmetic here.
    """

    def key(self, ts: float) -> str:
        dt = datetime.fromtimestamp(ts)
        return f"{dt.year:04d}-{dt.month:02d}"

    def bounds(self, ts: float) -> tuple[float, float]:
        dt = datetime.fromtimestamp(ts)
        start = datetime(dt.year, dt.month, 1)
        if dt.month == 12:
            end = datetime(dt.year + 1, 1, 1)
        else:
            end = datetime(dt.year, dt.month + 1, 1)
        return start.timestamp(), end.timestamp()


class UtcMonthCalendar(LocalMonthCalendar):
    """Available for operators who bill in UTC. Not the default — see docstring."""

    def key(self, ts: float) -> str:
        dt = datetime.utcfromtimestamp(ts)
        return f"{dt.year:04d}-{dt.month:02d}"

    def bounds(self, ts: float) -> tuple[float, float]:
        import calendar as _cal

        dt = datetime.utcfromtimestamp(ts)
        start = datetime(dt.year, dt.month, 1)
        end = datetime(dt.year + 1, 1, 1) if dt.month == 12 else datetime(dt.year, dt.month + 1, 1)
        return float(_cal.timegm(start.timetuple())), float(_cal.timegm(end.timetuple()))


# ── configuration (config.py's pattern, read lazily so tests can drive it) ──


@dataclass(frozen=True)
class WanConfig:
    interfaces: tuple[str, ...] = ()
    monthly_cap_bytes: int | None = None
    probe_host: str = "1.1.1.1"
    probe_port: int = 443
    probe_samples: int = DEFAULT_PROBE_SAMPLES
    probe_timeout_seconds: float = DEFAULT_PROBE_TIMEOUT_SECONDS
    max_bytes_per_second: int = DEFAULT_MAX_BYTES_PER_SECOND
    db_path: str = os.environ.get("GATEFLAME_DB_PATH", "/var/lib/gateflame/state.db")
    config_errors: tuple[str, ...] = field(default_factory=tuple)


def wan_config_from_env(env: dict | None = None) -> WanConfig:
    """Parse the environment. A malformed value is reported as a config error
    and the field falls back to "unknown" — it is never silently coerced into
    a number that would then be presented as the customer's cap."""
    e = os.environ if env is None else env
    errors: list[str] = []

    raw_ifaces = e.get("GATEFLAME_WAN_INTERFACES", "")
    interfaces = tuple(part.strip() for part in raw_ifaces.split(",") if part.strip())

    cap: int | None = None
    raw_cap = e.get("GATEFLAME_WAN_MONTHLY_CAP_BYTES")
    if raw_cap not in (None, ""):
        try:
            cap = int(raw_cap)
            if cap <= 0:
                raise ValueError
        except (TypeError, ValueError):
            cap = None
            errors.append(
                "GATEFLAME_WAN_MONTHLY_CAP_BYTES is not a positive whole number of "
                "bytes — no cap is being applied"
            )

    host, port = "1.1.1.1", 443
    raw_target = e.get("GATEFLAME_WAN_PROBE_TARGET")
    if raw_target:
        parsed = _parse_target(raw_target)
        if parsed is None:
            errors.append(
                "GATEFLAME_WAN_PROBE_TARGET is not `host:port` — falling back to 1.1.1.1:443"
            )
        else:
            host, port = parsed

    def _int(name: str, default: int) -> int:
        raw = e.get(name)
        if raw in (None, ""):
            return default
        try:
            value = int(raw)
            if value <= 0:
                raise ValueError
            return value
        except (TypeError, ValueError):
            errors.append(f"{name} is not a positive whole number — using {default}")
            return default

    return WanConfig(
        interfaces=interfaces,
        monthly_cap_bytes=cap,
        probe_host=host,
        probe_port=port,
        probe_samples=_int("GATEFLAME_WAN_PROBE_SAMPLES", DEFAULT_PROBE_SAMPLES),
        probe_timeout_seconds=float(
            _int("GATEFLAME_WAN_PROBE_TIMEOUT_SECONDS", int(DEFAULT_PROBE_TIMEOUT_SECONDS))
        ),
        max_bytes_per_second=_int(
            "GATEFLAME_WAN_MAX_BYTES_PER_SECOND", DEFAULT_MAX_BYTES_PER_SECOND
        ),
        db_path=e.get("GATEFLAME_DB_PATH", "/var/lib/gateflame/state.db"),
        config_errors=tuple(errors),
    )


def _parse_target(raw: str) -> tuple[str, int] | None:
    """`host:port`, including `[v6]:port`. Rejects anything else rather than
    half-parsing it — the probe target is operator input, and a silently
    mangled host produces a latency number for the wrong destination."""
    text = raw.strip()
    if not text or len(text) > 300:
        return None
    if text.startswith("["):
        close = text.find("]:")
        if close == -1:
            return None
        host, port_text = text[1:close], text[close + 2 :]
    else:
        if text.count(":") != 1:
            return None
        host, port_text = text.rsplit(":", 1)
    if not host.strip():
        return None
    try:
        port = int(port_text)
    except (TypeError, ValueError):
        return None
    if not 1 <= port <= 65535:
        return None
    return host.strip(), port


# ── I/O seams ───────────────────────────────────────────────────────────────


class ProcCounterReader:
    """Reads /proc/net/dev, /proc/sys/kernel/random/boot_id and
    /sys/class/net/<iface>/carrier_changes.

    `root` is injectable so a test can point the whole reader at a synthetic
    /proc tree; no root privileges and no network are involved either way.
    Every read failure degrades to None (unknown), never to a zero.
    """

    def __init__(self, root: str | Path = "/"):
        self.root = Path(root)

    def _text(self, relative: str) -> str | None:
        try:
            return (self.root / relative).read_text()
        except OSError:
            return None

    def boot_id(self) -> str | None:
        text = self._text("proc/sys/kernel/random/boot_id")
        return text.strip() if text else None

    def interfaces(self) -> list[str]:
        text = self._text("proc/net/dev")
        if not text:
            return []
        names = []
        for line in text.splitlines():
            if ":" not in line:
                continue
            names.append(line.split(":", 1)[0].strip())
        return names

    def carrier_changes(self, iface: str) -> int | None:
        text = self._text(f"sys/class/net/{iface}/carrier_changes")
        if not text:
            return None
        try:
            return int(text.strip())
        except ValueError:
            return None

    def read(self, iface: str, now: float | None = None) -> CounterSample | None:
        text = self._text("proc/net/dev")
        if not text:
            return None
        for line in text.splitlines():
            if ":" not in line:
                continue
            name, rest = line.split(":", 1)
            if name.strip() != iface:
                continue
            fields = rest.split()
            # /proc/net/dev: 8 receive columns then 8 transmit columns.
            if len(fields) < 9:
                return None
            try:
                rx, tx = int(fields[0]), int(fields[8])
            except ValueError:
                return None
            return CounterSample(
                iface=iface,
                rx_bytes=rx,
                tx_bytes=tx,
                at=time.time() if now is None else now,
                boot_id=self.boot_id(),
                carrier_changes=self.carrier_changes(iface),
            )
        return None


class TcpLatencyProbe:
    """Latency by TCP connect. No shell, no subprocess, no ICMP.

    ICMP would need a raw socket (CAP_NET_RAW) and this agent deliberately
    runs unprivileged, so a TCP handshake to a known-open port is the honest
    measurement available. It measures connect time, which includes one RTT
    plus the peer's accept latency — stated here because it is systematically
    a little above an ICMP ping and a support engineer comparing the two
    should know why.
    """

    def __init__(self, connect=None):
        self._connect = connect or socket.create_connection

    def probe(self, host: str, port: int, timeout: float) -> float | None:
        started = time.perf_counter()
        try:
            conn = self._connect((host, port), timeout)
        except OSError:
            return None
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        try:
            conn.close()
        except OSError:
            pass
        return elapsed_ms


class WanStore:
    """SQLite in storage.py's style: WAL, one file, no ORM, a lock around a
    single shared connection."""

    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        if self.db_path != ":memory:":
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    @contextmanager
    def _cursor(self):
        with self._lock:
            cur = self._conn.cursor()
            try:
                yield cur
                self._conn.commit()
            finally:
                cur.close()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def last_state(self, iface: str) -> dict | None:
        with self._cursor() as cur:
            cur.execute(
                "SELECT rx_bytes, tx_bytes, boot_id, carrier_changes, month, sampled_at "
                "FROM wan_counter_state WHERE iface = ?",
                (iface,),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return {
            "rx_bytes": row[0],
            "tx_bytes": row[1],
            "boot_id": row[2],
            "carrier_changes": row[3],
            "month": row[4],
            "sampled_at": row[5],
        }

    def save_state(self, sample: CounterSample, month: str) -> None:
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO wan_counter_state "
                "(iface, rx_bytes, tx_bytes, boot_id, carrier_changes, month, sampled_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(iface) DO UPDATE SET rx_bytes=excluded.rx_bytes, "
                "tx_bytes=excluded.tx_bytes, boot_id=excluded.boot_id, "
                "carrier_changes=excluded.carrier_changes, month=excluded.month, "
                "sampled_at=excluded.sampled_at",
                (
                    sample.iface,
                    sample.rx_bytes,
                    sample.tx_bytes,
                    sample.boot_id,
                    sample.carrier_changes,
                    month,
                    sample.at,
                ),
            )

    def add_usage(
        self,
        iface: str,
        month: str,
        rx: int,
        tx: int,
        at: float,
        carry_over: int = 0,
    ) -> None:
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO wan_month_usage "
                "(iface, month, rx_bytes, tx_bytes, carry_over_bytes, first_sample_at, last_sample_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(iface, month) DO UPDATE SET "
                "rx_bytes = rx_bytes + excluded.rx_bytes, "
                "tx_bytes = tx_bytes + excluded.tx_bytes, "
                "carry_over_bytes = carry_over_bytes + excluded.carry_over_bytes, "
                "last_sample_at = excluded.last_sample_at",
                (iface, month, rx, tx, carry_over, at, at),
            )

    def month_usage(self, iface: str, month: str) -> dict | None:
        with self._cursor() as cur:
            cur.execute(
                "SELECT rx_bytes, tx_bytes, carry_over_bytes, first_sample_at, last_sample_at "
                "FROM wan_month_usage WHERE iface = ? AND month = ?",
                (iface, month),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return {
            "rx_bytes": row[0],
            "tx_bytes": row[1],
            "carry_over_bytes": row[2],
            "first_sample_at": row[3],
            "last_sample_at": row[4],
        }

    def record_anomaly(self, iface: str, at: float, kind: str, detail: str) -> None:
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO wan_anomalies (iface, at, kind, detail) VALUES (?, ?, ?, ?)",
                (iface, at, kind, detail),
            )

    def recent_anomalies(self, iface: str, since: float, limit: int = 20) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT at, kind, detail FROM wan_anomalies WHERE iface = ? AND at >= ? "
                "ORDER BY at DESC LIMIT ?",
                (iface, since, limit),
            )
            rows = cur.fetchall()
        return [{"at": r[0], "kind": r[1], "detail": r[2]} for r in rows]


# ── the module ──────────────────────────────────────────────────────────────


class WanAudit:
    """Budget accounting + link quality. `services.py` owns the instance."""

    def __init__(
        self,
        config: WanConfig | None = None,
        reader=None,
        store: WanStore | None = None,
        probe=None,
        calendar: LocalMonthCalendar | None = None,
        clock=time.time,
    ):
        self.config = config if config is not None else wan_config_from_env()
        self._reader = reader if reader is not None else ProcCounterReader()
        self._probe = probe if probe is not None else TcpLatencyProbe()
        self._calendar = calendar if calendar is not None else LocalMonthCalendar()
        self._clock = clock
        # Opened lazily. `services.py` holds one of these at module scope, and
        # constructing it must not create /var/lib/gateflame or take a file
        # lock as an import side effect — capability() and the degraded path
        # never need the database at all.
        self._store_instance = store
        self._store_lock = threading.Lock()

    @property
    def _store(self) -> WanStore:
        if self._store_instance is None:
            with self._store_lock:
                if self._store_instance is None:
                    self._store_instance = WanStore(self.config.db_path)
        return self._store_instance

    # ── capability ────────────────────────────────────────────────────────

    def capability(self) -> tuple[bool, str | None]:
        """(usable, gap) — the registry's contract. Never raises."""
        if not self.config.interfaces:
            return False, (
                "no WAN interface configured — set GATEFLAME_WAN_INTERFACES (e.g. "
                "GATEFLAME_WAN_INTERFACES=eth0); the WAN link is not guessed, because "
                "guessing wrong bills LAN traffic against the customer's data cap"
            )
        try:
            present = set(self._reader.interfaces())
        except Exception as exc:  # noqa: BLE001 — a status call must not throw
            return False, f"cannot read interface counters: {exc}"
        missing = [name for name in self.config.interfaces if name not in present]
        if missing:
            return False, (
                f"configured WAN interface(s) not present on this host: {', '.join(missing)} — "
                f"available: {', '.join(sorted(present)) or 'none'}"
            )
        if self.config.config_errors:
            return True, "; ".join(self.config.config_errors)
        return True, None

    # ── accounting ────────────────────────────────────────────────────────

    def sample(self) -> dict:
        """Take one reading per configured interface and fold it into the
        month. Safe to call on a schedule; the whole reset/wrap question lives
        in `classify_delta`, which this only feeds."""
        out: dict = {"interfaces": {}, "gap": None}
        usable, gap = self.capability()
        if not usable:
            out["gap"] = gap
            return out
        for iface in self.config.interfaces:
            out["interfaces"][iface] = self._sample_one(iface)
        return out

    def _sample_one(self, iface: str) -> dict:
        now = self._clock()
        current = self._reader.read(iface, now)
        if current is None:
            return {"gap": f"no counters readable for {iface} at this moment"}

        state = self._store.last_state(iface)
        month = self._calendar.key(current.at)

        if state is None:
            self._store.save_state(current, month)
            # Establish the month row so `first_sample_at` is real, without
            # attributing any bytes to it.
            self._store.add_usage(iface, month, 0, 0, current.at)
            return {
                "rxDelta": 0,
                "txDelta": 0,
                "kinds": [KIND_FIRST_SAMPLE, KIND_FIRST_SAMPLE],
                "anomalies": [],
                "month": month,
            }

        previous = CounterSample(
            iface=iface,
            rx_bytes=state["rx_bytes"],
            tx_bytes=state["tx_bytes"],
            at=state["sampled_at"],
            boot_id=state["boot_id"],
            carrier_changes=state["carrier_changes"],
        )
        rebooted, bounced = restart_signals(previous, current)
        elapsed = current.at - previous.at

        rx = classify_delta(
            previous.rx_bytes,
            current.rx_bytes,
            elapsed,
            rebooted=rebooted,
            link_bounced=bounced,
            max_bytes_per_second=self.config.max_bytes_per_second,
        )
        tx = classify_delta(
            previous.tx_bytes,
            current.tx_bytes,
            elapsed,
            rebooted=rebooted,
            link_bounced=bounced,
            max_bytes_per_second=self.config.max_bytes_per_second,
        )

        # ── month rollover ────────────────────────────────────────────────
        # The previous sample may belong to a previous month — including the
        # case where the agent was off for weeks and several months went by.
        # The bytes in this delta genuinely straddle the boundary and we did
        # not sample at it, so there is no measured basis for splitting them.
        # Splitting pro-rata by time would be a fabrication. The rule is
        # therefore: BYTES ARE ATTRIBUTED TO THE MONTH IN WHICH THEY WERE
        # OBSERVED, i.e. the month of the current sample. The old month is
        # closed at its last in-month reading, and the straddling bytes are
        # also recorded separately as `carryOverBytes` so an operator can see
        # exactly how much of this month's total is boundary-ambiguous rather
        # than inheriting the ambiguity invisibly.
        stored_month = state["month"]
        rolled_over = stored_month != month
        spanning = rx.attributed + tx.attributed if rolled_over else 0

        self._store.add_usage(
            iface, month, rx.attributed, tx.attributed, current.at, carry_over=spanning
        )
        self._store.save_state(current, month)

        anomalies: list[dict] = []
        for delta in (rx, tx):
            if delta.is_anomaly:
                self._store.record_anomaly(iface, current.at, delta.kind, delta.note or "")
                anomalies.append({"kind": delta.kind, "detail": delta.note})
        if rolled_over:
            detail = (
                f"month rolled from {stored_month} to {month} between samples; "
                f"{spanning} bytes measured across the boundary were attributed to {month} "
                "because the boundary itself was not sampled"
            )
            self._store.record_anomaly(iface, current.at, "month_rollover", detail)
            anomalies.append({"kind": "month_rollover", "detail": detail})

        return {
            "rxDelta": rx.attributed,
            "txDelta": tx.attributed,
            "kinds": [rx.kind, tx.kind],
            "anomalies": anomalies,
            "month": month,
            "rolledOverFrom": stored_month if rolled_over else None,
        }

    # ── reporting ─────────────────────────────────────────────────────────

    def budget(self, iface: str) -> dict:
        now = self._clock()
        month = self._calendar.key(now)
        month_start, month_end = self._calendar.bounds(now)
        usage = self._store.month_usage(iface, month)
        cap = self.config.monthly_cap_bytes

        if usage is None:
            return {
                "iface": iface,
                "month": month,
                "usedBytes": None,
                "rxBytes": None,
                "txBytes": None,
                "capBytes": cap,
                "percentOfCap": None,
                "projectedTotalBytes": None,
                "carryOverBytes": None,
                "gap": f"no samples recorded for {iface} in {month} yet",
            }

        used = usage["rx_bytes"] + usage["tx_bytes"]
        percent: float | None = None
        cap_gap: str | None = None
        if cap is None:
            cap_gap = (
                "no monthly cap configured — set GATEFLAME_WAN_MONTHLY_CAP_BYTES to get "
                "percent-of-cap; a default cap is not invented"
            )
        else:
            percent = round(100.0 * used / cap, 2)

        projected, projection_gap = project_month_end(
            used,
            max(usage["first_sample_at"], month_start),
            max(usage["last_sample_at"], usage["first_sample_at"]),
            month_end,
        )

        return {
            "iface": iface,
            "month": month,
            "monthStart": month_start,
            "monthEnd": month_end,
            "monthBoundary": "host local civil month",
            "usedBytes": used,
            "rxBytes": usage["rx_bytes"],
            "txBytes": usage["tx_bytes"],
            "capBytes": cap,
            "percentOfCap": percent,
            "capGap": cap_gap,
            "projectedTotalBytes": projected,
            "projectionGap": projection_gap,
            "carryOverBytes": usage["carry_over_bytes"],
            "observedFrom": usage["first_sample_at"],
            "observedTo": usage["last_sample_at"],
            "anomalies": self._store.recent_anomalies(iface, month_start),
            "gap": None,
        }

    def link_quality(self) -> dict:
        samples: list[float | None] = []
        for _ in range(self.config.probe_samples):
            try:
                samples.append(
                    self._probe.probe(
                        self.config.probe_host,
                        self.config.probe_port,
                        self.config.probe_timeout_seconds,
                    )
                )
            except Exception as exc:  # noqa: BLE001 — a failed probe is data, not a crash
                logger.debug("wan probe error: %s", exc)
                samples.append(None)
        summary = summarise_latency(samples)
        summary["target"] = f"{self.config.probe_host}:{self.config.probe_port}"
        summary["method"] = "tcp_connect"
        return summary

    def report(self) -> dict:
        usable, gap = self.capability()
        if not usable:
            return {"interfaces": {}, "link": None, "gap": gap}
        return {
            "interfaces": {iface: self.budget(iface) for iface in self.config.interfaces},
            "link": self.link_quality(),
            "gap": gap,
        }

    def close(self) -> None:
        if self._store_instance is not None:
            self._store_instance.close()
            self._store_instance = None
