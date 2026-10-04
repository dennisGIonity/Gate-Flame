"""SQLite persistence. One connection, one lock - the load is a handful of devices
reporting every 30 s, not a database problem."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any

from .config import RETENTION_DAYS, data_path

SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, label TEXT, first_seen REAL, last_seen REAL, ip TEXT, fw TEXT,
  level TEXT, status TEXT, boot TEXT, filter_version INTEGER, allow_version INTEGER,
  last TEXT);
CREATE TABLE IF NOT EXISTS telemetry (
  ts REAL, device_id TEXT, boot TEXT, q INTEGER, blk INTEGER, fwd INTEGER, tmo INTEGER,
  rssi INTEGER, heap INTEGER, status TEXT);
CREATE INDEX IF NOT EXISTS tel_dev_ts ON telemetry(device_id, ts);
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, cmd TEXT, arg TEXT, created REAL,
  delivered REAL, result_ok INTEGER, result TEXT, result_ts REAL);
CREATE TABLE IF NOT EXISTS filters (
  level TEXT, version INTEGER, path TEXT, size INTEGER, sha256 TEXT, sig TEXT, n INTEGER,
  m INTEGER, k INTEGER, fp REAL, built REAL, sources TEXT, PRIMARY KEY(level, version));
CREATE TABLE IF NOT EXISTS allowlist (domain TEXT PRIMARY KEY, added REAL, note TEXT);
CREATE TABLE IF NOT EXISTS events (ts REAL, device_id TEXT, kind TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS device_tokens (
  device_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created REAL, last_used REAL, revoked REAL);
CREATE TABLE IF NOT EXISTS firmware (
  version TEXT PRIMARY KEY, path TEXT, size INTEGER, sha256 TEXT, sig TEXT, uploaded REAL, notes TEXT);
"""


class Store:
    def __init__(self, path=None):
        self.db = sqlite3.connect(str(path or data_path("t1.db")), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript(SCHEMA)
            self.db.commit()

    def q(self, sql: str, args: tuple = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def x(self, sql: str, args: tuple = ()) -> int:
        with self.lock:
            cur = self.db.execute(sql, args)
            self.db.commit()
            return cur.lastrowid

    def event(self, kind: str, detail: str, device_id: str | None = None) -> None:
        self.x("INSERT INTO events VALUES (?,?,?,?)", (time.time(), device_id, kind, detail))

    def kv_get(self, k: str, default: Any = None) -> Any:
        r = self.q("SELECT v FROM kv WHERE k=?", (k,))
        return json.loads(r[0]["v"]) if r else default

    def kv_set(self, k: str, v: Any) -> None:
        self.x("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v)))

    def prune(self) -> None:
        cut = time.time() - RETENTION_DAYS * 86400
        self.x("DELETE FROM telemetry WHERE ts<?", (cut,))
        self.x("DELETE FROM events WHERE ts<?", (time.time() - 30 * 86400,))  # events: 30 days
