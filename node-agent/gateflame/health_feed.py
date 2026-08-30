"""Outbound-only health feed. Health fields only — see PAIRING-AND-TELEMETRY.md §4.

Never touches domains, client IPs, hostnames, threat logs or DPI output —
those aren't imported into this module at all, not just excluded at
serialization, so a future edit can't accidentally wire one in.

Off by default (`GATEFLAME_FEED_ENABLED`). Batched to one POST per interval
(default 15 min), fails silent — a feed outage must never touch protection.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx

from . import services, telemetry
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
    }


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
