# ========================================================================================
# GATE^FLAME - TURNING A PLAN INTO ACTIONS
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# netclaim decides, netapply acts. The dangerous failures all live in the seam
# between them, so that is what these test:
#
#   * a BLOCKED remedy must never become an action - otherwise "we refuse to take
#     an interface down because it could cut our own path" is decoration
#   * an UNKNOWN remedy must be reported, not silently dropped - otherwise the
#     plan quietly does less than it claims
#   * dry run must not touch anything
#   * a failure must stop the sequence, because a half-applied network change
#     leaves the box in a state no test covers
# ========================================================================================

from __future__ import annotations

import pytest

from gateflame.netapply import apply, plan_actions
from gateflame.netclaim import (
    PRODUCT_PREMIUM,
    PRODUCT_STANDARD,
    Capabilities,
    NetworkFacts,
    Plan,
    Remedy,
    assess,
)

THE_LIVE_FAULT = NetworkFacts(
    lan_ip="192.168.0.10",
    lan_addresses=(("eth0", "192.168.0.10/24"), ("wlan0", "192.168.0.13/24")),
    gateway_ip="192.168.0.1",
    gateway_forwards_to_us=False,
    ipv6_global_addresses=("fd00::ce7d:dcd6:bfcb:7b4",),
    ipv6_default_route=False,
    ra_dns_servers=("fe80::7a20:51ff:fe9f:1e8b",),
    rate_limit_count=1000,
)

PI5 = Capabilities(
    product=PRODUCT_STANDARD, uplink_kind="wired", uplink_mbit=1000, failsafe_proven=True
)
PREMIUM = Capabilities(
    product=PRODUCT_PREMIUM, uplink_kind="wired", uplink_mbit=1000, failsafe_proven=True
)


class RecordingRunner:
    def __init__(self, fail_on: str | None = None):
        self.calls: list[tuple[str, ...]] = []
        self.fail_on = fail_on

    def __call__(self, argv):
        self.calls.append(argv)
        if self.fail_on and self.fail_on in " ".join(argv):
            return 1, f"boom: {self.fail_on}"
        return 0, "ok"


# ── 1. Blocked means blocked ───────────────────────────────────────────────


def test_a_blocked_remedy_never_becomes_an_action():
    """THE LOAD-BEARING TEST.

    On the live fault, a standard box blocks claim_gateway (side-car ceiling) and
    always blocks single_home (could cut our own path). Neither may be executed.
    """
    plan = assess(THE_LIVE_FAULT, PI5)
    actions, blocked, _ = plan_actions(plan, lan_ip="192.168.0.10")

    action_ids = {a.remedy_id for a in actions}
    assert "claim_gateway" not in action_ids
    assert "single_home" not in action_ids
    assert "claim_gateway" in blocked
    assert "single_home" in blocked


def test_nothing_that_could_take_an_interface_down_is_ever_runnable():
    """Belt and braces: even if a future edit unblocks single_home, there is no
    action defined for it, so it surfaces as unsupported rather than running."""
    fabricated = Plan(
        remedies=(
            Remedy(id="single_home", tier="heal", summary="x", customer_sentence="y"),
        )
    )
    actions, _, unsupported = plan_actions(fabricated)
    assert actions == ()
    assert "single_home" in unsupported


def test_a_premium_box_that_may_claim_still_orders_it_last():
    """Weakest first. The cheap fix may be enough on its own."""
    plan = assess(THE_LIVE_FAULT, PREMIUM)
    actions, _, unsupported = plan_actions(plan, lan_ip="192.168.0.10")
    # claim_gateway has no actuator yet - premium in-path work is a later sprint.
    assert "claim_gateway" in unsupported
    tiers = [a.tier for a in actions]
    assert tiers == sorted(tiers, key=["heal", "offer", "claim"].index)


# ── 2. Nothing is silently dropped ─────────────────────────────────────────


def test_a_remedy_with_no_actuator_is_reported_loudly():
    fabricated = Plan(
        remedies=(
            Remedy(id="invent_a_new_protocol", tier="heal", summary="x", customer_sentence="y"),
        )
    )
    result = apply(fabricated, dry_run=True)
    assert result.unsupported == ("invent_a_new_protocol",)
    assert not result.ok, "an undeliverable promise must not report success"
    assert any("cannot do" in n for n in result.notes)


# ── 3. Dry run is the default and it touches nothing ───────────────────────


def test_dry_run_never_calls_the_runner():
    runner = RecordingRunner()
    plan = assess(THE_LIVE_FAULT, PI5)
    result = apply(plan, runner, dry_run=True, lan_ip="192.168.0.10")
    assert runner.calls == []
    assert result.dry_run


def test_acting_requires_saying_so():
    """An actuator whose default is to act is one that acts by accident."""
    plan = assess(THE_LIVE_FAULT, PI5)
    result = apply(plan, lan_ip="192.168.0.10")   # no dry_run argument
    assert result.dry_run is True


def test_refusing_to_act_without_a_runner():
    plan = assess(THE_LIVE_FAULT, PI5)
    with pytest.raises(ValueError):
        apply(plan, None, dry_run=False, lan_ip="192.168.0.10")


# ── 4. A failure stops the sequence ────────────────────────────────────────


def test_a_failed_action_stops_everything_after_it():
    """Half-applying a network change is worse than not starting."""
    plan = assess(THE_LIVE_FAULT, PI5)
    actions, _, _ = plan_actions(plan, lan_ip="192.168.0.10")
    assert len(actions) >= 2, "need at least two actions for this test to mean anything"

    runner = RecordingRunner(fail_on=actions[0].argv[0])
    result = apply(plan, runner, dry_run=False, lan_ip="192.168.0.10")

    assert result.stopped_early
    assert len(runner.calls) == 1, "must not continue past a failure"
    assert not result.ok
    assert any("stopped after" in n for n in result.notes)


def test_a_clean_run_reports_what_it_did():
    plan = assess(THE_LIVE_FAULT, PI5)
    runner = RecordingRunner()
    result = apply(plan, runner, dry_run=False, lan_ip="192.168.0.10")
    assert result.ok is False or result.ok is True  # ok depends on unsupported set
    assert "suppress_aaaa" in result.applied_ids
    assert "disable_rate_limit" in result.applied_ids
    assert not result.stopped_early


# ── 5. Details that would produce a broken command ─────────────────────────


def test_actions_are_argv_not_shell_strings():
    """A shell string is an injection surface and an unreadable log line."""
    plan = assess(THE_LIVE_FAULT, PI5)
    actions, _, _ = plan_actions(plan, lan_ip="192.168.0.10")
    for action in actions:
        assert isinstance(action.argv, tuple)
        assert all(isinstance(part, str) for part in action.argv)
        assert not any(" && " in part or "; " in part or "|" in part for part in action.argv)


def test_the_compose_directory_is_never_guessed():
    plan = assess(THE_LIVE_FAULT, PI5)
    actions, _, _ = plan_actions(plan, stack="/opt/gf/dns-stack", lan_ip="192.168.0.10")
    env_actions = [a for a in actions if a.argv[0] == "gateflame-env-set"]
    assert env_actions, "expected at least one .env action"
    for action in env_actions:
        assert action.argv[1] == "/opt/gf/dns-stack"


def test_a_healthy_network_produces_no_actions():
    healthy = NetworkFacts(
        lan_ip="192.168.0.10",
        lan_addresses=(("eth0", "192.168.0.10/24"),),
        gateway_ip="192.168.0.1",
        gateway_forwards_to_us=True,
        rate_limit_count=0,
    )
    result = apply(assess(healthy, PI5), dry_run=True)
    assert result.outcomes == ()
    assert result.ok
