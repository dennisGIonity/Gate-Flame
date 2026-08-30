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
import json
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

-- Owner-chosen filtering settings.
--
-- One row, id=1. A settings TABLE rather than a column on node_identity
-- because identity is generated once at first boot and must never be rewritten
-- - the revoke_all/provisioned defect was exactly that class of mistake, and
-- keeping mutable preferences away from immutable identity is how it stays
-- fixed.
--
-- Defaults here mirror the module defaults deliberately: threat filtering on
-- at its safest level, no content categories, not paused. A fresh box protects
-- without blocking anything legal, and without anyone having chosen anything.
CREATE TABLE IF NOT EXISTS filter_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    threat_level TEXT NOT NULL DEFAULT 'low',
    categories TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    pause_duration TEXT,
    pause_resume_at REAL,
    pause_reason TEXT,
    updated_at REAL NOT NULL DEFAULT 0
);

-- Gate^Flame Shield (per-device VPN, see vpn.py). Keyed by MAC, same
-- identity clients.py already uses for passive discovery - there is no
-- separate device-registry concept to keep in sync with it. One row per
-- device that has EVER touched Shield; a device the owner never used it on
-- simply has no row, same "absence means never configured" shape as
-- everything else in this file.
CREATE TABLE IF NOT EXISTS vpn_devices (
    mac TEXT PRIMARY KEY,
    region TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    preauth_key TEXT,
    provider TEXT NOT NULL DEFAULT 'headscale',
    updated_at REAL NOT NULL DEFAULT 0
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
        self._migrate_vpn_devices_provider()

    def _migrate_vpn_devices_provider(self) -> None:
        # `provider` was added after some boxes may already have a vpn_devices
        # table from the Headscale-only version of Shield. CREATE TABLE IF NOT
        # EXISTS does not retrofit columns onto an existing table, so this adds
        # it once, idempotently. Every pre-existing row predates VPN Gate
        # support and was therefore always the Headscale path - the DEFAULT
        # 'headscale' on ALTER TABLE backfills that correctly for free.
        with self._cursor() as cur:
            cur.execute("PRAGMA table_info(vpn_devices)")
            cols = {row[1] for row in cur.fetchall()}
            if "provider" not in cols:
                cur.execute(
                    "ALTER TABLE vpn_devices ADD COLUMN provider TEXT NOT NULL DEFAULT 'headscale'"
                )

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

    # ------------------------------------------------------------------
    # Filtering settings
    #
    # The owner's three choices: how much danger to block, what content to
    # block, and whether filtering is on right now. Persisted so a reboot,
    # a container restart or an agent upgrade cannot quietly reset someone's
    # preferences - or, worse, silently re-enable something they turned off.
    # ------------------------------------------------------------------

    def get_filter_settings(self) -> dict:
        """Current settings, creating the default row on first read.

        Never raises on missing or corrupt data. This is on the path that
        decides whether the household is protected, so it degrades to the safe
        default rather than propagating an error: filtering ON, safest level,
        no content categories.
        """
        with self._cursor() as cur:
            cur.execute(
                "SELECT threat_level, categories, enabled, pause_duration, "
                "pause_resume_at, pause_reason FROM filter_settings WHERE id = 1"
            )
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    "INSERT OR IGNORE INTO filter_settings (id, updated_at) VALUES (1, ?)",
                    (time.time(),),
                )
                return {
                    "threat_level": "low",
                    "categories": [],
                    "enabled": True,
                    "pause_duration": None,
                    "pause_resume_at": None,
                    "pause_reason": None,
                }

        try:
            categories = json.loads(row[1]) if row[1] else []
            if not isinstance(categories, list):
                categories = []
        except (ValueError, TypeError):
            # A corrupt categories blob must not take filtering down with it.
            # Falling back to [] means no CONTENT blocking, which is the
            # permissive direction - the safe failure here, because wrongly
            # blocking legal sites is the outcome the owner cannot diagnose.
            categories = []

        return {
            "threat_level": row[0] or "low",
            "categories": categories,
            "enabled": bool(row[2]),
            "pause_duration": row[3],
            "pause_resume_at": row[4],
            "pause_reason": row[5],
        }

    def set_threat_level(self, level: str) -> None:
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO filter_settings (id, threat_level, updated_at) VALUES (1, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET threat_level = ?, updated_at = ?",
                (level, time.time(), level, time.time()),
            )

    def set_categories(self, categories: list[str]) -> None:
        blob = json.dumps(list(categories))
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO filter_settings (id, categories, updated_at) VALUES (1, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET categories = ?, updated_at = ?",
                (blob, time.time(), blob, time.time()),
            )

    def pause_filtering(
        self, duration: str, resume_at: float | None, reason: str | None = None
    ) -> None:
        """Record that the OWNER switched filtering off.

        `resume_at` of None means no timer - either 'indefinite' or
        'until_reboot'. They are distinguished by duration, not by this field.
        """
        now = time.time()
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO filter_settings "
                "(id, enabled, pause_duration, pause_resume_at, pause_reason, updated_at) "
                "VALUES (1, 0, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET enabled = 0, pause_duration = ?, "
                "pause_resume_at = ?, pause_reason = ?, updated_at = ?",
                (duration, resume_at, reason, now, duration, resume_at, reason, now),
            )

    def resume_filtering(self) -> None:
        """Filtering back on, and every trace of the pause cleared.

        Leaving a stale resume_at behind would let a later read believe a pause
        is still scheduled and switch protection off again on its own.
        """
        now = time.time()
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO filter_settings (id, enabled, updated_at) VALUES (1, 1, ?) "
                "ON CONFLICT(id) DO UPDATE SET enabled = 1, pause_duration = NULL, "
                "pause_resume_at = NULL, pause_reason = NULL, updated_at = ?",
                (now, now),
            )

    def clear_reboot_pause(self) -> bool:
        """Called once at startup: an 'until_reboot' pause ends at reboot.

        Returns True if a pause was cleared. Without this the phrase would be a
        lie - the box would come back up still unprotected, and the owner would
        have no indication that the thing they asked for had not happened.
        """
        with self._cursor() as cur:
            cur.execute(
                "SELECT pause_duration FROM filter_settings WHERE id = 1 AND enabled = 0"
            )
            row = cur.fetchone()
            if row and row[0] == "until_reboot":
                cur.execute(
                    "UPDATE filter_settings SET enabled = 1, pause_duration = NULL, "
                    "pause_resume_at = NULL, pause_reason = NULL, updated_at = ? WHERE id = 1",
                    (time.time(),),
                )
                return True
            return False

    # ---- Gate^Flame Shield (per-device VPN) -----------------------------

    def list_vpn_devices(self) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT mac, region, enabled, preauth_key IS NOT NULL, provider, updated_at "
                "FROM vpn_devices ORDER BY updated_at DESC"
            )
            return [
                {
                    "mac": r[0],
                    "region": r[1],
                    "enabled": bool(r[2]),
                    "peerRegistered": bool(r[3]),
                    "provider": r[4] or "headscale",
                    "updatedAt": r[5],
                }
                for r in cur.fetchall()
            ]

    def get_vpn_device(self, mac: str) -> dict | None:
        with self._cursor() as cur:
            cur.execute(
                "SELECT mac, region, enabled, preauth_key IS NOT NULL, provider, updated_at "
                "FROM vpn_devices WHERE mac = ?",
                (mac,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            return {
                "mac": row[0],
                "region": row[1],
                "enabled": bool(row[2]),
                "peerRegistered": bool(row[3]),
                "provider": row[4] or "headscale",
                "updatedAt": row[5],
            }

    def set_vpn_device(
        self, mac: str, region: str | None, enabled: bool, provider: str = "headscale"
    ) -> None:
        """The owner's choice for one device. Recorded even if applying it
        against the control plane then fails - vpn.py keeps the intent
        separate from whether it has been made real yet, same split
        filter_settings makes between 'enabled' and whether gravity actually
        holds the domains that implies.

        `provider` says which backend this region choice belongs to
        (headscale or vpngate) - a code like "us" and a code like "US" both
        exist independently per-provider, and this column is what keeps a
        device's Headscale exit choice and its VPN Gate country choice from
        ever being confused with one another."""
        now = time.time()
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO vpn_devices (mac, region, enabled, provider, updated_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(mac) DO UPDATE SET region = ?, enabled = ?, provider = ?, updated_at = ?",
                (mac, region, int(enabled), provider, now, region, int(enabled), provider, now),
            )

    def set_vpn_device_preauth(self, mac: str, preauth_key: str | None) -> None:
        with self._cursor() as cur:
            cur.execute(
                "UPDATE vpn_devices SET preauth_key = ?, updated_at = ? WHERE mac = ?",
                (preauth_key, time.time(), mac),
            )
