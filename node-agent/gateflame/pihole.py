"""Optional Pi-hole integration - read-only, over Pi-hole's own HTTP API.

Pi-hole is never bundled or vendored (its licence governs redistribution, not
us); the operator installs it separately and points GATEFLAME_PIHOLE_URL at
it. Reached only if configured; every caller must handle `None` back and
report the gap honestly rather than inventing a number.

PI-HOLE v6 API
==============

Pi-hole v6 removed the old `/admin/api.php?...` endpoints entirely. Verified
against a running v6 container on 2026-08-16:

    GET  /admin/api.php?summaryRaw  -> HTTP 400
    GET  /api.php?summaryRaw        -> HTTP 404

The replacement is an authenticated REST API:

    POST   /api/auth  {"password": "..."}  -> {"session": {"sid": ..., "validity": 1800}}
    GET    /api/stats/summary  header `sid: <sid>`
    DELETE /api/auth           header `sid: <sid>`

This module previously spoke the v5 API, so on a v6 install every field came
back null and the dashboard reported "Pi-hole not configured or unreachable"
while Pi-hole was up, filtering, and holding the numbers. Honest, but wrong.

Sessions are limited in number and expire after `validity` seconds, so the sid
is cached and reused rather than re-authenticating on every 4-second poll -
which would otherwise exhaust Pi-hole's session table within a minute.
"""

from __future__ import annotations

import threading
import time

import httpx

from .config import config

_lock = threading.Lock()
_sid: str | None = None
_sid_expires: float = 0.0

# Re-auth this many seconds before the server would expire us, so a poll never
# lands on a session that dies mid-request.
_EXPIRY_MARGIN = 60.0
_TIMEOUT = 4.0


def _base() -> str | None:
    url = config.pihole_api_url
    return url.rstrip("/") if url else None


def _authenticate(base: str) -> str | None:
    """Exchange the admin password for a session id. None on any failure.

    Caller must hold _lock.
    """
    global _sid, _sid_expires

    password = getattr(config, "pihole_password", None)
    if not password:
        # A v6 install always needs one. Say nothing rather than hammering
        # /api/auth with an empty body every poll.
        return None
    try:
        r = httpx.post(f"{base}/api/auth", json={"password": password}, timeout=_TIMEOUT)
        if r.status_code != 200:
            return None
        session = r.json().get("session") or {}
        if not session.get("valid"):
            return None
        sid = session.get("sid")
        validity = float(session.get("validity", 300))
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return None

    if not sid:
        return None

    _sid = sid
    _sid_expires = time.monotonic() + max(validity - _EXPIRY_MARGIN, 30.0)
    return sid


def _session(base: str) -> str | None:
    """A valid sid, authenticating only when the cached one is stale."""
    with _lock:
        if _sid and time.monotonic() < _sid_expires:
            return _sid
        return _authenticate(base)


def _invalidate() -> None:
    global _sid, _sid_expires
    with _lock:
        _sid, _sid_expires = None, 0.0


def _get(path: str) -> dict | None:
    """Authenticated GET returning parsed JSON, or None.

    Retries once on 401: a session can be invalidated server-side (restart,
    session-table eviction) before our cached expiry, and one silent re-auth is
    better than reporting a gap that is not real.
    """
    base = _base()
    if not base:
        return None

    for attempt in (1, 2):
        sid = _session(base)
        if not sid:
            return None
        try:
            r = httpx.get(f"{base}{path}", headers={"sid": sid}, timeout=_TIMEOUT)
        except httpx.HTTPError:
            return None

        if r.status_code == 401 and attempt == 1:
            _invalidate()
            continue
        if r.status_code != 200:
            return None
        try:
            return r.json()
        except ValueError:
            return None
    return None


def api_get(path: str) -> dict | None:
    """The v6 authenticated GET, shared with other modules.

    Public on purpose. `threats.py` needs exactly this — a session-cached,
    401-retrying, authenticated read — and the alternative was a second
    authentication path with its own cache and its own expiry bug. One session
    table on the Pi-hole side means one session holder on ours.
    """
    return _get(path)


def reachable() -> bool:
    """True only when Pi-hole answers an AUTHENTICATED request.

    An unauthenticated probe is not enough: v6 serves 403 on / and 401 on
    /api/* without a session, so a bare connectivity check would call an
    unusable instance 'reachable' and the dashboard would show zeros instead of
    an honest gap.
    """
    return _get("/api/stats/summary") is not None


def summary() -> dict | None:
    """Query counts, block percentage, gravity size, clients - real numbers
    from Pi-hole's own API. Returns None if Pi-hole isn't configured or isn't
    answering; callers must not substitute a fabricated value."""
    data = _get("/api/stats/summary")
    if not data:
        return None

    queries = data.get("queries") or {}
    clients = data.get("clients") or {}
    gravity = data.get("gravity") or {}

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

    # Each field is None when Pi-hole did not supply it, never 0. A zero here
    # would be indistinguishable from "nothing blocked today", which is a real
    # and different state.
    return {
        "totalQueriesToday": _int(queries.get("total")),
        "queriesBlockedToday": _int(queries.get("blocked")),
        "blockPercentage": _float(queries.get("percent_blocked")),
        "domainsOnGravity": _int(gravity.get("domains_being_blocked")),
        "activeClientsCount": _int(clients.get("active")),
    }
