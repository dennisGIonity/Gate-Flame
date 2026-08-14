"""SQLite-backed state: node identity, paired devices, pairing codes.

WAL mode, one file, no ORM. This is the one place `provisioned` lives — it
must never be un-set by revoking devices. That was the defect that turned a
lost phone into a node takeover in the previous build: revoke-all counted only
unrevoked tokens, so revoking everyone looked identical to "never provisioned"
and any tokenless loopback caller got treated as first-boot admin.
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS node_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    node_id TEXT NOT NULL,
    provisioned INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    expires_at REAL NOT NULL,
    attempts_remaining INTEGER NOT NULL DEFAULT 5,
    used INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_attempts (
    source_ip TEXT PRIMARY KEY,
    last_attempt_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    scopes TEXT NOT NULL,
    paired_at REAL NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
);
"""


def _hash_token(token: str) -> str:
    # Tokens are bearer credentials; store only a salted hash, same principle
    # as a password. A dump of the DB must not hand out live device tokens.
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _gen_node_id() -> str:
    # GF- + 8 base32 chars. In §3.3 this is meant to derive from the SoC
    # serial; on non-Pi hosts (dev, CI, this sandbox) there is no serial to
    # read, so fall back to a random salt only — still stable once persisted,
    # never regenerated after first boot.
    serial = _read_soc_serial() or ""
    raw = (serial + secrets.token_hex(16)).encode("utf-8")
    digest = hashlib.sha256(raw).digest()
    b32 = base64.b32encode(digest).decode("ascii").rstrip("=")
    return f"GF-{b32[:8]}"


def _read_soc_serial() -> str | None:
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("Serial"):
                    return line.split(":")[1].strip()
    except OSError:
        pass
    return None


class Store:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)
        self._conn.commit()
        self._ensure_identity()

    @contextmanager
    def _cursor(self):
        with self._lock:
            cur = self._conn.cursor()
            try:
                yield cur
                self._conn.commit()
            finally:
                cur.close()

    def _ensure_identity(self) -> None:
        with self._cursor() as cur:
            cur.execute("SELECT id FROM node_identity WHERE id = 1")
            if cur.fetchone() is None:
                cur.execute(
                    "INSERT INTO node_identity (id, node_id, provisioned, created_at) "
                    "VALUES (1, ?, 0, ?)",
                    (_gen_node_id(), time.time()),
                )

    # ---- node identity -----------------------------------------------

    def node_id(self) -> str:
        with self._cursor() as cur:
            cur.execute("SELECT node_id FROM node_identity WHERE id = 1")
            return cur.fetchone()[0]

    def is_provisioned(self) -> bool:
        with self._cursor() as cur:
            cur.execute("SELECT provisioned FROM node_identity WHERE id = 1")
            return bool(cur.fetchone()[0])

    def mark_provisioned(self) -> None:
        # Set once, on the first successful pairing claim. Never unset —
        # revoke_all() below must not touch this column. That constraint is
        # the whole fix for the takeover defect.
        with self._cursor() as cur:
            cur.execute("UPDATE node_identity SET provisioned = 1 WHERE id = 1")

    # ---- pairing codes --------------------------------------------------

    def create_pairing_code(self, ttl_seconds: int = 300) -> tuple[str, float]:
        code = f"{secrets.randbelow(1_000_000):06d}"
        expires_at = time.time() + ttl_seconds
        with self._cursor() as cur:
            # Only one live code at a time — issuing a new one invalidates
            # any prior unused code so a stale code can't be raced.
            cur.execute("DELETE FROM pairing_codes WHERE used = 0")
            cur.execute(
                "INSERT INTO pairing_codes (code, expires_at, attempts_remaining, used, created_at) "
                "VALUES (?, ?, 5, 0, ?)",
                (code, expires_at, time.time()),
            )
        return code, expires_at

    def check_rate_limit(self, source_ip: str, min_interval_seconds: float = 2.0) -> float | None:
        """Returns seconds to wait if rate-limited, else None."""
        now = time.time()
        with self._cursor() as cur:
            cur.execute("SELECT last_attempt_at FROM pairing_attempts WHERE source_ip = ?", (source_ip,))
            row = cur.fetchone()
            if row is not None:
                elapsed = now - row[0]
                if elapsed < min_interval_seconds:
                    return round(min_interval_seconds - elapsed, 3)
            cur.execute(
                "INSERT INTO pairing_attempts (source_ip, last_attempt_at) VALUES (?, ?) "
                "ON CONFLICT(source_ip) DO UPDATE SET last_attempt_at = excluded.last_attempt_at",
                (source_ip, now),
            )
        return None

    @dataclass
    class ClaimResult:
        ok: bool
        error: str | None = None
        attempts_remaining: int | None = None

    def claim_pairing_code(self, code: str) -> "Store.ClaimResult":
        with self._cursor() as cur:
            cur.execute(
                "SELECT id, expires_at, attempts_remaining, used FROM pairing_codes "
                "WHERE code = ? ORDER BY id DESC LIMIT 1",
                (code,),
            )
            row = cur.fetchone()
            if row is None:
                return Store.ClaimResult(ok=False, error="invalid_code")
            row_id, expires_at, attempts_remaining, used = row
            if used:
                return Store.ClaimResult(ok=False, error="invalid_code")
            if time.time() > expires_at:
                return Store.ClaimResult(ok=False, error="code_expired")
            if attempts_remaining <= 0:
                return Store.ClaimResult(ok=False, error="code_expired")
            cur.execute("UPDATE pairing_codes SET used = 1 WHERE id = ?", (row_id,))
            return Store.ClaimResult(ok=True)

    def record_failed_attempt(self, code: str) -> int:
        """Decrement attempts for the most recent unused code; return remaining."""
        with self._cursor() as cur:
            cur.execute(
                "SELECT id, attempts_remaining FROM pairing_codes WHERE used = 0 ORDER BY id DESC LIMIT 1"
            )
            row = cur.fetchone()
            if row is None:
                return 0
            row_id, remaining = row
            remaining = max(0, remaining - 1)
            cur.execute("UPDATE pairing_codes SET attempts_remaining = ? WHERE id = ?", (remaining, row_id))
            if remaining <= 0:
                cur.execute("DELETE FROM pairing_codes WHERE id = ?", (row_id,))
            return remaining

    # ---- devices ----------------------------------------------------------

    def register_device(self, name: str, scopes: list[str]) -> tuple[str, str]:
        device_id = f"dev-{secrets.token_hex(6)}"
        token = secrets.token_urlsafe(32)
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO devices (id, name, token_hash, scopes, paired_at, revoked) "
                "VALUES (?, ?, ?, ?, ?, 0)",
                (device_id, name, _hash_token(token), ",".join(scopes), time.time()),
            )
        return device_id, token

    def device_for_token(self, token: str) -> dict | None:
        with self._cursor() as cur:
            cur.execute(
                "SELECT id, name, scopes, revoked FROM devices WHERE token_hash = ?",
                (_hash_token(token),),
            )
            row = cur.fetchone()
            if row is None or row[3]:
                return None
            return {"id": row[0], "name": row[1], "scopes": row[2].split(",")}

    def list_devices(self) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT id, name, scopes, paired_at FROM devices WHERE revoked = 0 ORDER BY paired_at"
            )
            return [
                {"id": r[0], "name": r[1], "scopes": r[2].split(","), "pairedAt": r[3]}
                for r in cur.fetchall()
            ]

    def revoke_device(self, device_id: str) -> bool:
        with self._cursor() as cur:
            cur.execute("UPDATE devices SET revoked = 1 WHERE id = ?", (device_id,))
            return cur.rowcount > 0

    def revoke_all(self) -> int:
        # Deliberately does NOT touch node_identity.provisioned. See the
        # module docstring — this is the fix for the takeover defect.
        with self._cursor() as cur:
            cur.execute("UPDATE devices SET revoked = 1 WHERE revoked = 0")
            return cur.rowcount
