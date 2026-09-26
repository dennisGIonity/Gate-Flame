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
from urllib.parse import quote

from . import content_categories, pihole, threat_level
from .config import config
from .pihole import _get, summary

_TIMEOUT = 30.0

# The gravity rebuild gets its OWN timeout, and it is large.
#
# The gravity POST used to be sent with _TIMEOUT - the same 30s as a list add.
# On 2026-09-06 a High-level change took the box from 347,905 domains to 3.08
# million, apply() recorded "gravity rebuild failed", and the threat dial went
# inert while Pi-hole was demonstrably still filtering.
#
# WHAT WAS MEASURED, because the first explanation of this was wrong.
#
# The initial diagnosis was "the rebuild takes minutes and 30s is too short".
# Then it got timed on the live Pi 5:
#
#     time docker exec gateflame-pihole pihole -g   ->  real 0m13.550s
#
# 3.08M domains, 13.5 seconds. The REBUILD was never the slow part, and 30s
# would have been ample for it. That theory was inference presented as fact.
#
# What that run also showed is where the time really goes. Four of the seven
# lists reported "No changes detected" - cached. The two that did fetch came
# back HTTP 503 from GitHub and fell back to their cached copies:
#
#     Status: Retrieval failed (exit_code=22 Msg: 503)
#     List download failed: using previously cached list
#
# A first apply after a threat-level change has NO cache. It pulls every list
# cold - the malicious list alone is 2.33M domains, tens of megabytes - over a
# household connection, through whatever retries a 503 provokes. That is the
# part that can outlast 30 seconds, and it scales with the customer's line
# speed, not with the box.
#
# So the number below is sized for a cold download on a slow link with
# retries, NOT for 3x a warm rebuild - 3x 13.5s is 41 seconds and would put
# the fault straight back. Per-box override exists because a rural ADSL line
# and a fibre line are not the same problem.
_GRAVITY_TIMEOUT = float(os.environ.get("GATEFLAME_GRAVITY_TIMEOUT", "600"))

# The backstop, and the part that actually decides truth. After the POST gives
# up, keep asking Pi-hole whether it finished anyway, for this long. Ten
# minutes on top of the ten above: twenty minutes of tolerance before anything
# is called broken. It runs on a background thread, so the console shows
# `applying` throughout rather than freezing or lying.
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
    """Authenticated POST. A dict on any 2xx (empty when the body is not JSON), None otherwise.

    Goes through pihole.request(), so it shares the one session and gets the
    same single silent re-auth on 401 as every read. The old copy here had no
    401 handling at all: a session Pi-hole had dropped made every list write
    read as "Pi-hole rejected <url>".
    """
    r = pihole.request("POST", path, json=payload,
                       timeout=_TIMEOUT if timeout is None else timeout, expect="any")
    if not r.ok:
        return None
    return r.data if isinstance(r.data, dict) else {}


def _delete(path: str) -> bool:
    return pihole.request("DELETE", path, timeout=_TIMEOUT, expect="none").ok


def _list_path(url: str) -> str:
    """`/api/lists/{list}` with the address percent-encoded, as Pi-hole's own web
    UI sends it (encodeURIComponent). FTL decodes the path before matching and
    documents that a list address arrives with its slashes decoded (FTL
    src/api/api.c, row_rank()). Sent raw, `https://…` puts `//`, `:` and any
    `?` of the address itself into the request line, where they are read as
    path and query syntax rather than as part of one item."""
    return f"/api/lists/{quote(url, safe='')}?type=block"


# Outcomes of the gravity POST. They need different handling, so they are not
# collapsed into one None the way every other write is.
GRAVITY_COMPLETED = "completed"   # HTTP 200 and the streamed output ran to its end
GRAVITY_REFUSED = "refused"       # Pi-hole answered, and not with a 200
GRAVITY_DROPPED = "dropped"       # timeout or connection lost - says nothing about Pi-hole


def _gravity_post(timeout: float) -> str:
    """Run `pihole -g` through the API and report how the HTTP side ended.

    THE BODY IS PLAIN TEXT, NOT JSON. FTL streams the gravity script's output
    with chunked encoding as text/plain (FTL v6.7.1 specs/action.yaml;
    src/api/action.c run_and_stream_command()). The status line is sent BEFORE
    the script runs, so it is 200 even when gravity then fails - a completed
    200 proves the run ended, not that it succeeded. `_gravity_marker()` is the
    authority on success.

    The previous implementation parsed this body as JSON. It never was JSON, so
    every gravity rebuild the agent ever triggered came back None - "failed" -
    and fell through to the domain-count backstop. That is why a re-apply of
    the SAME lists (count unchanged) always ended in `degraded` (PIN-2026-09-21
    §4 #3): the backstop could not tell "finished, same size" from "never ran".

    `Connection: close` because FTL writes a second JSON response onto the
    socket after the chunked body ends; nothing may reuse that connection.
    """
    r = pihole.request("POST", "/api/action/gravity", json={}, timeout=timeout,
                       expect="any", headers={"Connection": "close"})
    if r.ok:
        return GRAVITY_COMPLETED
    if r.failure in (pihole.FAIL_TIMEOUT, pihole.FAIL_UNREACHABLE):
        return GRAVITY_DROPPED
    return GRAVITY_REFUSED


def _gravity_marker() -> tuple[int | None, int | None] | None:
    """(gravity last_update stamp, domain count) read FRESH from Pi-hole, or None.

    `last_update` is FTL's copy of the gravity database's own `updated`
    property. gravity.sh writes that property on every run that builds and
    swaps in a new database, and FTL's database thread re-reads it once a
    second, logging "Gravity database has been updated, reloading now" when it
    moves (src/database/gravity-db.c, gravity_updated()). So it advancing means
    exactly what apply() needs to know: a NEW gravity exists AND FTL has loaded
    it - regardless of whether the domain count changed.
    """
    pihole.invalidate_cache()   # a cached read here would compare a value with itself
    stats = summary()
    if stats is None:
        return None
    return stats.get("gravityLastUpdate"), stats.get("domainsOnGravity")


def _stamp_verdict(before: tuple[int | None, int | None] | None,
                   now: tuple[int | None, int | None],
                   since: float | None) -> bool | None:
    """What the gravity timestamp says about a rebuild started at `since`.

    True   the stamp proves a build newer than the one before the POST
    False  the stamp is known and proves NO new build yet
    None   this FTL reports no stamp (0 / absent = unknown), so it says nothing

    When the stamp from just before the POST is known, the stamp must have
    moved past it - nothing else counts, so a clock that steps mid-rebuild
    cannot fake a result. Only when that earlier stamp could not be read does
    the POST's own start time stand in for it: gravity.sh stamps the database
    at the END of a build, with the same kernel clock this agent reads, so a
    stamp no older than the request is a build made after we asked.
    """
    stamp_now = now[0]
    if not stamp_now:
        return None
    stamp_before = before[0] if before else None
    if stamp_before:
        return stamp_now > stamp_before
    if since is not None:
        return stamp_now >= int(since) - 1
    return None


def _count_moved(before: tuple[int | None, int | None] | None,
                 now: tuple[int | None, int | None]) -> bool:
    """The old heuristic, for an FTL without a stamp. Keeps its caution: a count
    that is merely non-zero is not proof - the PREVIOUS build was non-zero too."""
    count_before = (before[1] if before else None) or 0
    count_now = now[1] or 0
    return bool(count_now) and count_now != count_before


def _gravity_finished(before: tuple[int | None, int | None] | None,
                      window: float | None = None,
                      *,
                      since: float | None = None,
                      interval: float | None = None,
                      trust_completed: bool = False) -> bool:
    """Did a rebuild complete, whatever the HTTP connection did?

    Polls Pi-hole (checking first, then waiting) until the rebuild is proven
    or `window` (default: the full verify window) runs out.

    `trust_completed` is for a POST whose streamed output ran to its end: when
    this FTL offers no stamp at all, that completed run is the only evidence
    there is, and it is accepted - apply()'s final "gravity is not empty" read
    still stands guard behind it. When a stamp IS available it must move; a
    completed run is not taken on its word.

    After a DROPPED connection nothing is trusted: the stamp must move, or, on
    an FTL without one, the domain count must change. A connection that dropped
    says nothing about Pi-hole - on a slow box or a very large list set the
    rebuild routinely outlives any sane HTTP timeout and completes afterwards.

    Returns False if the box never comes back or never shows a new build,
    which is a real failure and should be recorded as one.
    """
    deadline = time.monotonic() + (_GRAVITY_VERIFY_SECONDS if window is None else window)
    step = _GRAVITY_VERIFY_INTERVAL if interval is None else interval
    while True:
        marker = _gravity_marker()
        if marker is not None:  # None: still busy or restarting, not yet an answer
            verdict = _stamp_verdict(before, marker, since)
            if verdict is True:
                return True
            if verdict is None and (trust_completed or _count_moved(before, marker)):
                return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(step)


# After a COMPLETED gravity POST, FTL notices the new database within about a
# second (its DB thread checks once a second). This is how long to wait for
# that before calling a completed run a failed one, and how often to look.
_GRAVITY_CONFIRM_SECONDS = float(os.environ.get("GATEFLAME_GRAVITY_CONFIRM_SECONDS", "30"))
_GRAVITY_CONFIRM_INTERVAL = 1.0


def current_lists() -> list[str] | None:
    """BLOCK-list URLs Pi-hole currently has, or None if it cannot be reached.

    `/api/lists` returns allow-lists too (each entry carries `type`). Counting
    those as ours made apply() try to delete an owner's allow-list with
    `?type=block` - a 404 - and then report the whole apply as failed, forever,
    because reconcile() found the "extra" list on every boot. Entries with no
    `type` predate the field and are treated as block lists, as they were.
    """
    data = _get("/api/lists")
    if data is None:
        return None
    return [
        entry.get("address", "")
        for entry in data.get("lists", [])
        if entry.get("address") and (entry.get("type") or "block") == "block"
    ]


def apply(settings: dict) -> bool:
    """Make Pi-hole's lists match `settings`, then rebuild gravity.

    Synchronous. Returns False and records last_error() on any failure - and a
    failure here means the box is still filtering by the PREVIOUS settings,
    which is a safe place to fail: protection does not drop, it just does not
    change.

    Every exit drops the cached Pi-hole reads: whatever happened in here, the
    next /filtering or /telemetry poll must ask Pi-hole afresh rather than show
    a pre-apply snapshot for another few seconds.
    """
    try:
        return _apply(settings)
    finally:
        pihole.invalidate_cache()


def _apply(settings: dict) -> bool:
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
        if not _delete(_list_path(url)):
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
    # Pi-hole can say that, so ask it - and ask the right question. "Did the
    # domain count change" cannot tell a same-lists rebuild from no rebuild at
    # all; "did the gravity database's own timestamp move" can.
    before = _gravity_marker()
    started = time.time()

    outcome = _gravity_post(_GRAVITY_TIMEOUT)
    if outcome == GRAVITY_REFUSED:
        _last_error = "Pi-hole refused the gravity rebuild request"
        return False
    if outcome == GRAVITY_COMPLETED:
        finished = _gravity_finished(
            before, _GRAVITY_CONFIRM_SECONDS, since=started,
            interval=_GRAVITY_CONFIRM_INTERVAL, trust_completed=True,
        )
    else:
        finished = _gravity_finished(before, since=started)
    if not finished:
        if outcome == GRAVITY_COMPLETED:
            _last_error = (
                "Pi-hole ran the gravity rebuild but never loaded a new gravity "
                "database - the rebuild itself failed"
            )
        else:
            _last_error = (
                "gravity rebuild did not finish - Pi-hole stopped responding and "
                "reported no new gravity database"
            )
        return False

    # And read back ONE more time, because a gravity rebuild that runs cleanly
    # over a list it could not download leaves zero domains and reports success -
    # which is the exact shape of the original fault, one layer further in.
    if wanted:
        pihole.invalidate_cache()
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
        pihole.invalidate_cache()
        stats = summary()
        if stats is not None and not stats.get("domainsOnGravity"):
            return apply(settings)

    _last_error = None
    return True


# Set when a change arrives while a rebuild is already running. The running
# worker then does ONE more apply with the settings as they are by then, read
# from the store the most recent caller handed in.
_rerun = False
_latest_store = None


def _start_worker(first, store, name: str) -> bool:
    """Run `first()` on a thread, then keep applying while changes keep arriving.

    Returns False when a worker is already running - in which case that worker
    has been told to apply once more when it finishes, so the change is not lost.

    WHY NOT JUST DROP THE SECOND REQUEST. That is what this used to do, on the
    reasoning that "the last write already reflects every toggle". It does not:
    the running apply read the settings when it STARTED. Pause (lists removed,
    minutes of gravity) and then resume half-way through, and the resume was
    discarded - the box finished with no lists while the settings said enabled,
    reported `degraded`, and nothing ever re-applied until the next toggle or
    reboot. Coalescing keeps the property that mattered (never two gravity runs
    at once) and guarantees the final state is the owner's LATEST choice.
    """
    global _applying, _rerun, _latest_store

    with _lock:
        _latest_store = store
        if _applying:
            _rerun = True
            return False
        _applying = True
        _rerun = False

    def _run() -> None:
        global _applying, _rerun
        released = False
        try:
            first()
            while True:
                with _lock:
                    if not _rerun:
                        _applying = False
                        released = True
                        return
                    _rerun = False
                    latest = _latest_store
                apply(latest.get_filter_settings())
        finally:
            if not released:
                with _lock:
                    _applying = False

    threading.Thread(target=_run, daemon=True, name=name).start()
    return True


def reconcile_async(store) -> None:
    """Run reconcile() on a thread. Safe to call at startup."""
    if not config.pihole_api_url:
        return
    _start_worker(lambda: reconcile(store), store, "gateflame-reconcile")


def apply_async(store) -> None:
    """Kick off apply() on a thread, reading settings from the store.

    If a rebuild is already running, this one is not queued behind it and not
    dropped either: the running worker applies once more when it finishes,
    with whatever the settings are by then (see _start_worker).
    """
    if not config.pihole_api_url:
        return
    _start_worker(lambda: apply(store.get_filter_settings()), store, "gateflame-blocklists")
