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

import os
import threading
import time

import httpx

from . import content_categories, threat_level
from .config import config
from .pihole import _base, _get, _session, summary

_TIMEOUT = 30.0

# The gravity rebuild gets its OWN timeout, and it is large.
#
# This module's docstring says a rebuild is "tens of seconds on a Pi". The
# gravity POST was nonetheless sent with _TIMEOUT, the same 30s used for a
# list add. On 2026-09-06 a High-level change took the box from 347,905
# domains to 3.08 million; the rebuild ran for minutes, httpx gave up at 30
# seconds, and apply() recorded "gravity rebuild failed" while Pi-hole
# finished the job perfectly and logged "Gravity database has been updated".
#
# So the threat-level dial appeared to fail BECAUSE it was asked to do more
# work. Every larger list made it more likely, which is precisely backwards.
_GRAVITY_TIMEOUT = float(os.environ.get("GATEFLAME_GRAVITY_TIMEOUT", "900"))

# After the POST gives up, how long to keep asking Pi-hole whether it finished
# anyway, and how often. A slow box must not be called broken.
_GRAVITY_VERIFY_SECONDS = float(os.environ.get("GATEFLAME_GRAVITY_VERIFY_SECONDS", "600"))
_GRAVITY_VERIFY_INTERVAL = 5.0

# Guards a rebuild. Two overlapping gravity runs corrupt the database, and a
# customer flipping three toggles quickly is entirely normal.
_lock = threading.Lock()
_applying = False
_last_error: str | None = None


def is_applying() -> bool:
    return _applying


def last_error() -> str | None:
    return _last_error


def forget_error() -> None:
    """Drop a recorded error that observation has since contradicted.

    `_last_error` is sticky: it is cleared only by a successful apply. If the
    underlying problem gets fixed by anything OTHER than this agent - an
    engineer running `pihole -g`, a container restart, a manual list edit - the
    error outlives the fault and the box reports degraded while it is visibly
    filtering. Found exactly that way on 2026-08-24.

    A false "degraded" is not harmless. It is the same class of error as a false
    "active", just pointed the other way, and a customer who is told they are
    unprotected while they are protected learns to ignore the status.

    Only called after Pi-hole has been asked and has contradicted the error.
    """
    global _last_error
    _last_error = None


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


def _post(path: str, payload: dict, timeout: float | None = None) -> dict | None:
    base = _base()
    if not base:
        return None
    sid = _session(base)
    if not sid:
        return None
    try:
        r = httpx.post(
            f"{base}{path}",
            headers={"sid": sid},
            json=payload,
            timeout=_TIMEOUT if timeout is None else timeout,
        )
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


def _gravity_finished(domains_before: int) -> bool:
    """Did the rebuild complete, whatever the HTTP connection did?

    Called only after the gravity POST failed or timed out. The connection
    dropping says nothing about Pi-hole: on a slow box, or a very large list
    set, the rebuild routinely outlives any sane HTTP timeout and completes
    normally afterwards. Declaring failure at that moment is how a working
    box gets reported broken.

    "Finished" means Pi-hole is answering again AND the gravity domain count
    has moved. A count that is merely non-zero is not enough - the PREVIOUS
    build was also non-zero, and mistaking it for the new one is how a failed
    apply gets reported as success.

    Returns False if the box never comes back or the count never changes,
    which is a real failure and should be recorded as one.
    """
    deadline = time.monotonic() + _GRAVITY_VERIFY_SECONDS
    while time.monotonic() < deadline:
        time.sleep(_GRAVITY_VERIFY_INTERVAL)
        stats = summary()
        if stats is None:
            continue  # still busy or still restarting; not yet an answer
        now = stats.get("domainsOnGravity") or 0
        if now and now != domains_before:
            return True
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
    global _last_error

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
        # `type` GOES IN THE QUERY STRING, NOT THE BODY. Sending it in the body
        # gets HTTP 400 from Pi-hole v6:
        #
        #   Invalid request: Specify type parameter (should be either "allow" or "block")
        #
        # Confirmed against the live v6 container on 2026-08-24: body-only is 400,
        # `?type=block` is 201. The delete call below has always used the query
        # form; only the add was wrong, and because its return value was
        # discarded the 400 was invisible for eight days.
        if _post("/api/lists?type=block", {"address": url, "enabled": True}) is None:
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
    #
    # NEVER CLAIM FAILURE WITHOUT A READ-BACK EITHER. This project's standing
    # rule is "never claim success without a read-back" - see `confirmed`
    # above. 2026-09-06 showed the mirror image is just as damaging: this line
    # claimed FAILURE without one. The POST timed out at 30s on a rebuild that
    # legitimately took minutes, and the box reported "gravity rebuild failed"
    # while Pi-hole was mid-rebuild and about to succeed. Result: the threat
    # dial was reported broken for hours while working.
    #
    # A dropped connection tells us nothing about what Pi-hole did. Only
    # Pi-hole can say that, so ask it.
    before = summary() or {}
    domains_before = before.get("domainsOnGravity") or 0

    if _post("/api/action/gravity", {}, timeout=_GRAVITY_TIMEOUT) is None:
        if not _gravity_finished(domains_before):
            _last_error = (
                "gravity rebuild did not finish - Pi-hole stopped responding and "
                "the domain count did not change"
            )
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
