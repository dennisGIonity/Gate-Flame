"""Threat log — real entries when a source exists, empty when it doesn't.

The previous build's module_dpi_flow (AF_PACKET SNI/Host parsing) and
module_network_scan (signature correlation) are not rebuilt in this pass —
they need root-equivalent capture capability and real-hardware testing this
sandbox can't do. Until they land, this reads Pi-hole's own query log when
configured, which gives real block events without any packet capture at all.
No entry here is synthesised.
"""

from __future__ import annotations

import httpx

from .config import config


def recent(limit: int = 20) -> dict:
    if not config.pihole_api_url:
        return {
            "entries": [],
            "source": "none",
            "gap": "no threat data source configured — Pi-hole query log or DPI capture required",
        }
    try:
        r = httpx.get(
            f"{config.pihole_api_url}/api.php?getAllQueries={limit}", timeout=2.0
        )
        if r.status_code != 200:
            return {"entries": [], "source": "pihole", "gap": "Pi-hole API unreachable"}
        data = r.json().get("data", [])
        entries = []
        for row in data:
            # Pi-hole getAllQueries row: [time, type, domain, client, status, ...]
            if len(row) < 5:
                continue
            status = row[4]
            action = "Blocked" if status in ("1", "4", "5", "6", "7", "8", "9", "10", "11") else "Allowed"
            entries.append(
                {
                    "timestamp": row[0],
                    "domain": row[2],
                    "clientIp": row[3],
                    "action": action,
                }
            )
        return {"entries": entries, "source": "pihole"}
    except (httpx.HTTPError, ValueError, IndexError):
        return {"entries": [], "source": "pihole", "gap": "Pi-hole API error"}
