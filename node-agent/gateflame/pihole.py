"""Optional Pi-hole integration — read-only, over Pi-hole's own HTTP API.

Pi-hole is never bundled or vendored (its licence governs redistribution, not
us); the operator installs it separately and points GATEFLAME_PIHOLE_URL at
it. Reached only if configured; every caller must handle `None` back and
report the gap honestly rather than inventing a number.
"""

from __future__ import annotations

import httpx

from .config import config


def reachable() -> bool:
    if not config.pihole_api_url:
        return False
    try:
        r = httpx.get(f"{config.pihole_api_url}/api.php?status", timeout=2.0)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


def summary() -> dict | None:
    """Query counts, block percentage, gravity size, clients — real numbers
    from Pi-hole's own API. Returns None if Pi-hole isn't configured or isn't
    answering; callers must not substitute a fabricated value."""
    if not config.pihole_api_url:
        return None
    try:
        r = httpx.get(f"{config.pihole_api_url}/api.php?summaryRaw", timeout=2.0)
        if r.status_code != 200:
            return None
        data = r.json()
        return {
            "totalQueriesToday": int(data.get("dns_queries_today", 0)),
            "queriesBlockedToday": int(data.get("ads_blocked_today", 0)),
            "blockPercentage": float(data.get("ads_percentage_today", 0.0)),
            "domainsOnGravity": int(data.get("domains_being_blocked", 0)),
            "activeClientsCount": int(data.get("unique_clients", 0)),
        }
    except (httpx.HTTPError, ValueError, KeyError):
        return None
