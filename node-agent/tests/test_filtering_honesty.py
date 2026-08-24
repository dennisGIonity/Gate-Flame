"""`protectionStatus` must never say "active" when nothing is being blocked.

REGRESSION FIXTURE: the live box, 2026-08-24. Two states, not one.

STATE A - before the systemd drop-in was written.
GF-72TYTITQ answered /api/v1/filtering with protectionStatus "active",
enabled true, blocklistCount 1, while gravity held 0 domains and the box
resolved doubleclick.net to a real address. GATEFLAME_PIHOLE_URL was unset, so
every blocklists.apply() had failed with "Pi-hole unreachable".

STATE B - AFTER the drop-in was written, and this is the important one.
The agent could now read Pi-hole perfectly: 131,068 queries today, 0 blocked,
0 domains on gravity. No apply had been ATTEMPTED since the restart, so
last_error was None. Every local signal said healthy. A first version of this
check trusted last_error alone and would have called State B "active" too.

The lesson those two states teach together: the only authority on whether
anything is being blocked is the thing doing the blocking. Local intent,
however carefully tracked, is not evidence.

Underneath both is a real gap, still open: blocklists.apply() runs only on a
settings CHANGE. Nothing reconciles wanted-against-loaded at boot, so an empty
box stays empty indefinitely. Until that exists, this comparison is the only
thing between a customer and a green light over an unprotected network.
"""

from __future__ import annotations

import dataclasses

import pytest

from gateflame import blocklists, main, pihole

REACHABLE = "http://127.0.0.1:8081"

# Pi-hole answering normally, with a real blocklist loaded.
HEALTHY = {
    "totalQueriesToday": 131068,
    "queriesBlockedToday": 4127,
    "blockPercentage": 3.1,
    "domainsOnGravity": 151234,
    "activeClientsCount": 3,
}

# The live box's State B, verbatim: answering, busy, blocking nothing.
EMPTY_GRAVITY = {
    "totalQueriesToday": 131068,
    "queriesBlockedToday": 0,
    "blockPercentage": 0.0,
    "domainsOnGravity": 0,
    "activeClientsCount": 3,
}


@pytest.fixture(autouse=True)
def _clean_module_state(monkeypatch):
    """No bypass, no leftover error, Pi-hole healthy. Tests state their own world."""
    monkeypatch.setattr(main, "pihole_bypass_active", lambda: False)
    monkeypatch.setattr(blocklists, "_last_error", None, raising=False)
    monkeypatch.setattr(blocklists, "_applying", False, raising=False)
    monkeypatch.setattr(pihole, "summary", lambda: dict(HEALTHY))
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


def _summary(monkeypatch, value):
    monkeypatch.setattr(pihole, "summary", lambda: value)


def _payload():
    return main._filtering_state_payload()


# --------------------------------------------------- STATE A: no Pi-hole at all


def test_no_pihole_url_is_never_reported_as_active(monkeypatch):
    _set_pihole_url(monkeypatch, None)

    out = _payload()

    assert out["protectionStatus"] == "unconfigured"
    assert out["enabled"] is False
    assert out["lastError"]


def test_unconfigured_is_known_without_ever_having_tried(monkeypatch):
    """Survives an agent restart, which is why it is not based on last_error.

    `last_error` is module state and dies with the process. An agent that boots
    and has not yet attempted an apply has no error to report.
    """
    _set_pihole_url(monkeypatch, None)
    monkeypatch.setattr(blocklists, "_last_error", None, raising=False)

    assert _payload()["protectionStatus"] == "unconfigured"


# ------------------------------------- STATE B: Pi-hole fine, blocking nothing


def test_empty_gravity_is_degraded_even_with_no_recorded_error(monkeypatch):
    """THE ONE THE FIRST VERSION OF THIS CHECK GOT WRONG.

    Pi-hole is reachable and answering. No apply has failed, because none has
    been attempted since the restart. Everything local says healthy. Gravity is
    empty, so not one of those 131,068 queries was filtered.
    """
    _set_pihole_url(monkeypatch, REACHABLE)
    _summary(monkeypatch, dict(EMPTY_GRAVITY))
    monkeypatch.setattr(blocklists, "_last_error", None, raising=False)

    out = _payload()

    assert out["protectionStatus"] == "degraded"
    assert out["enabled"] is False
    assert "no blocklist" in out["lastError"]


def test_pihole_not_answering_is_degraded_not_active(monkeypatch):
    """A resolver we cannot question is not a resolver we can vouch for."""
    _set_pihole_url(monkeypatch, REACHABLE)
    _summary(monkeypatch, None)

    out = _payload()

    assert out["protectionStatus"] == "degraded"
    assert out["enabled"] is False
    assert "not answering" in out["lastError"]


LIST_URL = "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"


def test_a_failed_apply_is_reported_as_degraded(monkeypatch):
    _set_pihole_url(monkeypatch, REACHABLE)
    monkeypatch.setattr(blocklists, "_last_error", "Pi-hole unreachable", raising=False)
    # Lists genuinely wrong: Pi-hole has none of what was asked for.
    monkeypatch.setattr(blocklists, "current_lists", lambda: [])

    out = _payload()

    assert out["protectionStatus"] == "degraded"
    assert out["lastError"] == "Pi-hole unreachable"


def test_a_stale_error_is_dropped_when_pihole_contradicts_it(monkeypatch):
    """FOUND ON THE LIVE BOX 2026-08-24, after the fix.

    Gravity was repaired from the CLI - outside the agent - so nothing cleared
    `_last_error`. The box was demonstrably filtering (242 blocked, 82,562
    domains loaded) and the API still said degraded / "gravity rebuild failed".

    A false "degraded" is the same class of error as a false "active", pointed
    the other way. A customer told they are unprotected while they ARE protected
    learns to ignore the status, which costs exactly as much.
    """
    _set_pihole_url(monkeypatch, REACHABLE)
    monkeypatch.setattr(blocklists, "_last_error", "gravity rebuild failed", raising=False)
    # Pi-hole says otherwise: the wanted list is loaded and gravity is populated.
    monkeypatch.setattr(blocklists, "current_lists", lambda: [LIST_URL])

    out = _payload()

    assert out["protectionStatus"] == "active"
    assert out["enabled"] is True
    assert out["lastError"] is None
    assert blocklists.last_error() is None, "the stale error must be cleared, not just hidden"


# ------------------------------------------------------------- non-vacuity


def test_a_genuinely_filtering_box_still_reports_active(monkeypatch):
    """The checks above must not condemn a box that is actually working."""
    _set_pihole_url(monkeypatch, REACHABLE)
    _summary(monkeypatch, dict(HEALTHY))

    out = _payload()

    assert out["protectionStatus"] == "active"
    assert out["enabled"] is True
    assert out["lastError"] is None


def test_zero_blocked_today_is_not_a_fault(monkeypatch):
    """A quiet network is not a broken one.

    Gravity is loaded; nothing blockable has been asked for yet. Treating that
    as degraded would show a fault on every freshly-booted healthy box.
    """
    _set_pihole_url(monkeypatch, REACHABLE)
    _summary(monkeypatch, {**HEALTHY, "queriesBlockedToday": 0, "blockPercentage": 0.0})

    assert _payload()["protectionStatus"] == "active"


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
    _set_pihole_url(monkeypatch, REACHABLE)
    _summary(monkeypatch, dict(EMPTY_GRAVITY))
    main.store.pause_filtering("indefinite", None, "testing")
    try:
        out = _payload()
        assert out["protectionStatus"] == "paused"
        assert out["protectionStatus"] != "degraded"
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
