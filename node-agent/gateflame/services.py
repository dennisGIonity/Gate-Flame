"""Module registry — honest capability reporting, scope-gated start/stop.

Every module declares what it needs (a binary on PATH, a capability, a
config) and checks for it at status time. Missing a requirement means
`degraded` or `not_implemented` with a named gap and remedy — never a faked
`running`. This is the design centre carried forward from the previous build.

Starting a module is allowed to any paired handset (`control` scope) —
restoring protection is what a remote is for. Stopping one requires `kiosk`
scope, because a real stop tears down enforcement and must survive a stolen,
still-paired phone.
"""

from __future__ import annotations

import shutil
import threading
import time

from . import pihole

_lock = threading.Lock()
_enabled: dict[str, bool] = {}


def _has(binary: str) -> bool:
    return shutil.which(binary) is not None


MODULE_DEFS = {
    "module_telemetry": {
        "label": "System Telemetry",
        "check": lambda: (True, None),
    },
    "module_passive_discovery": {
        "label": "Passive Client Discovery",
        "check": lambda: (_has("ip"), "requires `ip` (iproute2) on PATH"),
    },
    "module_dns_filter": {
        "label": "DNS Filtering",
        "check": lambda: (
            (True, None) if pihole.reachable() else (False, "Pi-hole not configured or unreachable")
        ),
    },
    "module_firewall_bounce": {
        "label": "Firewall Bounce",
        "check": lambda: (False, "nftables bouncer not implemented in this build — needs CAP_NET_ADMIN and real-hardware validation"),
    },
    "module_dpi_flow": {
        "label": "Deep Packet Inspection (headers only)",
        "check": lambda: (False, "AF_PACKET SNI/Host capture not implemented in this build"),
    },
    "module_wan_audit": {
        "label": "WAN Quality & Budget",
        "check": lambda: (False, "throughput/latency/budget accounting not implemented in this build"),
    },
    "module_zero_trust": {
        "label": "Zero-Trust Posture",
        "check": lambda: (False, "posture audit + hardened unit generation not implemented in this build"),
    },
}


def module_status(module_id: str) -> dict:
    definition = MODULE_DEFS.get(module_id)
    if definition is None:
        return {"id": module_id, "status": "unknown"}
    ok, gap = definition["check"]()
    running = _enabled.get(module_id, False)
    if not ok:
        status = "not_implemented" if gap and "not implemented" in gap else "degraded"
    else:
        status = "running" if running else "stopped"
    result = {"id": module_id, "label": definition["label"], "status": status}
    if gap:
        result["gap"] = gap
    return result


def list_modules() -> list[dict]:
    return [module_status(mid) for mid in MODULE_DEFS]


class ToggleResult:
    def __init__(self, ok: bool, status: str | None = None, error: str | None = None, advisory: str | None = None):
        self.ok = ok
        self.status = status
        self.error = error
        self.advisory = advisory

    def to_dict(self) -> dict:
        out: dict = {"ok": self.ok}
        if self.status:
            out["status"] = self.status
        if self.error:
            out["error"] = self.error
        if self.advisory:
            out["advisory"] = self.advisory
        return out


def start_module(module_id: str) -> ToggleResult:
    definition = MODULE_DEFS.get(module_id)
    if definition is None:
        return ToggleResult(ok=False, error="unknown_module")
    ok, gap = definition["check"]()
    if not ok:
        return ToggleResult(ok=False, error="capability_unavailable", advisory=gap)
    with _lock:
        _enabled[module_id] = True
    return ToggleResult(ok=True, status="running")


def stop_module(module_id: str) -> ToggleResult:
    if module_id not in MODULE_DEFS:
        return ToggleResult(ok=False, error="unknown_module")
    with _lock:
        _enabled[module_id] = False
    return ToggleResult(ok=True, status="stopped")
