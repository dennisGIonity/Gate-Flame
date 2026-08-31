"""Outbound-only health feed — see PAIRING-AND-TELEMETRY.md §4.

WHAT LEAVES THE HOUSEHOLD, STATED PLAINLY
=========================================
Health fields, PLUS per-device Shield state: for each device the owner has
put on a VPN region, its MAC, the name the owner gave it, the region, and
whether it is on.

That last part is a DEVICE IDENTIFIER leaving the LAN, and it is here by an
explicit product decision (Dennis, 2026-08-31) so that support can answer
"which of my devices is on Japan?" without asking the customer to read a
screen to them.

This docstring used to promise the exact opposite:

    "Never touches domains, client IPs, hostnames, threat logs or DPI output"

That promise no longer holds in full, so it does not get to stay written. A
module whose comments describe a stricter system than the one it implements is
worse than one with no comments, because the next reader trusts it.

WHAT STILL NEVER LEAVES
-----------------------
Domains, per-query threat logs, DPI output and client IP addresses are still
not imported into this module at all - not merely filtered at serialization -
so a future edit cannot wire one in by accident. Only the Shield rows cross,
and only the four fields named above.

OBLIGATIONS THIS CREATES (see docs/, and the Play listing)
----------------------------------------------------------
  * POPIA s18 - the privacy notice must say device identifiers are collected.
  * Google Play data safety - must declare device identifiers. CLAUDE.md
    calls the honest answer here a selling point; it is now a smaller one.

Off by default (`GATEFLAME_FEED_ENABLED`). Batched to one POST per interval
(default 15 min), fails silent — a feed outage must never touch protection.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx

from . import device_names, services, telemetry, vpn
from .config import config
from .storage import Store

logger = logging.getLogger("gateflame.health_feed")


def build_payload(store: Store) -> dict:
    host = telemetry.host_snapshot()
    return {
        "nodeId": store.node_id(),
        "agentVersion": config.agent_version,
        "sentAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "uptimeSeconds": host["uptimeSeconds"],
        "host": {
            k: v
            for k, v in host.items()
            if k in ("cpuPercent", "memUsedMB", "memTotalMB", "diskUsedPercent", "tempC", "throttleFlags")
        },
        "modules": [
            {"id": m["id"], "status": m["status"], "gap": m.get("gap")}
            for m in services.list_modules()
        ],
        "counters": {"errors24h": 0, "restarts24h": 0, "wanBudgetUsedPercent": None},
        "piholeReachable": telemetry.pihole.reachable(),
        "shield": _shield_snapshot(store),
    }


def _shield_snapshot(store: Store) -> dict:
    """Shield state for this box, including per-device rows.

    Only devices the owner has actually configured appear - list_vpn_devices()
    returns rows that exist because somebody chose a region, not every device
    ever seen on the LAN. A household that has never touched Shield sends
    `devices: []`, which is a meaningfully different thing from "we looked and
    there is nothing to report" and is why `configured` is sent alongside.

    Wrapped in its own try: this is a REPORTING feature, and it must never be
    the reason a health check-in fails. A box whose Shield table is somehow
    unreadable should still tell the fleet its CPU and its module states.
    """
    try:
        names = store.device_names()
        rows = []
        for d in vpn.list_device_status(store):
            mac = d.get("mac", "")
            rows.append(
                {
                    "mac": mac,
                    # The same label the owner sees on the phone and the wall
                    # console, computed the same way, so support and customer
                    # are never looking at two different names for one device.
                    "label": device_names.display_label(mac, names.get(mac), None),
                    "region": d.get("region"),
                    "enabled": bool(d.get("enabled")),
                    "provider": d.get("provider"),
                }
            )
        return {
            "configured": bool(rows),
            "enabledCount": sum(1 for r in rows if r["enabled"]),
            "devices": rows,
        }
    except Exception:  # noqa: BLE001 - reporting must never break the check-in
        logger.warning("could not read Shield state for the feed", exc_info=True)
        # None, not {} - "we could not read this" and "there is nothing here"
        # must not arrive at the dashboard looking identical.
        return None


# Where the node's own feed credential lives once the server has issued one.
FEED_TOKEN_KEY = "feed_node_token"


def _send_once(store: Store) -> bool:
    """Post one check-in, and pick up a per-node token if the server offers one.

    Every box used to ship with the SAME shared feed secret, which meant any
    one of them could post as any other node id. The fleet server now mints a
    token per node on first contact and returns it 201; this stores it and
    uses it from then on, so the shared secret stops being a master key.

    Deliberately tolerant in both directions: a node that has no token yet
    falls back to the shared one (that is how it enrols), and a server that
    never returns one leaves behaviour exactly as it was. Neither side has to
    be upgraded first.
    """
    payload = build_payload(store)
    token = store.get_setting(FEED_TOKEN_KEY) or config.feed_token
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        r = httpx.post(
            f"{config.feed_url}/{store.node_id()}/health",
            json=payload,
            headers=headers,
            timeout=5.0,
        )
        if r.status_code == 201:
            try:
                issued = (r.json() or {}).get("nodeToken")
            except ValueError:
                issued = None
            if issued:
                store.set_setting(FEED_TOKEN_KEY, issued)
                logger.info("health feed: stored this node's own feed token")
        return r.status_code < 300
    except httpx.HTTPError as exc:
        logger.warning("health feed post failed, dropping: %s", exc)
        return False


class HealthFeedLoop:
    """Runs on a background thread. Started only if GATEFLAME_FEED_ENABLED."""

    def __init__(self, store: Store):
        self.store = store
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if not config.feed_enabled:
            logger.info("health feed disabled (GATEFLAME_FEED_ENABLED=false)")
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                _send_once(self.store)
            except Exception:  # noqa: BLE001 — a feed bug must never crash the agent
                logger.exception("health feed iteration failed")
            self._stop.wait(config.feed_interval_seconds)
