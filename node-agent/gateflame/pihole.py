"""Optional Pi-hole integration - over Pi-hole's own HTTP API.

Pi-hole is never bundled or vendored (its licence governs redistribution, not
us); the operator installs it separately and points GATEFLAME_PIHOLE_URL at
it. Reached only if configured; every caller must handle a failure back and
report the gap honestly rather than inventing a number.

PI-HOLE v6 API
==============

Pi-hole v6 removed the old `/admin/api.php?...` endpoints entirely. Verified
against a running v6 container on 2026-08-16:

    GET  /admin/api.php?summaryRaw  -> HTTP 400
    GET  /api.php?summaryRaw        -> HTTP 404

The replacement is an authenticated REST API. Checked 2026-09-26 against the
OpenAPI spec shipped with FTL v6.7.1 (api-docs.tar.gz, specs/auth.yaml) and
FTL's own src/api/auth.c / config.c:

    POST   /api/auth  {"password": "..."}  -> {"session": {"valid", "sid", "validity"}}
    GET    /api/stats/summary              header `X-FTL-SID: <sid>`
    DELETE /api/auth                       header `X-FTL-SID: <sid>`  (logout, 204)

    429 on POST /api/auth = "api_seats_exceeded": every one of
        webserver.api.max_sessions (default 16) is taken.

The SID goes in an `X-FTL-SID` header - one of the four documented methods
(query string, body, that header, or a `sid` cookie plus `X-FTL-CSRF`). A bare
`sid` header is not one of them (BUG-18, fixed 2026-09-14).

SESSIONS ARE A SHARED, SCARCE RESOURCE - THE RULES THIS MODULE FOLLOWS
----------------------------------------------------------------------
Pi-hole allows 16 concurrent API sessions by default and each one lives
`webserver.session.timeout` (1800 s) after its LAST use - the expiry slides.

  1. One session per process, reused until Pi-hole says 401. The agent used to
     re-authenticate every ~29 minutes regardless and never logged the old
     session out, and every `gateflame-job@*` run (anomaly every 5 min,
     selfcheck every 15) opened a fresh session and abandoned it. That parks
     roughly ten sessions permanently; add a browser or two on the admin page
     and the 429 lands on the agent's next re-auth, which then reads as
     "Pi-hole not answering" - a false `degraded`.
  2. A session being replaced is logged out first (best effort), and a job
     logs out when it exits (`logout()`, see jobs.py).
  3. Concurrent 401s do not stampede: a thread only discards the SID it was
     actually using, so ten pollers hitting a restarted Pi-hole create one new
     session, not ten.
  4. A refused login backs off for a few seconds instead of being retried on
     every 4-second poll.

FAILURES ARE NAMED, NOT COLLAPSED
---------------------------------
`request()` returns a `Result` whose `failure` says WHICH thing went wrong -
not configured, no password, password refused, no free session, did not
answer, timed out, answered with an error, answered with something unreadable.
Those need different actions from whoever reads the screen, so `gap_for()`
turns each into its own sentence. The legacy helpers (`api_get`, `api_patch`,
`summary`) still return None on any failure for the callers that only need
yes/no.

CACHING
-------
`summary()` is read by /telemetry/summary, /filtering, /services and the
health feed, polled concurrently by the kiosk, the phone and IoniBot. It is
cached for GATEFLAME_PIHOLE_CACHE_SECONDS (default 4 s) with single-flight
loading. Any write the agent makes calls `invalidate_cache()` so the cache can
never hide a change this box itself just made.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import config
from .ttlcache import TTLCache

_lock = threading.Lock()
_sid: str | None = None
_sid_expires: float = 0.0
_sid_validity: float = 0.0
_auth_failure: str | None = None
_auth_backoff_until: float = 0.0

# Re-auth this many seconds before our own record of the session would lapse.
# Pi-hole slides the expiry on every use, so for a polled agent this only ever
# matters after a long idle stretch.
_EXPIRY_MARGIN = 60.0
_TIMEOUT = 4.0
# How long a refused login is not retried. Long enough not to hammer /api/auth
# from every poll, short enough that fixing the password shows up quickly.
_AUTH_BACKOFF_SECONDS = 15.0

# Test seam: when set, every request goes through this transport (for example
# httpx.MockTransport) instead of the network. None in production.
_transport: httpx.BaseTransport | None = None

# Sentinel SID: send no session header at all. Used when no password is
# configured (a 401 then means "Pi-hole wants one") and when Pi-hole itself
# reports that no password is required.
_NO_AUTH = ""

FAIL_UNCONFIGURED = "unconfigured"
FAIL_NO_PASSWORD = "no_password"
FAIL_AUTH_REFUSED = "auth_refused"
FAIL_NO_SEATS = "no_seats"
FAIL_UNREACHABLE = "unreachable"
FAIL_TIMEOUT = "timeout"
FAIL_HTTP = "http_error"
FAIL_BAD_BODY = "bad_body"


@dataclass(frozen=True)
class Result:
    """One Pi-hole call. `failure` is None exactly when `ok` is True."""

    ok: bool
    data: Any = None
    status: int | None = None
    failure: str | None = None
    detail: str | None = None


def gap_for(failure: str | None, what: str = "this", detail: str | None = None) -> str:
    """One sentence naming why `what` could not be read. Never blames the wrong party."""
    if failure == FAIL_UNCONFIGURED:
        return f"Pi-hole is not configured on this box (GATEFLAME_PIHOLE_URL is unset), so {what} cannot be read"
    if failure == FAIL_NO_PASSWORD:
        return (
            f"Pi-hole requires a password and this box has none configured "
            f"(GATEFLAME_PIHOLE_PASSWORD), so {what} cannot be read"
        )
    if failure == FAIL_AUTH_REFUSED:
        return f"Pi-hole refused this box's password, so {what} cannot be read"
    if failure == FAIL_NO_SEATS:
        return (
            f"Pi-hole refused a new API session (every API seat is in use), so {what} "
            "cannot be read right now"
        )
    if failure == FAIL_TIMEOUT:
        return f"Pi-hole did not answer in time, so {what} cannot be read right now"
    if failure == FAIL_UNREACHABLE:
        return f"Pi-hole did not answer, so {what} cannot be read right now"
    if failure == FAIL_HTTP:
        suffix = f" ({detail})" if detail else ""
        return f"Pi-hole answered with an error{suffix}, so {what} cannot be read"
    if failure == FAIL_BAD_BODY:
        return f"Pi-hole answered in a shape this agent does not understand, so {what} cannot be read"
    return f"{what} could not be read from Pi-hole"


def _base() -> str | None:
    url = config.pihole_api_url
    return url.rstrip("/") if url else None


def _http(method: str, url: str, *, headers: dict | None = None, json: Any = None,
          timeout: float = _TIMEOUT) -> httpx.Response:
    """The only place this module touches the network.

    A fresh connection per call on purpose, not a pooled client. Pi-hole's
    gravity endpoint writes a second, JSON response onto the connection AFTER
    its chunked body has ended (see FTL src/api/action.c), so a kept-alive
    connection can hand that stale response to the NEXT request. On loopback a
    new TCP connection costs microseconds; a mis-paired response costs a wrong
    number on a customer's screen.
    """
    if _transport is not None:
        with httpx.Client(transport=_transport) as client:
            return client.request(method, url, headers=headers, json=json, timeout=timeout)
    return httpx.request(method, url, headers=headers, json=json, timeout=timeout)


def _authenticate(base: str, password: str) -> tuple[str | None, str | None]:
    """Exchange the admin password for a session. Caller must hold _lock."""
    global _sid, _sid_expires, _sid_validity, _auth_failure, _auth_backoff_until

    def refused(code: str) -> tuple[None, str]:
        global _auth_failure, _auth_backoff_until
        _auth_failure = code
        _auth_backoff_until = time.monotonic() + _AUTH_BACKOFF_SECONDS
        return None, code

    try:
        r = _http("POST", f"{base}/api/auth", json={"password": password}, timeout=_TIMEOUT)
    except httpx.TimeoutException:
        # Not a refusal - do not back off, Pi-hole may simply be restarting.
        return None, FAIL_TIMEOUT
    except httpx.HTTPError:
        return None, FAIL_UNREACHABLE

    if r.status_code == 429:
        return refused(FAIL_NO_SEATS)
    if r.status_code in (400, 401, 403):
        return refused(FAIL_AUTH_REFUSED)
    if r.status_code != 200:
        return None, FAIL_HTTP
    try:
        session = (r.json() or {}).get("session") or {}
        valid = bool(session.get("valid"))
        sid = session.get("sid")
        validity = float(session.get("validity") or 300)
    except (ValueError, TypeError, AttributeError):
        return None, FAIL_BAD_BODY

    if not valid:
        return refused(FAIL_AUTH_REFUSED)

    _sid = sid if sid else _NO_AUTH  # valid with no sid: Pi-hole needs no password
    _sid_validity = validity
    _sid_expires = time.monotonic() + max(validity - _EXPIRY_MARGIN, 30.0)
    _auth_failure = None
    _auth_backoff_until = 0.0
    return _sid, None


def _delete_session(base: str, sid: str) -> None:
    """Best-effort logout of one session. Never raises."""
    if not sid:
        return
    try:
        _http("DELETE", f"{base}/api/auth", headers={"X-FTL-SID": sid}, timeout=2.0)
    except httpx.HTTPError:
        pass


def _session_ex(base: str) -> tuple[str | None, str | None]:
    """(sid, failure). A sid of _NO_AUTH means: send no session header."""
    global _sid, _sid_expires
    with _lock:
        now = time.monotonic()
        if _sid is not None and now < _sid_expires:
            return _sid, None
        password = getattr(config, "pihole_password", None)
        if not password:
            # Nothing to log in with. Ask without a session: a Pi-hole with no
            # password answers, one that wants a password says 401 and the
            # caller reports exactly that.
            return _NO_AUTH, None
        if now < _auth_backoff_until:
            return None, _auth_failure or FAIL_AUTH_REFUSED
        stale = _sid
        sid, failure = _authenticate(base, password)
        if stale and stale != sid:
            # Our record lapsed; Pi-hole may still hold the seat. Give it back.
            _delete_session(base, stale)
        return sid, failure


def _session(base: str) -> str | None:
    """A valid sid (or _NO_AUTH), authenticating only when needed. None on failure."""
    sid, _failure = _session_ex(base)
    return sid


def _invalidate(expected: str | None = None) -> None:
    """Forget the cached session - but only if it is still the one that failed.

    Without the check, N threads that all got a 401 from a restarted Pi-hole
    would each throw away the session the first of them had just re-created,
    and each create their own: N sessions for one agent.
    """
    global _sid, _sid_expires
    with _lock:
        if expected is None or _sid == expected:
            _sid, _sid_expires = None, 0.0


def _touch(sid: str) -> None:
    """Pi-hole slid the session's expiry on that request; mirror it."""
    global _sid_expires
    if not sid:
        return
    with _lock:
        if _sid == sid:
            _sid_expires = time.monotonic() + max(_sid_validity - _EXPIRY_MARGIN, 30.0)


def _error_detail(r: httpx.Response) -> str:
    try:
        err = (r.json() or {}).get("error") or {}
        message = err.get("message") or err.get("key")
        if message:
            return f"HTTP {r.status_code}: {str(message)[:160]}"
    except (ValueError, AttributeError):
        pass
    return f"HTTP {r.status_code}"


def request(
    method: str,
    path: str,
    *,
    json: Any = None,
    timeout: float | None = None,
    expect: str = "json",
    headers: dict | None = None,
) -> Result:
    """One authenticated Pi-hole call with a single silent re-auth on 401.

    `expect`: "json" (a 2xx that is not JSON is a failure), "any" (JSON when it
    parses, else the text - for endpoints like the gravity action that stream
    plain text), or "none" (only the status matters, e.g. a 204).
    """
    base = _base()
    if not base:
        return Result(False, failure=FAIL_UNCONFIGURED)

    for attempt in (1, 2):
        sid, failure = _session_ex(base)
        if sid is None:
            return Result(False, failure=failure or FAIL_AUTH_REFUSED)
        send = dict(headers or {})
        if sid != _NO_AUTH:
            send["X-FTL-SID"] = sid
        try:
            r = _http(method, f"{base}{path}", headers=send, json=json,
                      timeout=_TIMEOUT if timeout is None else timeout)
        except httpx.TimeoutException as exc:
            return Result(False, failure=FAIL_TIMEOUT, detail=type(exc).__name__)
        except httpx.HTTPError as exc:
            return Result(False, failure=FAIL_UNREACHABLE, detail=type(exc).__name__)

        if r.status_code == 401:
            if sid == _NO_AUTH and not getattr(config, "pihole_password", None):
                return Result(False, status=401, failure=FAIL_NO_PASSWORD)
            if attempt == 1:
                # A session can be invalidated server-side (restart, eviction)
                # before our record says so. One silent re-auth is better than
                # reporting a gap that is not real.
                _invalidate(sid)
                continue
            return Result(False, status=401, failure=FAIL_AUTH_REFUSED)

        _touch(sid)
        if not 200 <= r.status_code < 300:
            return Result(False, status=r.status_code, failure=FAIL_HTTP, detail=_error_detail(r))
        if expect == "none":
            return Result(True, status=r.status_code)
        try:
            data = r.json()
        except ValueError:
            if expect == "json":
                return Result(False, status=r.status_code, failure=FAIL_BAD_BODY)
            data = r.text
        return Result(True, data=data, status=r.status_code)
    return Result(False, failure=FAIL_AUTH_REFUSED)


def logout() -> None:
    """Give this process's session seat back to Pi-hole. Best effort, never raises.

    Called when a job exits and when the agent shuts down, so neither leaves a
    seat parked for 30 minutes.
    """
    global _sid, _sid_expires
    base = _base()
    with _lock:
        sid, _sid, _sid_expires = _sid, None, 0.0
    if base and sid:
        _delete_session(base, sid)


def _get(path: str) -> dict | None:
    """Authenticated GET returning parsed JSON, or None on any failure."""
    r = request("GET", path)
    return r.data if r.ok else None


def api_get(path: str) -> dict | None:
    """The v6 authenticated GET, shared with other modules.

    Public on purpose. `threats.py` needs exactly this — a session-cached,
    401-retrying, authenticated read — and the alternative was a second
    authentication path with its own cache and its own expiry bug. One session
    table on the Pi-hole side means one session holder on ours.
    """
    return _get(path)


def api_patch(path: str, payload: dict) -> dict | None:
    """Authenticated PATCH returning parsed JSON, or None on any failure.

    Added for upstream.py (Pi-hole v6 `PATCH /api/config`). Same session
    cache and single 401 retry as every other call. A None here means "not
    applied" and the caller must READ BACK before believing anything else -
    Pi-hole answering 200 is not proof.
    """
    r = request("PATCH", path, json=payload)
    if not r.ok:
        return None
    return r.data if isinstance(r.data, dict) else {}


# ------------------------------------------------------------------ summary

_cache = TTLCache()
_SUMMARY_TTL = float(os.environ.get("GATEFLAME_PIHOLE_CACHE_SECONDS", "4"))
_SUMMARY_FAILURE_TTL = 2.0
_last_summary_failure: str | None = None


def invalidate_cache() -> None:
    """Drop every cached Pi-hole read. Call after any write this agent makes."""
    _cache.invalidate()


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _load_summary() -> dict | None:
    global _last_summary_failure
    r = request("GET", "/api/stats/summary")
    if not r.ok or not isinstance(r.data, dict) or not r.data:
        _last_summary_failure = r.failure or FAIL_BAD_BODY
        return None
    _last_summary_failure = None
    data = r.data
    queries = data.get("queries") or {}
    clients = data.get("clients") or {}
    gravity = data.get("gravity") or {}
    # `last_update` is the gravity database's own "updated" stamp as FTL last
    # loaded it (FTL src/database/gravity-db.c: gravity_last_updated()). The
    # spec says it "may be 0 if unknown" - that is unknown, so None, not 0.
    stamp = _int(gravity.get("last_update"))
    # Each field is None when Pi-hole did not supply it, never 0. A zero here
    # would be indistinguishable from "nothing blocked today", which is a real
    # and different state.
    return {
        "totalQueriesToday": _int(queries.get("total")),
        "queriesBlockedToday": _int(queries.get("blocked")),
        "blockPercentage": _float(queries.get("percent_blocked")),
        "domainsOnGravity": _int(gravity.get("domains_being_blocked")),
        "activeClientsCount": _int(clients.get("active")),
        "gravityLastUpdate": stamp if stamp else None,
    }


def summary() -> dict | None:
    """Query counts, block percentage, gravity size, clients - real numbers
    from Pi-hole's own API. Returns None if Pi-hole isn't configured or isn't
    answering; callers must not substitute a fabricated value.

    Cached briefly (see module docstring). Read `last_failure()` for WHY a None
    came back.
    """
    value = _cache.get(
        "summary",
        _load_summary,
        _SUMMARY_TTL,
        failure_ttl=min(_SUMMARY_FAILURE_TTL, _SUMMARY_TTL),
        is_failure=lambda v: v is None,
    )
    return dict(value) if value is not None else None


def last_failure() -> str | None:
    """The FAIL_* code behind the most recent summary() that came back None."""
    return _last_summary_failure


def reachable() -> bool:
    """True only when Pi-hole answers an AUTHENTICATED request.

    An unauthenticated probe is not enough: v6 serves 403 on / and 401 on
    /api/* without a session, so a bare connectivity check would call an
    unusable instance 'reachable' and the dashboard would show zeros instead of
    an honest gap. Served from the same cached read as summary(), so a caller
    asking both questions costs Pi-hole one request, not two.
    """
    return summary() is not None
