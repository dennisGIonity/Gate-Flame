"""DNS query history, proxied from Pi-hole's own history - GET /api/v1/dns/history.

Real from the first minute: nothing new is stored on the box. Pi-hole already
keeps a 24-hour in-memory activity series and a long-term query database; this
module reads them and reshapes them into one small contract.

THE SOURCE, CHECKED AGAINST FTL v6.7.1 (api-docs.tar.gz and src/), not memory:

  GET /api/history
      {"history": [{"timestamp", "total", "cached", "blocked", "forwarded"}, ...]}
      One entry per 10-minute overTime slot (OVERTIME_INTERVAL = 600) covering
      the last 24 h. The timestamp is the slot CENTRE (src/overTime.c adds
      OVERTIME_INTERVAL/2), so it is floored here to the slot start.

  GET /api/history/database?from=<unix>&until=<unix>
      Same item shape, from the long-term database, in fixed 600 s slots
      (src/api/stats_database.c: `const int interval = 600`), timestamp = slot
      START. Slots in which nothing was stored are ABSENT, not zero.

THE CONTRACT (docs/BUILD-1.1.0-PLAN.md)

  window  stepSeconds  source                     points (max)
  24h     600          /api/history               ~145, passed through
  7d      3600         /api/history/database      <=169, 10-min slots summed per hour
  30d     21600        /api/history/database      <=121, summed per 6 hours

  {"window", "stepSeconds", "resolution", "source": "pihole", "points":
   [{"t", "total", "blocked", "cached", "forwarded"}], "gap", "fetchedAt"}

Buckets are aligned to UTC multiples of the step (Unix time), `t` is a bucket
START. Long-window points are SPARSE: a bucket with nothing stored is left
out rather than written as zero, because "the box was off" (weekly, here) and
"the household made no lookups" are different facts and a zero would claim the
second. The chart shows a gap where there is one.

NEVER 500. Every failure returns `points: []` and a `gap` that names what went
wrong - not configured, no password, password refused, no free API session, did
not answer - because each needs a different action (pihole.gap_for()).

CACHED: 60 s for 24h, 10 minutes for 7d/30d (the 30-day query walks the whole
query database on the Pi; the kiosk and the phone asking at once must not make
Pi-hole do it twice). A failure is cached for 10 s only, so recovery shows fast.
"""

from __future__ import annotations

import time

from . import pihole
from .ttlcache import TTLCache

WINDOWS: dict[str, dict] = {
    "24h": {"seconds": 86_400, "step": 600, "resolution": "10 minute totals", "ttl": 60.0},
    "7d": {"seconds": 7 * 86_400, "step": 3_600, "resolution": "1 hour totals", "ttl": 600.0},
    "30d": {"seconds": 30 * 86_400, "step": 21_600, "resolution": "6 hour totals", "ttl": 600.0},
}
DEFAULT_WINDOW = "24h"
SLOT_SECONDS = 600            # FTL's own slot, both endpoints
_FAILURE_TTL = 10.0
# The long-term query walks the whole database; a Pi 5 with 30 days of a busy
# household's queries is not a 4-second job.
_DATABASE_TIMEOUT = 25.0

_FIELDS = ("total", "blocked", "cached", "forwarded")

_cache = TTLCache()


def valid(window: str) -> bool:
    return window in WINDOWS


def invalidate() -> None:
    _cache.invalidate()


def _count(value) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _slots(history) -> list[dict] | None:
    """Pi-hole's `history` array as clean slot dicts, or None if it is not one."""
    if not isinstance(history, list):
        return None
    out: list[dict] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        try:
            ts = float(item.get("timestamp"))
        except (TypeError, ValueError):
            continue
        slot = {"t": int(ts) - int(ts) % SLOT_SECONDS}
        for field in _FIELDS:
            slot[field] = _count(item.get(field))
        out.append(slot)
    return out


def rebucket(slots: list[dict], step: int) -> list[dict]:
    """Sum 10-minute slots into `step`-second buckets aligned to Unix time.

    A field that was unknown (None) in every slot of a bucket stays None; a
    field known in some slots is the sum of the known ones. Buckets with no
    slots at all do not appear (see the module docstring on sparseness).
    """
    buckets: dict[int, dict] = {}
    for slot in slots:
        t = slot["t"] - slot["t"] % step
        b = buckets.setdefault(t, {"t": t, **{f: None for f in _FIELDS}})
        for field in _FIELDS:
            v = slot.get(field)
            if v is not None:
                b[field] = (b[field] or 0) + v
    return [buckets[t] for t in sorted(buckets)]


def _payload(window: str, points: list[dict], gap: str | None) -> dict:
    spec = WINDOWS[window]
    return {
        "window": window,
        "stepSeconds": spec["step"],
        "resolution": spec["resolution"],
        "source": "pihole",
        "points": points,
        "gap": gap,
        "fetchedAt": int(time.time()),
    }


def _load(window: str) -> dict:
    spec = WINDOWS[window]
    what = f"the {window} DNS history"
    if window == "24h":
        r = pihole.request("GET", "/api/history")
    else:
        until = int(time.time())
        since = until - spec["seconds"]
        r = pihole.request(
            "GET", f"/api/history/database?from={since}&until={until}", timeout=_DATABASE_TIMEOUT
        )
    if not r.ok:
        return _payload(window, [], pihole.gap_for(r.failure, what, r.detail))

    slots = _slots(r.data.get("history") if isinstance(r.data, dict) else None)
    if slots is None:
        return _payload(window, [], pihole.gap_for(pihole.FAIL_BAD_BODY, what))

    if window == "24h":
        cutoff = int(time.time()) - spec["seconds"] - SLOT_SECONDS
        points = sorted((s for s in slots if s["t"] >= cutoff), key=lambda s: s["t"])
    else:
        points = rebucket(slots, spec["step"])
    return _payload(window, points, None)


def history(window: str = DEFAULT_WINDOW) -> dict:
    """The contract payload for `window`. Never raises for a valid window."""
    if not valid(window):
        raise ValueError(f"unknown window {window!r}; expected one of {sorted(WINDOWS)}")
    try:
        return _cache.get(
            window,
            lambda: _load(window),
            WINDOWS[window]["ttl"],
            failure_ttl=_FAILURE_TTL,
            is_failure=lambda p: p.get("gap") is not None,
        )
    except Exception as exc:  # noqa: BLE001 - this route never 500s
        return _payload(window, [], f"the {window} DNS history could not be built: {type(exc).__name__}")
