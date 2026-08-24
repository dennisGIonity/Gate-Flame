"""`protectionStatus` must never say "active" when nothing is being blocked.

REGRESSION FIXTURE: the live box, 2026-08-24.

GF-72TYTITQ answered /api/v1/filtering with:

    {"protectionStatus":"active","enabled":true,
     "threatLevel":{"level":"low","blocklistCount":1}}

while `pihole -q doubleclick.net` found 0 domains in 0 lists, gravity held 0
domains, and the box resolved doubleclick.net to a real address. It had never
filtered anything since it was built.

The cause was mundane - the agent had no environment, so GATEFLAME_PIHOLE_URL
was unset and every blocklists.apply() failed with "Pi-hole unreachable". The
DEFECT was that none of that reached the payload: the API rendered the owner's
intent and called it the state of the network.

main.py already carried the right instinct for the watchdog-bypass case, in a
comment saying that reporting "active" there "would be the single most
misleading thing this API could do". These tests extend that rule to the two
failure modes the bypass check cannot see.
"""

from __future__ import annotations

import dataclasses

import pytest

from gateflame import blocklists, main

REACHABLE = "http://127.0.0.1:8081"


@pytest.fixture(autouse=True)
def _clean_module_state(monkeypatch):
    """No bypass flag, no leftover error. Each test states its own world."""
    monkeypatch.setattr(main, "pihole_bypass_active", lambda: False)
    monkeypatch.setattr(blocklists, "_last_error", None, raising=False)
    monkeypatch.setattr(blocklists, "_applying", False, raising=False)
    yield


def _set_pihole_url(monkeypatch, url):
    """Swap main's `config` binding for a copy.

    Config is a frozen dataclass, so setattr on the instance raises
    FrozenInstanceError - which is the point of freezing it. `replace` builds a
    new one and we rebind the name main actually reads.
    """
    monkeypatch.setattr(
        main, "config", dataclasses.replace(main.config, pihole_api_url=url)
    )


def _payload():
    return main._filtering_state_payload()


# ------------------------------------------------------- the live-box scenario


def test_no_pihole_url_is_never_reported_as_active(monkeypatch):
    """The exact 2026-08-24 state: enabled intent, no way to act on it."""
    _set_pihole_url(monkeypatch, None)

    out = _payload()

    assert out["protectionStatus"] == "unconfigured"
    # The load-bearing assertion. Everything else here is detail; this is the bug.
    assert out["protectionStatus"] != "active"
    assert out["enabled"] is False


def test_unconfigured_is_known_without_ever_having_tried(monkeypatch):
    """Survives an agent restart, which is why it is not based on last_error.

    `last_error` is module state and dies with the process. An agent that boots
    and has not yet attempted an apply has no error to report - so a check that
    relied on it alone would call a permanently-broken box healthy for as long
    as nobody touched a toggle.
    """
    _set_pihole_url(monkeypatch, None)
    monkeypatch.setattr(blocklists, "_last_error", None, raising=False)

    assert _payload()["protectionStatus"] == "unconfigured"


def test_a_failed_apply_is_reported_as_degraded(monkeypatch):
    _set_pihole_url(monkeypatch, REACHABLE)
    monkeypatch.setattr(blocklists, "_last_error", "Pi-hole unreachable", raising=False)

    out = _payload()

    assert out["protectionStatus"] == "degraded"
    assert out["enabled"] is False
    assert out["lastError"] == "Pi-hole unreachable"


def test_a_healthy_box_still_reports_active(monkeypatch):
    """Non-vacuity: the checks above must not condemn a working box."""
    _set_pihole_url(monkeypatch, REACHABLE)

    out = _payload()

    assert out["protectionStatus"] == "active"
    assert out["enabled"] is True
    assert out["lastError"] is None


# ------------------------------------------------------------- ordering rules


def test_bypass_still_outranks_everything(monkeypatch):
    """Bypass is a box FAILURE and must not be relabelled by the new checks."""
    monkeypatch.setattr(main, "pihole_bypass_active", lambda: True)
    _set_pihole_url(monkeypatch, None)

    assert _payload()["protectionStatus"] == "bypass"


def test_a_deliberate_pause_is_not_called_a_fault(monkeypatch):
    """An owner switching protection off is a CHOICE, not a degradation.

    Conflating the two would teach the customer to ignore the fault state,
    because they would meet it every time they used the pause button.
    """
    _set_pihole_url(monkeypatch, None)
    main.store.pause_filtering("indefinite", None, "testing")
    try:
        out = _payload()
        assert out["protectionStatus"] == "paused"
        assert out["protectionStatus"] != "unconfigured"
    finally:
        main.store.resume_filtering()


# ---------------------------------------------------------- contract for the UI


def test_the_diagnostic_fields_are_always_present(monkeypatch):
    """Absent-on-success would be indistinguishable from an older agent."""
    _set_pihole_url(monkeypatch, REACHABLE)

    out = _payload()

    assert "applying" in out
    assert "lastError" in out


def test_a_rebuild_in_progress_is_visible(monkeypatch):
    """So a surface can show a spinner instead of implying the change landed."""
    _set_pihole_url(monkeypatch, REACHABLE)
    monkeypatch.setattr(blocklists, "_applying", True, raising=False)

    assert _payload()["applying"] is True
