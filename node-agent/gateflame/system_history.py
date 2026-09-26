"""On-box system history - GET /api/v1/history/system.

A sampler thread records CPU %, memory %, temperature and disk % once a minute
into `.DUMP/history/system.db`, so a screen can show "the last 30 days of this
box" from the box itself, with nothing leaving the LAN.

STORAGE, AND WHY IT IS SHAPED LIKE THIS

  samples  raw rows, one a minute, kept 48 hours
  hourly   one row per whole hour: the average of that hour's raw rows plus
           how many there were, kept 90 days
  meta     `first_sample_at` - the first sample EVER, so a screen can say
           "history since ..." truthfully even after the raw rows are pruned

  SQLite, WAL, synchronous=NORMAL: an append a minute costs one WAL write and
  no fsync; checkpoints do the syncing. On an SD card that is the difference
  between a history feature and a wear-out feature.

THE ROLLUP BOUNDARY (the bug fleet/app.py `_rollup_and_prune` already had once)

  A cutoff in the middle of an hour rolls up a PARTIAL hour and then deletes the
  rest of that hour's raw rows before they are ever counted - a biased average,
  permanently. So both operations here work on WHOLE hours only:

    * every hour that has ENDED is (re)computed from raw rows, INSERT ... ON
      CONFLICT DO UPDATE, so an hour first rolled up while still recent is
      simply recomputed, identically, until its raw rows go;
    * raw rows are deleted only below a cutoff floored to the hour, so a given
      hour's raw rows are either all present or all gone - an hour is never
      recomputed from half its data.

READS

  24h -> 5-minute averages of raw rows              (<= 289 points)
  7d  -> hourly rows, plus the current hour from raw (<= 169 points)
  30d -> hourly rows re-averaged into 3-hour buckets (<= 241 points),
         weighted by sample count

  Buckets are aligned to Unix time and `t` is a bucket START. Buckets with no
  samples are absent (the box was off - load shedding - is not "0 % CPU").
  A metric that could not be read is NULL in the row and null in the point.

FAILURE

  An unwritable data root does not stop the agent. The sampler does not start,
  and the route answers `points: []` with a `gap` naming why. Nothing here may
  raise into a request.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from contextlib import contextmanager

import psutil

from . import datadir, telemetry

logger = logging.getLogger("gateflame.system_history")

RAW_RETENTION_SECONDS = 48 * 3600
HOURLY_RETENTION_SECONDS = 90 * 86_400

WINDOWS: dict[str, dict] = {
    "24h": {"seconds": 86_400, "step": 300, "resolution": "5 minute averages"},
    "7d": {"seconds": 7 * 86_400, "step": 3_600, "resolution": "hourly averages"},
    "30d": {"seconds": 30 * 86_400, "step": 10_800, "resolution": "3 hour averages"},
}
DEFAULT_WINDOW = "24h"

SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
    t INTEGER PRIMARY KEY,
    cpu REAL,
    mem REAL,
    temp REAL,
    disk REAL
);
CREATE TABLE IF NOT EXISTS hourly (
    hour INTEGER PRIMARY KEY,   -- Unix time // 3600
    cpu REAL,
    mem REAL,
    temp REAL,
    disk REAL,
    n INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_METRICS = ("cpu", "mem", "temp", "disk")


def db_path() -> str:
    return datadir.path("history", "system.db")


def _round(v):
    return None if v is None else round(float(v), 1)


class SystemHistory:
    """The store. One per process; thread-safe; never raises out of a method
    that a route calls - it records `gap` instead."""

    def __init__(self, path: str | None = None, clock=time.time):
        self.path = path or db_path()
        self._clock = clock
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None
        self.gap: str | None = None
        self._last_rollup_hour: int | None = None

    # ------------------------------------------------------------- lifecycle

    def open(self) -> bool:
        """Open (creating if needed). False, with `gap` set, when it cannot."""
        with self._lock:
            if self._conn is not None:
                return True
            try:
                os.makedirs(os.path.dirname(self.path), exist_ok=True)
                conn = sqlite3.connect(self.path, check_same_thread=False, timeout=5.0)
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.executescript(SCHEMA)
                conn.commit()
            except (OSError, sqlite3.Error) as exc:
                self.gap = f"system history storage is unavailable ({self.path}): {exc}"
                logger.warning("%s", self.gap)
                return False
            self._conn = conn
            self.gap = None
            return True

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except sqlite3.Error:
                    pass
                self._conn = None

    @contextmanager
    def _tx(self):
        with self._lock:
            if self._conn is None:
                raise sqlite3.OperationalError("system history store is not open")
            try:
                yield self._conn
                self._conn.commit()
            except BaseException:
                self._conn.rollback()
                raise

    # ---------------------------------------------------------------- writes

    def record(self, t: float, cpu, mem, temp, disk) -> bool:
        """Store one sample. False (never raises) when the write fails."""
        ts = int(t)
        try:
            with self._tx() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO samples (t, cpu, mem, temp, disk) VALUES (?, ?, ?, ?, ?)",
                    (ts, _round(cpu), _round(mem), _round(temp), _round(disk)),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO meta (key, value) VALUES ('first_sample_at', ?)", (str(ts),)
                )
        except sqlite3.Error as exc:
            self.gap = f"system history could not be written: {exc}"
            logger.warning("%s", self.gap)
            return False
        self.gap = None
        return True

    def rollup_and_prune(self, now: float | None = None) -> None:
        """Fold every ENDED hour into `hourly`; prune on whole-hour cutoffs only."""
        now = self._clock() if now is None else now
        current_hour_start = int(now) - int(now) % 3600
        raw_cutoff = int(now - RAW_RETENTION_SECONDS) - int(now - RAW_RETENTION_SECONDS) % 3600
        hourly_cutoff_hour = int(now - HOURLY_RETENTION_SECONDS) // 3600
        with self._tx() as conn:
            conn.execute(
                """
                INSERT INTO hourly (hour, cpu, mem, temp, disk, n)
                SELECT t / 3600, AVG(cpu), AVG(mem), AVG(temp), AVG(disk), COUNT(*)
                  FROM samples
                 WHERE t < ?
                 GROUP BY t / 3600
                ON CONFLICT(hour) DO UPDATE SET
                    cpu = excluded.cpu, mem = excluded.mem, temp = excluded.temp,
                    disk = excluded.disk, n = excluded.n
                """,
                (current_hour_start,),
            )
            conn.execute("DELETE FROM samples WHERE t < ?", (raw_cutoff,))
            conn.execute("DELETE FROM hourly WHERE hour < ?", (hourly_cutoff_hour,))
        self._last_rollup_hour = current_hour_start // 3600

    def maybe_rollup(self, now: float | None = None) -> None:
        """rollup_and_prune() once per hour, on the first tick after an hour ends."""
        now = self._clock() if now is None else now
        hour = int(now) // 3600
        if self._last_rollup_hour == hour:
            return
        try:
            self.rollup_and_prune(now)
        except sqlite3.Error as exc:
            logger.warning("system history rollup failed: %s", exc)

    # ----------------------------------------------------------------- reads

    def first_sample_at(self) -> int | None:
        try:
            with self._tx() as conn:
                row = conn.execute("SELECT value FROM meta WHERE key = 'first_sample_at'").fetchone()
        except sqlite3.Error:
            return None
        try:
            return int(row[0]) if row else None
        except (TypeError, ValueError):
            return None

    def points(self, window: str, now: float | None = None) -> list[dict]:
        now = self._clock() if now is None else now
        spec = WINDOWS[window]
        since = int(now) - spec["seconds"]
        if window != "24h":
            # The hourly table must hold every ENDED hour before it is read,
            # or the hour that just finished would be missing until the
            # sampler's next tick got round to rolling it up.
            self.maybe_rollup(now)
        with self._tx() as conn:
            if window == "24h":
                step = spec["step"]
                rows = conn.execute(
                    f"""
                    SELECT (t / {step}) * {step} AS b, AVG(cpu), AVG(mem), AVG(temp), AVG(disk)
                      FROM samples WHERE t >= ? GROUP BY b ORDER BY b
                    """,
                    (since - since % step,),
                ).fetchall()
            elif window == "7d":
                current_hour_start = int(now) - int(now) % 3600
                rows = conn.execute(
                    """
                    SELECT hour * 3600 AS b, cpu, mem, temp, disk
                      FROM hourly WHERE hour >= ? AND hour * 3600 < ?
                    UNION ALL
                    SELECT (t / 3600) * 3600 AS b, AVG(cpu), AVG(mem), AVG(temp), AVG(disk)
                      FROM samples WHERE t >= ? GROUP BY t / 3600
                    ORDER BY b
                    """,
                    (since // 3600, current_hour_start, current_hour_start),
                ).fetchall()
            else:  # 30d
                per = spec["step"] // 3600
                rows = conn.execute(
                    f"""
                    SELECT (hour / {per}) * {per} * 3600 AS b,
                           SUM(cpu * n) / SUM(CASE WHEN cpu IS NOT NULL THEN n END),
                           SUM(mem * n) / SUM(CASE WHEN mem IS NOT NULL THEN n END),
                           SUM(temp * n) / SUM(CASE WHEN temp IS NOT NULL THEN n END),
                           SUM(disk * n) / SUM(CASE WHEN disk IS NOT NULL THEN n END)
                      FROM hourly WHERE hour >= ?
                     GROUP BY hour / {per} ORDER BY b
                    """,
                    ((since // 3600) - (since // 3600) % per,),
                ).fetchall()
        return [
            {"t": int(r[0]), "cpu": _round(r[1]), "memPct": _round(r[2]),
             "tempC": _round(r[3]), "diskPct": _round(r[4])}
            for r in rows
        ]


def read_sample() -> tuple[float | None, float | None, float | None, float | None]:
    """(cpu %, mem %, temp C, disk %) from the same readers telemetry uses.

    CPU is non-blocking: psutil's per-thread "since the last call" figure, so
    on a 60 s sampler each value is the average over the minute since the
    previous one - a better number than a 100 ms spot reading, at no cost.
    """
    def safe(fn):
        try:
            return fn()
        except Exception:  # noqa: BLE001 - one unreadable metric is a null, not a lost sample
            return None

    cpu = safe(lambda: psutil.cpu_percent(interval=None))
    mem = safe(lambda: psutil.virtual_memory().percent)
    temp = safe(telemetry.read_thermal_c)
    disk = safe(lambda: psutil.disk_usage("/").percent)
    return cpu, mem, temp, disk


class SystemSampler:
    """The 60-second sampler thread. Started by the app's lifespan only."""

    def __init__(self, store: SystemHistory, interval: float = 60.0, reader=read_sample, clock=time.time):
        self.store = store
        self.interval = max(1.0, float(interval))
        self._reader = reader
        self._clock = clock
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> bool:
        """Start sampling. False (and the store's `gap` set) if storage is unusable."""
        if self.running:
            return True
        if not self.store.open():
            return False
        self._stop.clear()
        try:
            psutil.cpu_percent(interval=None)   # prime; the first reading is meaningless
        except Exception:  # noqa: BLE001
            pass
        self._thread = threading.Thread(target=self._run, name="gateflame-history", daemon=True)
        self._thread.start()
        return True

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout)
        self._thread = None

    def tick(self) -> None:
        """One sample (and, once an hour, the rollup). Exposed for tests."""
        now = self._clock()
        cpu, mem, temp, disk = self._reader()
        self.store.record(now, cpu, mem, temp, disk)
        self.store.maybe_rollup(now)

    def _run(self) -> None:
        # First real sample one interval after the priming call, so CPU is a
        # real average rather than the "since import" artefact.
        while not self._stop.wait(self.interval):
            try:
                self.tick()
            except Exception:  # noqa: BLE001 - the sampler must never take the agent down
                logger.exception("system history tick failed")


# ------------------------------------------------------------------ the route

# Built lazily: importing this module must not touch the disk (the same rule
# main.py's own imports are held to - see tests/test_import_side_effects.py).
_store: SystemHistory | None = None
_sampler: SystemSampler | None = None
_state_lock = threading.Lock()


def get_store() -> SystemHistory:
    """The process-wide store, bound to the data root on first use."""
    global _store
    with _state_lock:
        if _store is None:
            _store = SystemHistory()
        return _store


def init(path: str | None = None) -> SystemHistory:
    """(Re)bind the process-wide store to `path` (default: the data root)."""
    global _store
    with _state_lock:
        old, _store = _store, SystemHistory(path)
    if old is not None:
        old.close()
    return _store


def start_sampler(interval: float = 60.0) -> SystemSampler | None:
    """Start the process-wide sampler. None when storage is unusable (gap recorded)."""
    global _sampler
    with _state_lock:
        if _sampler is not None and _sampler.running:
            return _sampler
    sampler = SystemSampler(get_store(), interval=interval)
    if not sampler.start():
        return None
    with _state_lock:
        _sampler = sampler
    return sampler


def stop_sampler() -> None:
    global _sampler
    with _state_lock:
        sampler, _sampler = _sampler, None
    if sampler is not None:
        sampler.stop()
        sampler.store.close()


def sampling() -> bool:
    s = _sampler
    return s is not None and s.running


def history(window: str = DEFAULT_WINDOW, now: float | None = None) -> dict:
    """The contract payload for `window`. Never raises for a valid window."""
    if window not in WINDOWS:
        raise ValueError(f"unknown window {window!r}; expected one of {sorted(WINDOWS)}")
    spec = WINDOWS[window]
    sampler = _sampler
    payload = {
        "window": window,
        "stepSeconds": spec["step"],
        "resolution": spec["resolution"],
        "points": [],
        "since": None,
        "gap": None,
        "sampling": sampling(),
        "sampleIntervalSeconds": int(sampler.interval) if sampler is not None else None,
    }
    current = get_store()
    if not current.open():
        payload["gap"] = current.gap
        return payload
    try:
        payload["points"] = current.points(window, now)
        payload["since"] = current.first_sample_at()
    except sqlite3.Error as exc:
        payload["gap"] = f"system history could not be read: {exc}"
        return payload
    if current.gap:
        payload["gap"] = current.gap
    elif not payload["sampling"]:
        payload["gap"] = (
            "the history sampler is not running on this box, so no new points are being "
            "recorded; what is shown stops at the last stored sample"
        )
    return payload
