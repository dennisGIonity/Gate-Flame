# ========================================================================================
# GATE^FLAME - HOW MUCH OF THE NETWORK THE BOX TAKES
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# The product promise these tests exist to protect:
#
#   A standard box is a SIDE-CAR. Household traffic never passes through it, so
#   nothing it does can make the connection slower. It must fix a broken network
#   by itself, with nobody touching a router, and it must never take an action
#   whose failure mode is "the house is offline".
#
# Every test below is one way that promise could quietly stop being true.
# ========================================================================================

from __future__ import annotations

from gateflame.netclaim import (
    PRODUCT_PREMIUM,
    PRODUCT_STANDARD,
    TIER_CLAIM,
    TIER_OFFER,
    Capabilities,
    NetworkFacts,
    assess,
)

# The network measured in the field on 2026-08-18, exactly as found.
THE_LIVE_FAULT = NetworkFacts(
    lan_ip="192.168.0.10",
    lan_addresses=(("eth0", "192.168.0.10/24"), ("wlan0", "192.168.0.13/24")),
    gateway_ip="192.168.0.1",
    gateway_forwards_to_us=False,
    ipv6_global_addresses=("fd00::9c95:3d9:8452:fde2",),
    ipv6_default_route=False,
    ra_dns_servers=("fe80::7a20:51ff:fe9f:1e8b",),
    serves_dns_on_ipv6=False,
    rate_limit_count=1000,
    loopback_listener_ok=True,
    lan_listener_ok=True,
)

HEALTHY = NetworkFacts(
    lan_ip="192.168.0.10",
    lan_addresses=(("eth0", "192.168.0.10/24"),),
    gateway_ip="192.168.0.1",
    gateway_forwards_to_us=True,
    rate_limit_count=0,
)

PI5 = Capabilities(
    product=PRODUCT_STANDARD, uplink_kind="wired", uplink_mbit=1000, failsafe_proven=True
)
ZERO2W = Capabilities(product=PRODUCT_STANDARD, uplink_kind="wireless", uplink_mbit=65)
PREMIUM = Capabilities(
    product=PRODUCT_PREMIUM, uplink_kind="wired", uplink_mbit=1000, failsafe_proven=True
)


# ── 1. The side-car promise ────────────────────────────────────────────────


def test_a_standard_box_never_claims_the_gateway_even_on_capable_hardware():
    """THE LOAD-BEARING TEST.

    A Pi 5 could forward a household at line rate. It is still a standard box,
    and a standard box sells "we will never slow your internet down". That
    promise cannot depend on which board shipped, so capability must not become
    permission. If this ever fails, the product's central claim is false.
    """
    plan = assess(THE_LIVE_FAULT, PI5)
    claim = next(r for r in plan.remedies if r.id == "claim_gateway")
    assert not claim.automatic
    assert "ceiling" in (claim.blocked_reason or "")
    assert PI5.max_tier == TIER_OFFER


def test_a_premium_box_with_headroom_and_a_proven_failsafe_does_claim():
    plan = assess(THE_LIVE_FAULT, PREMIUM)
    claim = next(r for r in plan.remedies if r.id == "claim_gateway")
    assert claim.automatic
    assert plan.tier_reached == TIER_CLAIM


def test_a_premium_box_on_wireless_refuses_to_claim():
    """Routing a house through one Wi-Fi radio halves it. Worse than absent."""
    caps = Capabilities(product=PRODUCT_PREMIUM, uplink_kind="wireless", uplink_mbit=65)
    claim = next(r for r in assess(THE_LIVE_FAULT, caps).remedies if r.id == "claim_gateway")
    assert not claim.automatic
    assert "wireless" in claim.blocked_reason


def test_a_premium_box_without_a_proven_failsafe_refuses_to_claim():
    """Claiming without a tested withdrawal is an outage with extra steps."""
    caps = Capabilities(
        product=PRODUCT_PREMIUM, uplink_kind="wired", uplink_mbit=1000, failsafe_proven=False
    )
    claim = next(r for r in assess(THE_LIVE_FAULT, caps).remedies if r.id == "claim_gateway")
    assert not claim.automatic
    assert "withdrawal" in claim.blocked_reason


def test_an_unknown_wired_speed_is_not_treated_as_fast_enough():
    caps = Capabilities(
        product=PRODUCT_PREMIUM, uplink_kind="wired", uplink_mbit=None, failsafe_proven=True
    )
    assert not caps.can_forward_household
    assert caps.max_tier == TIER_OFFER


# ── 2. The fault that was actually in the field ────────────────────────────


def test_the_live_fault_is_healed_without_anyone_touching_a_router():
    """The whole point. Zero customer action, on the standard box."""
    plan = assess(THE_LIVE_FAULT, PI5)
    automatic = {r.id for r in plan.automatic}
    assert "suppress_aaaa" in automatic, "the handset-dropping fault must self-heal"
    assert "disable_rate_limit" in automatic
    for remedy in plan.automatic:
        assert remedy.tier in (TIER_OFFER, "heal")


def test_dead_ipv6_is_what_triggers_aaaa_suppression_not_ipv6_itself():
    """Working IPv6 must never be degraded. That would be sabotage, not safety."""
    working_v6 = NetworkFacts(
        lan_ip="192.168.0.10",
        ipv6_global_addresses=("2001:db8::1",),
        ipv6_default_route=True,
        gateway_forwards_to_us=True,
        rate_limit_count=0,
    )
    ids = assess(working_v6, PI5).ids
    assert "suppress_aaaa" not in ids
    assert "serve_dns_on_ipv6" in ids, "working IPv6 means we must filter it, not hide it"


def test_aaaa_is_not_suppressed_twice():
    already = NetworkFacts(
        lan_ip="192.168.0.10",
        ipv6_global_addresses=("fd00::1",),
        ipv6_default_route=False,
        aaaa_suppressed=True,
        gateway_forwards_to_us=True,
        rate_limit_count=0,
    )
    assert "suppress_aaaa" not in assess(already, PI5).ids


def test_a_healthy_network_produces_no_actions_at_all():
    """A check that cries wolf gets switched off."""
    plan = assess(HEALTHY, PI5)
    assert plan.remedies == ()
    assert plan.posture == "protected"
    assert plan.headline == "Your network is protected."


# ── 3. Refusing to act on a guess ──────────────────────────────────────────


def test_undetermined_router_forwarding_produces_no_gateway_action():
    """Silence is not permission.

    Claiming a gateway because a probe timed out is the most destructive thing
    this product could do. `None` must behave like `True`, never like `False`.
    """
    unknown = NetworkFacts(
        lan_ip="192.168.0.10", gateway_ip="192.168.0.1",
        gateway_forwards_to_us=None, rate_limit_count=0,
    )
    plan = assess(unknown, PREMIUM)
    assert "claim_gateway" not in plan.ids
    assert any("UNDETERMINED" in n for n in plan.notes)


def test_dual_homing_is_never_fixed_automatically():
    """The fix is to take an interface down, and the box cannot know which one a
    human is reaching it on. Getting that wrong disconnects us from the only
    network that could tell us we did."""
    plan = assess(THE_LIVE_FAULT, PI5)
    single = next(r for r in plan.remedies if r.id == "single_home")
    assert not single.automatic
    assert "reachable" in single.blocked_reason


# ── 4. Honesty about what the customer is getting ──────────────────────────


def test_a_router_bypassing_us_that_we_cannot_stop_reports_unprotected():
    """A device we are not filtering must never be reported as protected."""
    assert assess(THE_LIVE_FAULT, PI5).posture == "unprotected"


def test_the_same_fault_on_a_premium_box_that_can_fix_it_is_not_unprotected():
    assert assess(THE_LIVE_FAULT, PREMIUM).posture != "unprotected"


def test_customer_sentences_carry_no_jargon():
    """These strings go on a kiosk in someone's hallway."""
    banned = ("RDNSS", "AAAA", "ARP", "RA ", "nftables", "dnsmasq", "FTL", "MAC")
    for caps in (PI5, ZERO2W, PREMIUM):
        for remedy in assess(THE_LIVE_FAULT, caps).remedies:
            for word in banned:
                assert word not in remedy.customer_sentence, (
                    f"{remedy.id} leaks '{word}' to the customer: "
                    f"{remedy.customer_sentence}"
                )


def test_the_headline_never_blames_the_customers_equipment():
    headline = assess(THE_LIVE_FAULT, PI5).headline
    for word in ("misconfigured", "wrong", "faulty", "broken router", "your fault"):
        assert word not in headline.lower()


# ── 5. Details that would silently break a decision ────────────────────────


def test_our_own_advertised_address_is_recognised_in_any_written_form():
    """String comparison here would start a second RA competing with our own.

    An abbreviated IPv6 address and its expanded form are the same server.
    """
    ours = NetworkFacts(
        lan_ip="192.168.0.10",
        our_ipv6_lan_address="fd00::10",
        ra_dns_servers=("fd00:0000:0000:0000:0000:0000:0000:0010",),
        ipv6_global_addresses=("fd00::10",),
        ipv6_default_route=True,
        serves_dns_on_ipv6=True,
        gateway_forwards_to_us=True,
        rate_limit_count=0,
    )
    assert "advertise_self_as_dns" not in assess(ours, PI5).ids


def test_a_scoped_link_local_address_still_matches():
    ours = NetworkFacts(
        lan_ip="192.168.0.10",
        our_ipv6_lan_address="fe80::1",
        ra_dns_servers=("fe80::1%eth0",),
        ipv6_global_addresses=("fd00::10",),
        ipv6_default_route=True,
        serves_dns_on_ipv6=True,
        gateway_forwards_to_us=True,
        rate_limit_count=0,
    )
    assert "advertise_self_as_dns" not in assess(ours, PI5).ids


def test_rate_limit_of_zero_is_already_correct():
    facts = NetworkFacts(lan_ip="192.168.0.10", gateway_forwards_to_us=True, rate_limit_count=0)
    assert "disable_rate_limit" not in assess(facts, PI5).ids


def test_an_unreadable_rate_limit_is_not_guessed_at():
    facts = NetworkFacts(lan_ip="192.168.0.10", gateway_forwards_to_us=True, rate_limit_count=None)
    assert "disable_rate_limit" not in assess(facts, PI5).ids


def test_a_dead_lan_listener_with_healthy_loopback_is_caught():
    """The silent whole-house outage, from the other side of the system."""
    facts = NetworkFacts(
        lan_ip="192.168.0.10", gateway_forwards_to_us=True, rate_limit_count=0,
        loopback_listener_ok=True, lan_listener_ok=False,
    )
    plan = assess(facts, PI5)
    assert "rebind_lan_listener" in {r.id for r in plan.automatic}


def test_a_malformed_address_does_not_crash_the_assessment():
    """A garbled RDNSS entry must not take the whole health model down."""
    facts = NetworkFacts(
        lan_ip="192.168.0.10", gateway_forwards_to_us=True, rate_limit_count=0,
        ra_dns_servers=("not-an-address", ""),
    )
    plan = assess(facts, PI5)
    assert "advertise_self_as_dns" in plan.ids
