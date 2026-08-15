"""SQLite-backed feed store: nodes, per-node tokens, health history.

WAL mode, one file, no ORM — the same shape as node-agent's `storage.py`, on
purpose: two services in one product that disagree about how to talk to SQLite
is how connection-handling bugs get written twice.

**The schema is the second, independent enforcement of §4.1.** Every value the
receiver persists goes into a named, typed column. There is no `payload` blob,
no `raw_json` column, no key/value side table and no JSON1 usage anywhere —
including for the module list, which gets its own table with named columns
rather than the `modules_json TEXT` that would have been three lines shorter.

That is deliberate. `schema.py` stops a forbidden field at the door; this file
means that even if `schema.py` were bypassed, weakened by a future edit, or
wrong, there would be nowhere in the database to put a domain, a client IP, a
hostname or a threat log line. Storing a leak would require a migration, and a
migration adding a `client_ips` column is a thing a reviewer can see. Silently
widening a JSON blob is not.

The write path (`record_report`) takes a validated `HealthReport` model and
reads typed attributes off it. It never sees the request dict, never does
`**body`, and never iterates unknown keys.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from .schema import HealthReport

SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    node_id TEXT PRIMARY KEY,
    first_seen REAL NOT NULL,
    last_seen REAL,
    last_agent_version TEXT,
    report_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS node_tokens (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    issued_at REAL NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_node_tokens_node ON node_tokens (node_id);

CREATE TABLE IF NOT EXISTS health_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    report_hash TEXT NOT NULL,
    received_at REAL NOT NULL,
    sent_at REAL NOT NULL,
    clock_skew_seconds REAL NOT NULL,
    clock_suspect INTEGER NOT NULL DEFAULT 0,
    agent_version TEXT NOT NULL,
    uptime_seconds INTEGER NOT NULL,
    cpu_percent REAL,
    mem_used_mb INTEGER,
    mem_total_mb INTEGER,
    disk_used_percent REAL,
    temp_c REAL,
    throttle_flags TEXT,
    errors_24h INTEGER,
    restarts_24h INTEGER,
    wan_budget_used_percent REAL,
    pihole_reachable INTEGER,
    UNIQUE (node_id, report_hash)
);

CREATE INDEX IF NOT EXISTS idx_reports_node_time ON health_reports (node_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_received ON health_reports (received_at);

CREATE TABLE IF NOT EXISTS module_reports (
    report_id INTEGER NOT NULL,
    module_id TEXT NOT NULL,
    status TEXT NOT NULL,
    gap TEXT,
    remedy TEXT,
    restarts_24h INTEGER,
    PRIMARY KEY (report_id, module_id)
);

CREATE TABLE IF NOT EXISTS node_rate (
    node_id TEXT PRIMARY KEY,
    window_start REAL NOT NULL,
    window_count INTEGER NOT NULL,
    last_accepted_at REAL
);
"""


@dataclass
class RateDecision:
    allowed: bool
    retry_after_seconds: float = 0.0
    reason: str | None = None


def report_hash(report: HealthReport) -> str:
    """Stable content hash of a validated report, used as the replay key.

    Computed from the *validated model*, not from the raw bytes, so two
    retries that differ only in JSON key order or float formatting still
    collapse to one row. `sentAt` is part of the hash, which is what makes
    this a replay key rather than a change-detector: the agent stamps a new
    second on every genuinely new report, so an identical hash means the
    identical report arrived twice — which is exactly what
    `HealthFeedLoop._run` does when a response is lost on the return path.
    """
    canonical = json.dumps(report.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class FeedStore:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._conn.commit()
        self._last_prune = 0.0

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    @contextmanager
    def _cursor(self):
        with self._lock:
            cur = self._conn.cursor()
            try:
                yield cur
                self._conn.commit()
            finally:
                cur.close()

    # ---- node tokens ------------------------------------------------------

    def issue_node_token(self, node_id: str, label: str, hasher) -> tuple[str, str]:
        """Create a node and mint one bearer token for it. Returns (id, token).

        The plaintext token is returned exactly once, here, and is never
        written anywhere — only `hasher(token)` reaches the database.
        """
        token_id = f"nft-{secrets.token_hex(6)}"
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (node_id, first_seen, report_count) VALUES (?, ?, 0) "
                "ON CONFLICT(node_id) DO NOTHING",
                (node_id, now),
            )
            cur.execute(
                "INSERT INTO node_tokens (id, node_id, token_hash, label, issued_at, revoked) "
                "VALUES (?, ?, ?, ?, ?, 0)",
                (token_id, node_id, hasher(token), label, now),
            )
        return token_id, token

    def node_for_token_hash(self, token_hash: str) -> str | None:
        """Resolve a token hash to its node id, or None.

        Looked up by hash across all nodes rather than "fetch this node's
        tokens and compare", so the work done — and therefore the time taken —
        is the same whether the node id in the path exists or not. The caller
        compares the returned node id against the path and returns the same
        401 either way.
        """
        with self._cursor() as cur:
            cur.execute(
                "SELECT node_id FROM node_tokens WHERE token_hash = ? AND revoked = 0",
                (token_hash,),
            )
            row = cur.fetchone()
            return row[0] if row else None

    def revoke_node_token(self, token_id: str) -> bool:
        with self._cursor() as cur:
            cur.execute("UPDATE node_tokens SET revoked = 1 WHERE id = ?", (token_id,))
            return cur.rowcount > 0

    def list_node_tokens(self, node_id: str) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT id, label, issued_at, revoked FROM node_tokens WHERE node_id = ? ORDER BY issued_at",
                (node_id,),
            )
            return [
                {"id": r[0], "label": r[1], "issuedAt": r[2], "revoked": bool(r[3])}
                for r in cur.fetchall()
            ]

    # ---- rate limiting ----------------------------------------------------

    def check_rate_limit(
        self, node_id: str, min_interval_seconds: float, max_per_hour: int, now: float | None = None
    ) -> RateDecision:
        """Fixed-window limiter, one row per node.

        One row per node is the point: the limiter's own bookkeeping cannot be
        the thing that fills the disk. A node in a tight retry loop rewrites
        the same row forever.

        Callers must resolve replays *before* calling this — an identical
        report that has already been stored is answered from the dedupe path
        and never consumes budget, so a retry storm caused by lost responses
        can't lock a node out of reporting its next, genuinely new report.
        """
        now = time.time() if now is None else now
        with self._cursor() as cur:
            cur.execute(
                "SELECT window_start, window_count, last_accepted_at FROM node_rate WHERE node_id = ?",
                (node_id,),
            )
            row = cur.fetchone()
            window_start, window_count, last_accepted = (row if row else (now, 0, None))

            if now - window_start >= 3600.0:
                window_start, window_count = now, 0

            if last_accepted is not None and now - last_accepted < min_interval_seconds:
                return RateDecision(
                    allowed=False,
                    retry_after_seconds=round(min_interval_seconds - (now - last_accepted), 3),
                    reason="min_interval",
                )
            if window_count >= max_per_hour:
                return RateDecision(
                    allowed=False,
                    retry_after_seconds=round(3600.0 - (now - window_start), 3),
                    reason="hourly_cap",
                )

            cur.execute(
                "INSERT INTO node_rate (node_id, window_start, window_count, last_accepted_at) "
                "VALUES (?, ?, ?, ?) "
                "ON CONFLICT(node_id) DO UPDATE SET window_start = excluded.window_start, "
                "window_count = excluded.window_count, last_accepted_at = excluded.last_accepted_at",
                (node_id, window_start, window_count + 1, now),
            )
        return RateDecision(allowed=True)

    # ---- health reports ---------------------------------------------------

    def has_report(self, node_id: str, digest: str) -> bool:
        with self._cursor() as cur:
            cur.execute(
                "SELECT 1 FROM health_reports WHERE node_id = ? AND report_hash = ?",
                (node_id, digest),
            )
            return cur.fetchone() is not None

    def record_report(
        self,
        report: HealthReport,
        digest: str,
        received_at: float,
        sent_at: float,
        clock_skew_seconds: float,
        clock_suspect: bool,
    ) -> int | None:
        """Persist one validated report. Returns the row id, or None if it was
        a replay that raced another writer.

        Note the shape of this function: every bound parameter is a named
        attribute of a typed model. There is no loop over the payload's keys,
        so a field that got past validation still has no path into a column.
        """
        host = report.host
        counters = report.counters
        with self._cursor() as cur:
            cur.execute(
                "INSERT OR IGNORE INTO health_reports ("
                " node_id, report_hash, received_at, sent_at, clock_skew_seconds, clock_suspect,"
                " agent_version, uptime_seconds, cpu_percent, mem_used_mb, mem_total_mb,"
                " disk_used_percent, temp_c, throttle_flags, errors_24h, restarts_24h,"
                " wan_budget_used_percent, pihole_reachable"
                ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    report.nodeId,
                    digest,
                    received_at,
                    sent_at,
                    clock_skew_seconds,
                    1 if clock_suspect else 0,
                    report.agentVersion,
                    report.uptimeSeconds,
                    host.cpuPercent,
                    host.memUsedMB,
                    host.memTotalMB,
                    host.diskUsedPercent,
                    host.tempC,
                    host.throttleFlags,
                    counters.errors24h,
                    counters.restarts24h,
                    counters.wanBudgetUsedPercent,
                    None if report.piholeReachable is None else int(report.piholeReachable),
                ),
            )
            if cur.rowcount == 0:
                return None
            report_id = cur.lastrowid

            for module in report.modules:
                cur.execute(
                    "INSERT OR IGNORE INTO module_reports "
                    "(report_id, module_id, status, gap, remedy, restarts_24h) VALUES (?,?,?,?,?,?)",
                    (
                        report_id,
                        module.id,
                        module.status,
                        module.gap,
                        module.remedy,
                        module.restarts24h,
                    ),
                )

            # `last_seen` is the *server's* receive time, never the node's
            # `sentAt`. A node with a broken clock — or one lying about it —
            # must not be able to appear fresher (or older) than it is on the
            # support console.
            cur.execute(
                "INSERT INTO nodes (node_id, first_seen, last_seen, last_agent_version, report_count) "
                "VALUES (?, ?, ?, ?, 1) "
                "ON CONFLICT(node_id) DO UPDATE SET "
                " last_seen = MAX(COALESCE(nodes.last_seen, 0), excluded.last_seen), "
                " last_agent_version = excluded.last_agent_version, "
                " report_count = nodes.report_count + 1",
                (report.nodeId, received_at, received_at, report.agentVersion),
            )
        return report_id

    # ---- read API ---------------------------------------------------------

    def list_nodes(self) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT node_id, first_seen, last_seen, last_agent_version, report_count "
                "FROM nodes ORDER BY node_id"
            )
            rows = cur.fetchall()
            out = []
            for node_id, first_seen, last_seen, version, count in rows:
                degraded: list[str] = []
                if last_seen is not None:
                    cur.execute(
                        "SELECT id FROM health_reports WHERE node_id = ? "
                        "ORDER BY received_at DESC, id DESC LIMIT 1",
                        (node_id,),
                    )
                    latest = cur.fetchone()
                    if latest:
                        cur.execute(
                            "SELECT module_id FROM module_reports WHERE report_id = ? "
                            "AND status IN ('degraded', 'stopped', 'unknown') ORDER BY module_id",
                            (latest[0],),
                        )
                        degraded = [r[0] for r in cur.fetchall()]
                out.append(
                    {
                        "nodeId": node_id,
                        "firstSeen": first_seen,
                        "lastSeen": last_seen,
                        "agentVersion": version,
                        "reportCount": count,
                        "degradedModules": degraded,
                    }
                )
            return out

    def node_exists(self, node_id: str) -> bool:
        with self._cursor() as cur:
            cur.execute("SELECT 1 FROM nodes WHERE node_id = ?", (node_id,))
            return cur.fetchone() is not None

    def node_history(self, node_id: str, limit: int) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT id, received_at, sent_at, clock_skew_seconds, clock_suspect, agent_version,"
                " uptime_seconds, cpu_percent, mem_used_mb, mem_total_mb, disk_used_percent,"
                " temp_c, throttle_flags, errors_24h, restarts_24h, wan_budget_used_percent,"
                " pihole_reachable "
                "FROM health_reports WHERE node_id = ? ORDER BY received_at DESC, id DESC LIMIT ?",
                (node_id, limit),
            )
            reports = cur.fetchall()
            out = []
            for r in reports:
                cur.execute(
                    "SELECT module_id, status, gap, remedy, restarts_24h FROM module_reports "
                    "WHERE report_id = ? ORDER BY module_id",
                    (r[0],),
                )
                modules = [
                    {
                        "id": m[0],
                        "status": m[1],
                        "gap": m[2],
                        "remedy": m[3],
                        "restarts24h": m[4],
                    }
                    for m in cur.fetchall()
                ]
                out.append(
                    {
                        "receivedAt": r[1],
                        "sentAt": r[2],
                        "clockSkewSeconds": r[3],
                        "clockSuspect": bool(r[4]),
                        "agentVersion": r[5],
                        "uptimeSeconds": r[6],
                        "host": {
                            "cpuPercent": r[7],
                            "memUsedMB": r[8],
                            "memTotalMB": r[9],
                            "diskUsedPercent": r[10],
                            "tempC": r[11],
                            "throttleFlags": r[12],
                        },
                        "counters": {
                            "errors24h": r[13],
                            "restarts24h": r[14],
                            "wanBudgetUsedPercent": r[15],
                        },
                        "piholeReachable": None if r[16] is None else bool(r[16]),
                        "modules": modules,
                    }
                )
            return out

    def report_count(self, node_id: str | None = None) -> int:
        with self._cursor() as cur:
            if node_id is None:
                cur.execute("SELECT COUNT(*) FROM health_reports")
            else:
                cur.execute("SELECT COUNT(*) FROM health_reports WHERE node_id = ?", (node_id,))
            return cur.fetchone()[0]

    # ---- retention --------------------------------------------------------

    def prune(self, retention_days: int, max_rows_per_node: int, now: float | None = None) -> int:
        """Delete health rows past retention, and any excess beyond the
        per-node row cap. Returns the number of report rows deleted.

        Pruning is keyed on `received_at`, never `sent_at`: a node claiming to
        be in 2099 cannot make its rows immortal, and one claiming 1970 cannot
        make them vanish on arrival.
        """
        now = time.time() if now is None else now
        cutoff = now - retention_days * 86_400.0
        with self._cursor() as cur:
            cur.execute("SELECT id FROM health_reports WHERE received_at < ?", (cutoff,))
            doomed = {r[0] for r in cur.fetchall()}

            cur.execute("SELECT DISTINCT node_id FROM health_reports")
            for (node_id,) in cur.fetchall():
                cur.execute(
                    "SELECT id FROM health_reports WHERE node_id = ? "
                    "ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?",
                    (node_id, max_rows_per_node),
                )
                doomed.update(r[0] for r in cur.fetchall())

            for report_id in doomed:
                cur.execute("DELETE FROM module_reports WHERE report_id = ?", (report_id,))
                cur.execute("DELETE FROM health_reports WHERE id = ?", (report_id,))
        return len(doomed)

    def maybe_prune(self, retention_days: int, max_rows_per_node: int, interval: float = 60.0) -> int:
        """Prune at most once per `interval`, called from the accept path.

        Cheap enough to run inline and it means retention needs no cron, no
        systemd timer and no second process that someone forgets to enable —
        the promise in the README is kept by the only code path that can
        create data.
        """
        now = time.time()
        if now - self._last_prune < interval:
            return 0
        self._last_prune = now
        return self.prune(retention_days, max_rows_per_node, now=now)

    def delete_node(self, node_id: str) -> int:
        """Erase a node: history, modules, tokens, rate state, identity row.

        §4.2 lists "retention limits and deletion on request" among the POPIA
        duties. Health-only data mostly stays out of that category, but a
        support feed with no delete button is a bad answer to a customer who
        asks, so there is one.
        """
        with self._cursor() as cur:
            cur.execute("SELECT id FROM health_reports WHERE node_id = ?", (node_id,))
            ids = [r[0] for r in cur.fetchall()]
            for report_id in ids:
                cur.execute("DELETE FROM module_reports WHERE report_id = ?", (report_id,))
            cur.execute("DELETE FROM health_reports WHERE node_id = ?", (node_id,))
            cur.execute("DELETE FROM node_tokens WHERE node_id = ?", (node_id,))
            cur.execute("DELETE FROM node_rate WHERE node_id = ?", (node_id,))
            cur.execute("DELETE FROM nodes WHERE node_id = ?", (node_id,))
        return len(ids)
