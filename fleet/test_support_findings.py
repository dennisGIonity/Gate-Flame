"""The support assistant must only ever say what the node reported.

Its entire value is that a support person can trust it. The moment it fills a
gap with a plausible-sounding sentence it becomes worse than nothing, because
it will be believed. These tests exist to keep it honest rather than to check
that it produces output at all.

Run: python -m pytest test_support_findings.py -q
"""
import pytest

import app


def _detail(**over):
    base = {
        "nodeId": "GF-TEST0001",
        "status": "online",
        "lastSeenAgoSeconds": 30,
        "piholeReachable": True,
        "modules": [{"id": "module_dns_filter", "status": "running", "gap": None}],
        "host": {"diskUsedPercent": 20.0, "tempC": 45.0},
        "shield": {"configured": False, "enabledCount": 0, "devices": []},
        "shieldReported": True,
    }
    base.update(over)
    return base


def test_a_healthy_box_produces_no_findings():
    """No findings at all, rather than a reassuring 'all good' entry. An empty
    list is unambiguous; a green row is one more thing to read."""
    assert app._support_findings(_detail()) == []


def test_premium_modules_being_stopped_is_not_a_fault():
    """firewall_bounce, dpi_flow and zero_trust are SUPPOSED to be off on a
    standard box. Listing them would bury the one finding that matters under
    three that never did - the fastest way to make a support tool ignored."""
    d = _detail(modules=[
        {"id": "module_dns_filter", "status": "running", "gap": None},
        {"id": "module_firewall_bounce", "status": "stopped", "gap": None},
        {"id": "module_dpi_flow", "status": "stopped", "gap": None},
        {"id": "module_zero_trust", "status": "stopped", "gap": None},
    ])
    assert app._support_findings(d) == []


def test_the_filter_being_down_is_critical_and_comes_first():
    d = _detail(
        modules=[{"id": "module_dns_filter", "status": "degraded", "gap": None}],
        host={"diskUsedPercent": 90.0, "tempC": 45.0},
    )
    f = app._support_findings(d)
    assert f[0]["severity"] == "critical"
    assert "DNS filtering" in f[0]["title"]


def test_the_nodes_own_gap_text_wins_over_our_generic_advice():
    """The node's gap is written for exactly this moment and is more specific
    than anything a lookup table can say. Summarising it away would throw out
    the most useful sentence available."""
    gap = ("no WAN interface configured - set GATEFLAME_WAN_INTERFACES (e.g. "
           "GATEFLAME_WAN_INTERFACES=eth0); the WAN link is not guessed, because "
           "guessing wrong bills LAN traffic against the customer's data cap")
    d = _detail(modules=[
        {"id": "module_dns_filter", "status": "running", "gap": None},
        {"id": "module_wan_audit", "status": "degraded", "gap": gap},
    ])
    f = app._support_findings(d)
    assert len(f) == 1
    assert f[0]["check"] == gap


def test_offline_does_not_claim_the_household_is_unprotected():
    """The box reports OUTWARD. Silence proves nothing about whether filtering
    is working, and support telling a customer 'you are unprotected' on that
    evidence would be wrong AND alarming."""
    d = _detail(status="offline", lastSeenAgoSeconds=40000)
    f = app._support_findings(d)
    assert f[0]["severity"] == "critical"
    assert "does not prove" in f[0]["customer"]
    # And it should point at the local reality rather than assuming the worst.
    assert "load shedding" in f[0]["check"]


def test_unreadable_shield_is_distinguished_from_unconfigured_shield():
    unreadable = app._support_findings(_detail(shield=None, shieldReported=True))
    unconfigured = app._support_findings(
        _detail(shield={"configured": False, "enabledCount": 0, "devices": []})
    )
    assert any("could not read" in f["title"] for f in unreadable)
    assert unconfigured == []


def test_an_older_agent_that_never_reports_shield_is_not_a_fault():
    """A box running an agent that predates the field has not failed at
    anything. Flagging it would put a red row on every unupgraded box."""
    d = _detail(shield=None, shieldReported=False)
    assert app._support_findings(d) == []


def test_every_finding_names_the_field_it_came_from():
    """`evidence` is what lets a support person tell 'the box told us this'
    from 'the console worked this out'. A finding without it is an assertion."""
    d = _detail(
        status="offline", lastSeenAgoSeconds=40000, piholeReachable=False,
        host={"diskUsedPercent": 97.0, "tempC": 80.0},
        modules=[{"id": "module_dns_filter", "status": "degraded", "gap": None}],
    )
    f = app._support_findings(d)
    assert len(f) >= 5
    for entry in f:
        assert entry.get("evidence"), f"finding {entry['title']!r} cites no field"
        for key in ("severity", "title", "customer", "check"):
            assert entry.get(key), f"finding {entry['title']!r} is missing {key}"


def test_missing_host_metrics_produce_no_invented_findings():
    """A payload without disk or temp must yield silence about disk and temp,
    not a default or a zero treated as a reading."""
    d = _detail(host={})
    assert app._support_findings(d) == []
