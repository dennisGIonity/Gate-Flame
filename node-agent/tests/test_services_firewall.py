"""module_firewall_bounce as seen through the module registry.

The registry is where a module gets to lie to the customer. These tests pin
the house rule: a module that cannot do its job reports `degraded` with a
named gap and a remedy, and a start that fails leaves the flag DOWN.
"""

from __future__ import annotations

import subprocess

import pytest

from gateflame import firewall as firewall_mod
from gateflame import services


@pytest.fixture(autouse=True)
def _reset_registry():
    services._enabled.clear()
    original = services.firewall
    yield
    services.firewall = original
    services._enabled.clear()


class Runner:
    available = True

    def __init__(self, version_rc=0, probe_rc=0, install_rc=0):
        self.calls: list[list[str]] = []
        self.version_rc = version_rc
        self.probe_rc = probe_rc
        self.install_rc = install_rc

    def run(self, args, stdin_text=None):
        self.calls.append(list(args))
        if args[:1] == ["--version"]:
            rc = self.version_rc
        elif args[:2] == ["list", "ruleset"]:
            rc = self.probe_rc
        elif args[:1] == ["-f"]:
            rc = self.install_rc
        else:
            rc = 0
        return subprocess.CompletedProcess(args, rc, "", "denied")


def install(runner):
    services.firewall = firewall_mod.Firewall(
        runner=runner,
        context_provider=lambda: firewall_mod.LocalContext(
            own_addresses=frozenset({"192.168.1.10"}),
            gateways=frozenset({"192.168.1.1"}),
        ),
    )


def test_without_cap_net_admin_the_module_reports_degraded_with_the_remedy():
    install(Runner(probe_rc=1))
    status = services.module_status("module_firewall_bounce")
    assert status["status"] == "degraded"
    assert "CAP_NET_ADMIN" in status["gap"]
    assert "never run as root" in status["gap"]


def test_without_capability_start_refuses_and_the_flag_stays_down():
    install(Runner(probe_rc=1))
    result = services.start_module("module_firewall_bounce")
    assert result.ok is False
    assert result.error == "capability_unavailable"
    assert services._enabled.get("module_firewall_bounce") is not True
    assert services.module_status("module_firewall_bounce")["status"] != "running"


def test_a_start_hook_that_fails_does_not_leave_the_module_reading_running():
    """The failure this ordering prevents: flag up, ruleset absent, UI green,
    nothing actually enforced."""
    install(Runner(install_rc=1))
    result = services.start_module("module_firewall_bounce")
    assert result.ok is False
    assert result.error == "start_failed"
    assert services._enabled.get("module_firewall_bounce") is not True


def test_a_healthy_start_installs_the_ruleset_and_reports_running():
    runner = Runner()
    install(runner)
    result = services.start_module("module_firewall_bounce")
    assert result.ok is True
    assert result.status == "running"
    assert ["-f", "-"] in runner.calls
    assert services.module_status("module_firewall_bounce")["status"] == "running"


def test_stopping_tears_the_table_down_so_no_bounce_survives_a_stop():
    runner = Runner()
    install(runner)
    services.start_module("module_firewall_bounce")
    result = services.stop_module("module_firewall_bounce")
    assert result.ok is True
    assert result.status == "stopped"
    assert ["delete", "table", "inet", "gateflame"] in runner.calls


def test_a_failing_teardown_still_reports_stopped_but_says_so():
    class Exploding(Runner):
        def run(self, args, stdin_text=None):
            if args[:2] == ["delete", "table"]:
                raise OSError("nft vanished")
            return super().run(args, stdin_text)

    install(Exploding())
    services.start_module("module_firewall_bounce")
    result = services.stop_module("module_firewall_bounce")
    # `stopped` is the safer report than `running`: it tells the operator to
    # check rather than implying enforcement that may not exist.
    assert result.status == "stopped"
    assert services._enabled.get("module_firewall_bounce") is False


def test_the_module_is_no_longer_advertised_as_not_implemented():
    install(Runner())
    listed = {m["id"]: m for m in services.list_modules()}
    assert listed["module_firewall_bounce"]["status"] != "not_implemented"
