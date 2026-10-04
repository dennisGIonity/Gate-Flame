"""Module registry — honest capability reporting, scope-gated start/stop.

Every module declares what it needs (a binary on PATH, a capability, a
config) and checks for it at status time. Missing a requirement means
`degraded` or `not_implemented` with a named gap and remedy — never a faked
`running`. This is the design centre carried forward from the previous build.

Starting a module is allowed to any paired handset (`control` scope) —
restoring protection is what a remote is for. Stopping one requires `kiosk`
scope, because a real stop tears down enforcement and must survive a stolen,
still-paired phone. Restarting is `control`, like starting: it puts the same
protection back and switches nothing off. Only `module_dns_filter` has a
restart, and it is believed only on a read-back — see restart_module().

EVERY ACTION ANSWERS AT A STATUS CODE THAT TELLS THE TRUTH (BUG-31)
A refused or failed action used to come back as HTTP 200 with `ok: false` in
the body. Ionibot checked the status, as HTTP clients do, and told a customer
their filter had restarted when the box had answered "unknown_module". Now
(ToggleResult.http_status): 200 only when the action happened; 404 for a
module this box does not have; 409 when the box understood but its current
state will not allow it (requirement unmet, start hook failed, nothing to
stop or restart, a restart already running, Pi-hole refusing); 502 when
Pi-hole was asked to restart and did not come back.
"""

from __future__ import annotations

import os
import shutil
import threading
import time

from . import dpi as dpi_mod
from . import firewall as firewall_mod
from . import netcheck as netcheck_mod
from . import pihole
from . import posture as posture_mod
from . import wan as wan_mod

_lock = threading.Lock()
_enabled: dict[str, bool] = {}

# One controller per module for the process. Each is constructed here rather
# than per-request so the ruleset install latch, the counter state and the
# flow table all mean something across calls. None of these constructors may
# touch the network or the disk — see WanAudit's lazy store.
firewall = firewall_mod.Firewall()
wan = wan_mod.WanAudit()
posture = posture_mod.PostureAudit()
flows = dpi_mod.FlowTable()
# Holds no state between calls — every run shells out fresh, because a cached
# network check is a network check that can be wrong. Constructed here only so
# the script path is resolved once.
netcheck = netcheck_mod.NetcheckRunner()


def _has(binary: str) -> bool:
    return shutil.which(binary) is not None


# The DPI module has a parser (dpi.parse_frame) and a bounded flow table, and
# NOTHING THAT FEEDS THE TABLE: there is no AF_PACKET capture loop in this
# build. Its old registry check was the CAP_NET_RAW test alone, so a box that
# had the capability and a /start call reported `running` while observing
# nothing, and a box without it was told to go and grant a capability for a
# feature that does not exist. "Never `running` while silently doing nothing"
# is this registry's house rule (see firewall.py), so it now says what is true.
DPI_CAPTURE_GAP = (
    "not implemented: the packet capture loop that feeds this module is not built "
    "in this release - the parser exists, nothing captures (premium, in-path only)"
)


def flows_capture_state() -> dict:
    """Extra fields for /flows/recent so an empty list cannot read as 'nothing seen'."""
    return {"capturing": False, "gap": DPI_CAPTURE_GAP}


MODULE_DEFS = {
    # `passive: True` marks a module that observes rather than acts. It has no
    # start/stop hooks and nothing to enable, so once its requirement is met it
    # IS running — the data is already being served. Only modules that change
    # the system (firewall, DPI capture) wait to be switched on.
    "module_telemetry": {
        "label": "System Telemetry",
        "check": lambda: (True, None),
        "passive": True,
    },
    "module_passive_discovery": {
        "label": "Passive Client Discovery",
        "check": lambda: (_has("ip"), "requires `ip` (iproute2) on PATH"),
        "passive": True,
    },
    "module_dns_filter": {
        "label": "DNS Filtering",
        "check": lambda: (
            (True, None) if pihole.reachable() else (False, "Pi-hole not configured or unreachable")
        ),
        "passive": True,
        # Restarts pihole-FTL through Pi-hole's own API and reads it back.
        # There was never a start hook here, so Ionibot's old "restart" (a
        # /start on a module id that did not exist) could not have done
        # anything even with the right id.
        "on_restart": lambda: _restart_dns_filter(),
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
        # The parser was implemented 2026-08-14; the capture loop never was.
        # Reported as not_implemented until it is - see DPI_CAPTURE_GAP. When a
        # capture loop lands, this goes back to `dpi_mod.capability()`.
        "check": lambda: (False, DPI_CAPTURE_GAP),
    },
    "module_wan_audit": {
        "label": "WAN Quality & Budget",
        # Implemented 2026-08-14. Degrades when no WAN interface is
        # configured: the link is never guessed, because guessing wrong bills
        # LAN traffic against the customer's data cap.
        "check": lambda: wan.capability(),
    },
    "module_zero_trust": {
        "label": "Zero-Trust Posture",
        # Implemented 2026-08-14. Read-only: this module audits and never
        # remediates. Auditing and changing a customer's sshd config are
        # different products.
        "check": lambda: posture.capability(),
    },
}


def module_status(module_id: str) -> dict:
    definition = MODULE_DEFS.get(module_id)
    if definition is None:
        return {"id": module_id, "status": "unknown"}
    ok, gap = definition["check"]()

    # Passive modules are always on once their requirement is met. They observe
    # and report; there is nothing to switch. Reporting them as `stopped`
    # because no one called /start was a lie in the opposite direction to the
    # one this registry exists to prevent: telemetry and client discovery were
    # both serving real data on hardware while the UI was told they were off,
    # which is exactly what makes a dashboard fall back to demo values.
    passive = definition.get("passive", False)
    running = True if passive else _enabled.get(module_id, False)

    if not ok:
        status = "not_implemented" if gap and "not implemented" in gap else "degraded"
    else:
        status = "running" if running else "stopped"

    result = {"id": module_id, "label": definition["label"], "status": status}

    # A gap describes an UNMET requirement. The check lambdas return their gap
    # string unconditionally, so attaching it whenever it is truthy reported
    # "requires `ip` (iproute2) on PATH" on a node where `ip` was present at
    # /usr/bin/ip and the module was returning real ARP entries. A satisfied
    # requirement has no gap.
    if gap and not ok:
        result["gap"] = gap
    return result


def list_modules() -> list[dict]:
    return [module_status(mid) for mid in MODULE_DEFS]


UNKNOWN_MODULE_ADVISORY = "no module with that id exists on this box"

# The HTTP status of a FAILED action. Anything not listed is 409: the box
# answered, understood the request, and its current state will not allow it.
_HTTP_STATUS_FOR_ERROR = {
    "unknown_module": 404,
    "restart_failed": 502,
}


class ToggleResult:
    def __init__(
        self,
        ok: bool,
        status: str | None = None,
        error: str | None = None,
        advisory: str | None = None,
        extra: dict | None = None,
    ):
        self.ok = ok
        self.status = status
        self.error = error
        self.advisory = advisory
        # Further keys for the body, e.g. a restart's read-back.
        self.extra = dict(extra or {})

    @property
    def http_status(self) -> int:
        """200 only when the action happened. A failed action is never a 200 (BUG-31)."""
        if self.ok:
            return 200
        return _HTTP_STATUS_FOR_ERROR.get(self.error or "", 409)

    def to_dict(self) -> dict:
        out: dict = {"ok": self.ok}
        if self.status:
            out["status"] = self.status
        if self.error:
            out["error"] = self.error
        if self.advisory:
            out["advisory"] = self.advisory
        out.update(self.extra)
        return out


def start_module(module_id: str) -> ToggleResult:
    definition = MODULE_DEFS.get(module_id)
    if definition is None:
        return ToggleResult(ok=False, error="unknown_module", advisory=UNKNOWN_MODULE_ADVISORY)
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
        return ToggleResult(ok=False, error="unknown_module", advisory=UNKNOWN_MODULE_ADVISORY)

    # A passive module has nothing to stop: module_status() reports it running
    # whenever its requirement is met, whatever the flag says, and nothing else
    # reads the flag. Answering {ok: true, status: "stopped"} here was BUG-31's
    # lie in the other direction - a success for an action that changed
    # nothing - and the console's switch just snapped back with no reason.
    if definition.get("passive", False):
        return ToggleResult(
            ok=False,
            error="stop_unsupported",
            advisory=(
                f"{definition['label']} cannot be stopped: it runs whenever its requirement "
                "is met, so nothing was stopped"
            ),
        )

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


# --------------------------------------------------------------------- restart


def _seconds_from_env(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, default))
    except ValueError:
        return default
    return value if value > 0 else default


# How long a restarted Pi-hole has to answer again before the restart is
# reported as not having come back. Generous on purpose - "a warm run does not
# size a cold one" (CLAUDE.md): FTL re-reads its databases on start, and the
# lab box carries ~3 million gravity domains. NOT MEASURED on hardware yet;
# every successful restart returns `restartSeconds`, which is how it gets
# measured.
RESTART_WAIT_SECONDS = _seconds_from_env("GATEFLAME_PIHOLE_RESTART_WAIT_SECONDS", 15.0)
RESTART_POLL_SECONDS = 0.5
# Per-probe ceiling, so one hung read cannot eat the whole window.
RESTART_PROBE_TIMEOUT = 2.0
# Slack when comparing FTL's uptime clock with ours: small rate or rounding
# differences between two clocks on the same host.
_UPTIME_SLACK_MS = 1000.0

READ_BACK_RESTARTED = "Pi-hole answering again after restart"

# Pi-hole failures after which the restart MAY still have happened: the
# restarting process can cut the connection that asked for it. These go to
# the read-back. Every other failure is Pi-hole refusing, and is final.
_MAYBE_RESTARTED = frozenset({pihole.FAIL_UNREACHABLE, pihole.FAIL_TIMEOUT, pihole.FAIL_BAD_BODY})

# Test seams. Real time in production.
_clock = time.monotonic
_sleep = time.sleep

_restart_lock = threading.Lock()


def restart_module(module_id: str) -> ToggleResult:
    """Restart a module, and report success only when a read-back shows it happened."""
    definition = MODULE_DEFS.get(module_id)
    if definition is None:
        return ToggleResult(ok=False, error="unknown_module", advisory=UNKNOWN_MODULE_ADVISORY)
    hook = definition.get("on_restart")
    if hook is None:
        # No invented restarts: a module without one says so.
        return ToggleResult(
            ok=False,
            error="restart_unsupported",
            advisory=f"{definition['label']} has no restart on this box",
        )
    # A second restart landing while the first is coming back kills the new
    # process and makes the gap longer, not shorter. Refuse rather than queue.
    if not _restart_lock.acquire(blocking=False):
        return ToggleResult(
            ok=False,
            error="restart_in_progress",
            advisory="a restart is already under way - wait for it to finish",
        )
    try:
        return hook()
    finally:
        _restart_lock.release()


def _restarted(before: dict, after: dict, seconds_between: float, saw_outage: bool) -> bool:
    """Is the FTL answering now a different process image from the one read before?

    `seconds_between` must be a LOWER bound on the time between the two reads
    (end of the first to start of the second). Had the old process kept
    running it would be at least that much older, so a younger answer cannot
    be it. Measured the other way round, a slow probe would make the SAME
    process look younger than expected - a restart that never happened.
    """
    pid_before, pid_after = before.get("pid"), after.get("pid")
    if pid_before is not None and pid_after is not None and pid_before != pid_after:
        return True
    up_before, up_after = before.get("uptimeMs"), after.get("uptimeMs")
    if up_before is not None and up_after is not None:
        return up_after + _UPTIME_SLACK_MS < up_before + seconds_between * 1000.0
    # An FTL that reports no uptime: the only evidence left is having seen it
    # stop answering and then answer again.
    return saw_outage


def _restart_dns_filter() -> ToggleResult:
    """module_dns_filter's restart: pihole-FTL, read back from FTL itself.

    1. Read which FTL process is answering. If Pi-hole cannot be read, nothing
       is attempted: 409 capability_unavailable with the named reason.
    2. Ask Pi-hole to restart. A refusal (403 when destructive actions are off,
       a refused password) is final: 409, nothing restarted. A dropped
       connection is not - the restarting process may have cut it.
    3. Read back until a DIFFERENT process answers, or RESTART_WAIT_SECONDS
       pass: 502 restart_failed, saying which of the two it was.
    """
    before = pihole.ftl_process()
    before_done_at = _clock()
    if not before.ok:
        return ToggleResult(
            ok=False,
            error="capability_unavailable",
            advisory=pihole.gap_for(before.failure, "the filter", before.detail, verb="restarted"),
        )

    asked_at = _clock()
    action = pihole.restart_dns()
    if not action.ok and action.failure not in _MAYBE_RESTARTED:
        return ToggleResult(
            ok=False,
            error="capability_unavailable",
            advisory=pihole.gap_for(action.failure, "the filter", action.detail, verb="restarted"),
        )

    deadline = asked_at + RESTART_WAIT_SECONDS
    saw_outage = not action.ok
    # What the most recent probe read, or None when it got no answer.
    last_answer: dict | None = None
    while _clock() < deadline:
        _sleep(min(RESTART_POLL_SECONDS, max(deadline - _clock(), 0.0)))
        probe_at = _clock()
        probe = pihole.ftl_process(timeout=RESTART_PROBE_TIMEOUT)
        if not probe.ok:
            saw_outage = True
            last_answer = None
            continue
        last_answer = probe.data
        if _restarted(before.data, probe.data, probe_at - before_done_at, saw_outage):
            pihole.invalidate_cache()
            return ToggleResult(
                ok=True,
                status="running",
                extra={
                    "readBack": READ_BACK_RESTARTED,
                    "restartSeconds": round(_clock() - asked_at, 1),
                },
            )

    pihole.invalidate_cache()
    waited = f"{RESTART_WAIT_SECONDS:g}"
    if last_answer is None:
        advisory = (
            f"Pi-hole had not answered again {waited} seconds after the restart - "
            "it may still be starting, so check again in a minute"
        )
    elif before.data.get("uptimeMs") is not None and last_answer.get("uptimeMs") is not None:
        advisory = (
            f"Pi-hole accepted the restart but was still running as the same process "
            f"{waited} seconds later, so nothing was restarted"
        )
    else:
        # Answering, but with nothing to compare: say that, not "same process".
        advisory = (
            "Pi-hole is answering but does not report its uptime, so this box "
            "could not confirm that it restarted"
        )
    return ToggleResult(ok=False, error="restart_failed", advisory=advisory)
