"""A small thread-safe TTL cache with single-flight loading.

WHY THIS EXISTS

The kiosk polls /telemetry/summary every 4 s and /filtering every 5 s, the
paired phone polls the same routes, and IoniBot probes on top. Before this, every
one of those polls made its own authenticated round trip to Pi-hole - and
/telemetry/summary made TWO (summary() and then reachable(), which asked Pi-hole
the identical question a second time). Three surfaces open at once meant several
identical Pi-hole reads a second, all answering the same thing.

WHAT IT GUARANTEES

  * At most one load per key is in flight. Concurrent callers of a stale key wait
    for that one load instead of each starting their own ("single-flight").
  * A value is served for at most `ttl` seconds after it was LOADED.
  * `invalidate()` wins against a load that was already in flight: a value whose
    load started before the invalidation is returned to the caller that asked
    for it, but is never stored. That is what stops the cache from hiding a state
    change the agent itself just made - the next reader goes back to the source.

WHAT IT IS NOT

It is not a store of truth. Callers must treat returned values as read-only and
must not cache anything they could not afford to show for `ttl` seconds.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Hashable


@dataclass
class _Entry:
    value: Any
    loaded_at: float
    ttl: float


class TTLCache:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: dict[Hashable, _Entry] = {}
        self._key_locks: dict[Hashable, threading.Lock] = {}
        self._generation = 0

    def _key_lock(self, key: Hashable) -> threading.Lock:
        with self._lock:
            lock = self._key_locks.get(key)
            if lock is None:
                lock = self._key_locks[key] = threading.Lock()
            return lock

    def _fresh(self, key: Hashable) -> tuple[bool, Any]:
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and (self._clock() - entry.loaded_at) < entry.ttl:
                return True, entry.value
            return False, None

    def get(
        self,
        key: Hashable,
        loader: Callable[[], Any],
        ttl: float,
        *,
        failure_ttl: float | None = None,
        is_failure: Callable[[Any], bool] | None = None,
    ) -> Any:
        """The cached value for `key`, loading it with `loader()` when stale.

        `failure_ttl` (default: `ttl`) applies when `is_failure(value)` is true,
        so a failed read can be retried sooner than a good one is refreshed.
        A `ttl` of 0 or less disables caching for the call entirely.
        """
        if ttl <= 0:
            return loader()

        hit, value = self._fresh(key)
        if hit:
            return value

        with self._key_lock(key):
            # Someone else may have loaded it while we waited for the key lock.
            hit, value = self._fresh(key)
            if hit:
                return value

            with self._lock:
                generation = self._generation
            value = loader()
            keep = ttl
            if is_failure is not None and failure_ttl is not None and is_failure(value):
                keep = failure_ttl
            with self._lock:
                # An invalidation that landed while we were loading means this
                # value may predate a write. Hand it to our caller, do not keep it.
                if generation == self._generation and keep > 0:
                    self._entries[key] = _Entry(value=value, loaded_at=self._clock(), ttl=keep)
            return value

    def invalidate(self, key: Hashable | None = None) -> None:
        """Forget `key`, or everything. Also voids any load already in flight."""
        with self._lock:
            self._generation += 1
            if key is None:
                self._entries.clear()
            else:
                self._entries.pop(key, None)

    def peek(self, key: Hashable) -> Any:
        """The stored value if still fresh, else None. Never loads."""
        hit, value = self._fresh(key)
        return value if hit else None
