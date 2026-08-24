"""Applying the owner's filtering choices to Pi-hole.

Translates the three settings - threat level, content categories, paused - into
Pi-hole's blocklist configuration, then rebuilds gravity so they take effect.

WHY THIS RUNS IN THE BACKGROUND

Rebuilding gravity downloads every list and rebuilds the domain database. On a
Pi that is tens of seconds, and on the Orange Pi Zero 2W base model it will be
longer. An HTTP handler that blocked for that long would be assumed broken and
the customer would tap the toggle again, queueing a second rebuild behind the
first.

So the routes return the new state immediately and the work happens on a
thread. The UI shows what the owner chose; `applying` tells it a rebuild is
still running so it can show a spinner rather than implying the change has
already taken hold.

WHY PAUSE REMOVES THE LISTS RATHER THAN DISABLING PI-HOLE

Pi-hole has its own disable API, but using it would put the truth in two places
- our `enabled` flag and Pi-hole's - which can disagree after a container
restart. Instead a pause pushes an EMPTY blocklist set. Pi-hole stays up,
resolving normally through Unbound, blocking nothing. One source of truth, and
the resolver never stops answering, which matters because the household's
internet depends on it.
"""

from __future__ import annotations

import threading

import httpx

from . import content_categories, threat_level
from .config import config
from .pihole import _get, _session, _base, summary

_TIMEOUT = 30.0

# Guards a rebuild. Two overlapping gravity runs corrupt the database, and a
# customer flipping three toggles quickly is entirely normal.
_lock = threading.Lock()
_applying = False
_last_error: str | None = None


def is_applying() -> bool:
    return _applying


def last_error() -> str | None:
    return _last_error


def desired_lists(settings: dict) -> list[str]:
    """Every blocklist URL implied by the owner's current settings.

    Paused returns an empty list - Pi-hole keeps resolving, blocks nothing.
    """
    if not settings.get("enabled", True):
        return []
    urls = list(threat_level.lists_for(settings.get("threat_level")))
    urls.extend(content_categories.lists_for(settings.get("categories")))
    seen: set[str] = set()
    return [u for u in urls if not (u in seen or seen.add(u))]


def _post(path: str, payload: dict) -> dict | None:
    base = _base()
    if not base:
        return None
    sid = _session(base)
    if not sid:
        return None
    try:
        r = httpx.post(f"{base}{path}", headers={"sid": sid}, json=payload, timeout=_TIMEOUT)
        if r.status_code not in (200, 201):
            return None
        return r.json()
    except (httpx.HTTPError, ValueError):
        return None


def _delete(path: str) -> bool:
    base = _base()
    if not base:
        return False
    sid = _session(base)
    if not sid:
        return False
    try:
        r = httpx.delete(f"{base}{path}", headers={"sid": sid}, timeout=_TIMEOUT)
        return r.status_code in (200, 204)
    except httpx.HTTPError:
        return False


def current_lists() -> list[str] | None:
    """Blocklist URLs Pi-hole currently has, or None if it cannot be reached."""
    data = _get("/api/lists")
    if data is None:
        return None
    return [entry.get("address", "") for entry in data.get("lists", []) if entry.get("address")]


def apply(settings: dict) -> bool:
    """Make Pi-hole's lists match `settings`, then rebuild gravity.

    Synchronous. Returns False and records last_error() on any failure - and a
    failure here means the box is still filtering by the PREVIOUS settings,
    which is a safe place to fail: protection does not drop, it just does not
    change.
    """
    global _applying, _last_error

    wanted = set(desired_lists(settings))
    existing = current_lists()
    if existing is None:
        _last_error = "Pi-hole unreachable"
        return False
    have = set(existing)

    # EVERY WRITE IS CHECKED. The first version of this loop threw both return
    # values away:
    #
    #     for url in wanted - have:
    #         _post("/api/lists", {...})
    #
    # `_post` returns None on any non-2xx, so a rejected add was indistinguishable
    # from a successful one. The gravity rebuild below then succeeded - rebuilding
    # an EMPTY list works perfectly well - `_last_error` was cleared, and apply()
    # returned True having written nothing.
    #
    # That is how GF-72TYTITQ ran from the day it was built to 2026-08-24 with an
    # empty adlist, an empty gravity, 131,068 unfiltered queries, and every status
    # in the product reading green.
    failed: list[str] = []
    for url in have - wanted:
        if not _delete(f"/api/lists/{url}?type=block"):
            failed.append(f"could not remove {url}")
    for url in wanted - have:
        if _post("/api/lists", {"address": url, "type": "block", "enabled": True}) is None:
            failed.append(f"Pi-hole rejected {url}")

    if failed:
        _last_error = "; ".join(failed[:3])
        return False

    # READ BACK BEFORE CLAIMING ANYTHING. "Never claim success without a
    # read-back" is a standing rule in this project, written after a router
    # reported a setting saved that it had not saved. The same rule applies to
    # our own writes: a 200 means Pi-hole accepted the request, not that the list
    # is there.
    confirmed = current_lists()
    if confirmed is None:
        _last_error = "Pi-hole stopped answering while the blocklist was being written"
        return False
    if not wanted.issubset(set(confirmed)):
        missing = sorted(wanted - set(confirmed))
        _last_error = f"the blocklist did not take - Pi-hole does not have {missing[0]}"
        return False

    # Rebuild gravity so the changes are live. Without this the list table has
    # changed and the resolver has not.
    if _post("/api/action/gravity", {}) is None:
        _last_error = "gravity rebuild failed"
        return False

    # And read back ONE more time, because a gravity rebuild that runs cleanly
    # over a list it could not download leaves zero domains and reports success -
    # which is the exact shape of the original fault, one layer further in.
    if wanted:
        after = summary()
        if after is not None and not after.get("domainsOnGravity"):
            _last_error = (
                "the blocklist is registered but downloaded no domains - "
                "check the box can reach the internet"
            )
            return False

    _last_error = None
    return True


def reconcile(store) -> bool:
    """Make reality match intent, but only do work when they differ.

    WHY THIS EXISTS. `apply()` ran only when a setting CHANGED. Nothing ever
    compared Pi-hole's actual state against the owner's intent, so a box that
    came up with an empty blocklist stayed empty forever - no error, no retry,
    every local signal healthy, and the only route back was a human PUTting a
    threat level it already had. A customer has no such command.

    Cheap on the normal path: two reads and no rebuild when things already
    agree. That matters on a household that loses power weekly - reboot must not
    mean a full gravity download every time.
    """
    global _last_error

    settings = store.get_filter_settings()
    wanted = set(desired_lists(settings))

    have = current_lists()
    if have is None:
        _last_error = "Pi-hole unreachable"
        return False

    if set(have) != wanted:
        return apply(settings)

    # The lists agree. That is not the same as being protected: the list can be
    # registered and gravity still empty, which is precisely the state this box
    # was found in.
    if wanted:
        stats = summary()
        if stats is not None and not stats.get("domainsOnGravity"):
            return apply(settings)

    _last_error = None
    return True


def reconcile_async(store) -> None:
    """Run reconcile() on a thread. Safe to call at startup."""
    global _applying

    if not config.pihole_api_url:
        return

    with _lock:
        if _applying:
            return
        _applying = True

    def _run() -> None:
        global _applying
        try:
            reconcile(store)
        finally:
            _applying = False

    threading.Thread(target=_run, daemon=True, name="gateflame-reconcile").start()


def apply_async(store) -> None:
    """Kick off apply() on a thread, reading settings from the store.

    Silently does nothing if a rebuild is already running. Queueing them would
    only mean the customer waits longer for the same end state, since the last
    write already reflects every toggle they pressed.
    """
    global _applying

    if not config.pihole_api_url:
        return

    with _lock:
        if _applying:
            return
        _applying = True

    def _run() -> None:
        global _applying
        try:
            apply(store.get_filter_settings())
        finally:
            _applying = False

    threading.Thread(target=_run, daemon=True, name="gateflame-blocklists").start()
