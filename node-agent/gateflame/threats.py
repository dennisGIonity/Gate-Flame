"""Threat log — real entries when a source exists, empty when it doesn't.

The previous build's module_dpi_flow (AF_PACKET SNI/Host parsing) and
module_network_scan (signature correlation) are not rebuilt in this pass —
they need root-equivalent capture capability and real-hardware testing this
sandbox can't do. Until they land, this reads Pi-hole's own query log when
configured, which gives real block events without any packet capture at all.
No entry here is synthesised.

--------------------------------------------------------------------------
Pi-hole v6 — ported 2026-08-17
--------------------------------------------------------------------------
This module was the last v5 caller in the tree. It requested

    GET {base}/api.php?getAllQueries={limit}

which the running v6 instance answers with **HTTP 400** — verified against the
live node at 192.168.0.10, whose stack is `pihole/pihole:latest`. It then
indexed the reply as positional rows (row[0], row[2], row[3], row[4]), a shape
v6 does not produce at all. So the threat log could never populate, whatever
the configuration, and the failure surfaced as the gap string "Pi-hole API
error" — which reads like a network fault and was an API-version fault.
`pihole.py` had already been ported properly; this had not.

The replacement is the authenticated REST endpoint, whose real shape was read
off the live box rather than from documentation:

    GET /api/queries?length=N   header `sid: <sid>`

    {"queries": [
      {"id": 3025, "time": 1786968066.970423, "type": "A",
       "status": "CACHE", "dnssec": "UNKNOWN", "domain": "www.google.com",
       "upstream": null, "reply": {"type": "IP", "time": 2.02e-05},
       "client": {"ip": "192.168.0.5", "name": null},
       "list_id": null, "ede": {"code": -1, "text": null}, "cname": null}
    ]}

Two deliberate choices:

1. **Blocked queries only.** The route is `/threats/recent`, and a cached
   lookup of www.google.com is not a threat. Returning everything would also
   mean shipping the household's entire browsing history to whatever asks —
   including a display on a kitchen wall. Narrowing here is both more accurate
   and the privacy-minimising default (see docs/POPIA-REVIEW.md).

2. **`status` is passed through verbatim**, so the UI can say *why* something
   was blocked — gravity, an explicit denylist entry, a regex — instead of a
   flat "Blocked". That is the difference between a customer understanding
   their own box and merely being told it did something.
"""

from __future__ import annotations

from . import pihole
from .config import config

# How many recent queries to scan to find `limit` blocked ones. Most traffic on
# a healthy network is allowed, so asking for exactly `limit` would usually
# return a handful of blocks and make a working filter look idle.
_SCAN_MULTIPLE = 20
_SCAN_CAP = 1000


def _is_blocked(status: str) -> bool:
    """Whether a v6 status means the node refused the query.

    Matched on substrings rather than an exact enumeration. FTL's status list
    grows — GRAVITY_CNAME, REGEX_CNAME, DENYLIST_CNAME, EXTERNAL_BLOCKED_IP,
    EXTERNAL_BLOCKED_NULL, EXTERNAL_BLOCKED_NXRA, EXTERNAL_BLOCKED_EDE15 have
    all appeared over time — and a fixed list silently reclassifies every new
    block as "allowed" on upgrade. Under-reporting blocks is the dangerous
    direction of error: it makes a working filter look like it is doing nothing.
    """
    s = (status or "").upper()
    return any(
        m in s for m in ("GRAVITY", "DENYLIST", "REGEX", "BLOCKED", "SPECIAL_DOMAIN")
    )


def recent(limit: int = 20) -> dict:
    if not config.pihole_api_url:
        return {
            "entries": [],
            "source": "none",
            "gap": "no threat data source configured — Pi-hole query log or DPI capture required",
        }

    scan = min(max(limit * _SCAN_MULTIPLE, 200), _SCAN_CAP)
    data = pihole.api_get(f"/api/queries?length={scan}")
    if data is None:
        # api_get has already collapsed "no route", "auth refused" and "bad
        # JSON" into one None. All three mean the same thing to a reader of this
        # screen: no data — and not a claim that nothing happened.
        return {
            "entries": [],
            "source": "pihole",
            "gap": "Pi-hole did not answer an authenticated query read",
        }

    queries = data.get("queries")
    if not isinstance(queries, list):
        return {"entries": [], "source": "pihole", "gap": "Pi-hole returned no query list"}

    entries: list[dict] = []
    blocked_in_window = 0

    for q in queries:
        if not isinstance(q, dict):
            continue
        status = q.get("status") or "UNKNOWN"
        if not _is_blocked(status):
            continue
        blocked_in_window += 1
        if len(entries) >= limit:
            continue

        client = q.get("client") if isinstance(q.get("client"), dict) else {}
        entries.append(
            {
                "timestamp": q.get("time"),
                "domain": q.get("domain"),
                # IP is the identity. `name` is frequently null and is never
                # inferred from anything — a guessed device name on a security
                # log is worse than no name at all.
                "clientIp": client.get("ip"),
                "clientName": client.get("name"),
                "queryType": q.get("type"),
                "status": status,
                "action": "Blocked",
                "blocked": True,
            }
        )

    return {
        "entries": entries,
        "source": "pihole",
        # Both counts are stated so the UI can be specific: "9 blocked of the
        # last 400 queries" says something; "9 entries" does not.
        "scanned": len(queries),
        "blockedInWindow": blocked_in_window,
    }
