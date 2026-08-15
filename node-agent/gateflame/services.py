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

from . import firewall as firewall_mod
from . import pihole

_lock = threading.Lock()
_enabled: dict[str, bool] = {}

# One controller for the process, so the ruleset is installed once and the
# "already installed" latch inside it means something.
firewall = firewall_mod.Firewall()


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
        # Implemented 2026-08-14. Reports the REAL nftables capability: a Pi
        # without CAP_NET_ADMIN gets `degraded` plus the exact remedy, never a
        # green light over a bouncer that cannot drop a packet.
        "check": lambda: firewall.capability(),
        "on_start": lambda: firewall.ensure_installed(),
        # Stopping tears the table down, releasing every bounce. A stopped
        # bouncer must not keep silently dropping traffic — that is the
        # failure mode a customer cannot diagnose.
        "on_stop": lambda: firewall.teardown(),
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

    # Run the module's real start work BEFORE flipping the flag. Flipping
    # first and hoping would mean a module that failed to start still reads
    # `running` — the exact dishonesty this agent exists to avoid.
    hook = definition.get("on_start")
    if hook is not None:
        try:
            hook()
        except Exception as exc:  # noqa: BLE001 — surfaced, not swallowed
            return ToggleResult(
                ok=False,
                error="start_failed",
                advisory=getattr(exc, "gap", None) or str(exc)[:200],
            )

    with _lock:
        _enabled[module_id] = True
    return ToggleResult(ok=True, status="running")


def stop_module(module_id: str) -> ToggleResult:
    definition = MODULE_DEFS.get(module_id)
    if definition is None:
        return ToggleResult(ok=False, error="unknown_module")

    # The flag goes down first here — the opposite order from start, and
    # deliberately so. If teardown half-succeeds, "stopped" is the safer lie
    # than "running": it tells the operator to check, rather than implying
    # enforcement that may no longer exist.
    with _lock:
        _enabled[module_id] = False

    hook = definition.get("on_stop")
    advisory = None
    if hook is not None:
        try:
            hook()
        except Exception as exc:  # noqa: BLE001
            advisory = f"stopped, but cleanup reported: {str(exc)[:160]}"
    return ToggleResult(ok=True, status="stopped", advisory=advisory)
