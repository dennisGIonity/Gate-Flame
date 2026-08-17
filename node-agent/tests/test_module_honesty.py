"""
Module registry honesty tests.

WHY THESE EXIST

On the first real hardware deployment the agent was serving genuine data while
telling the UI it was switched off:

    GET /api/v1/clients   -> 4 real devices, real MACs, matching the router's
                             own DHCP table
    GET /api/v1/services  -> {"id": "module_passive_discovery",
                              "status": "stopped",
                              "gap": "requires `ip` (iproute2) on PATH"}

Both halves of that were wrong:

  1. `stopped` - the module had never been "started" because nothing calls
     /start for an observe-only module. But it was demonstrably working.
  2. the gap - `ip` was present at /usr/bin/ip. The check lambdas return their
     gap string unconditionally, and the caller attached it whenever it was
     truthy, so a SATISFIED requirement still reported a gap.

This registry's stated design centre is never to show a green light over a
capability that is not there. These tests cover the inverse failure, which is
just as damaging: a red light over a capability that IS there makes the
dashboard fall back to demo values on a node that had real data to show.
"""

import pytest

from gateflame import services


PASSIVE = ["module_telemetry", "module_passive_discovery", "module_dns_filter"]
ACTIVE = ["module_firewall_bounce"]


def test_passive_modules_report_running_when_their_requirement_is_met():
    """No one calls /start for an observe-only module. It is on or it cannot be."""
    status = services.module_status("module_telemetry")
    assert status["status"] == "running", (
        "telemetry has no requirement and no start hook - it is always running"
    )


def test_a_satisfied_requirement_carries_no_gap():
    """The exact regression: `ip` present, gap still reported."""
    status = services.module_status("module_telemetry")
    assert "gap" not in status, f"gap present on a passing check: {status.get('gap')}"


def test_passive_discovery_is_running_when_ip_is_on_path(monkeypatch):
    monkeypatch.setattr(services, "_has", lambda binary: True)
    status = services.module_status("module_passive_discovery")
    assert status["status"] == "running"
    assert "gap" not in status


def test_passive_discovery_degrades_with_a_named_gap_when_ip_is_missing(monkeypatch):
    """The honest-gap path must still work - this is the case it was built for."""
    monkeypatch.setattr(services, "_has", lambda binary: False)
    status = services.module_status("module_passive_discovery")
    assert status["status"] == "degraded"
    assert "iproute2" in status["gap"]


def test_dns_filter_degrades_when_pihole_is_unreachable(monkeypatch):
    monkeypatch.setattr(services.pihole, "reachable", lambda: False)
    status = services.module_status("module_dns_filter")
    assert status["status"] == "degraded"
    assert "Pi-hole" in status["gap"]


def test_dns_filter_runs_when_pihole_is_reachable(monkeypatch):
    monkeypatch.setattr(services.pihole, "reachable", lambda: True)
    status = services.module_status("module_dns_filter")
    assert status["status"] == "running"
    assert "gap" not in status


def test_active_modules_still_require_an_explicit_start(monkeypatch):
    """Modules that CHANGE the system must not self-start.

    The firewall bouncer drops traffic. It reporting `running` before anyone
    asked for it would be the original dishonesty, just inverted.
    """
    monkeypatch.setattr(services.firewall, "capability", lambda: (True, None))
    services._enabled.pop("module_firewall_bounce", None)
    status = services.module_status("module_firewall_bounce")
    assert status["status"] == "stopped"


def test_no_module_reports_running_while_its_check_fails(monkeypatch):
    """The core invariant, restated: capability gates status for every module."""
    monkeypatch.setattr(services, "_has", lambda binary: False)
    monkeypatch.setattr(services.pihole, "reachable", lambda: False)
    for module in services.list_modules():
        if module.get("gap"):
            assert module["status"] != "running", (
                f"{module['id']} claims running while reporting a gap"
            )


def test_every_module_with_a_gap_has_a_non_running_status():
    """Whatever this node's real state is, gap and running must never coexist."""
    for module in services.list_modules():
        if "gap" in module:
            assert module["status"] in {"degraded", "not_implemented", "stopped"}
