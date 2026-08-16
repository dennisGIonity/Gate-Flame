"""Tests for pausing filtering.

The customer may switch protection off. That is their right - it is their
network. These tests are about the two things that must remain true when they
do:

  1. the product never LOOKS protected while it is not
  2. the common case (a five-minute diagnostic) cannot be forgotten about,
     because the box resumes on its own
"""

import pytest

from gateflame import filtering_state as fs


NOW = 1_000_000.0


def test_the_default_pause_is_short():
    """Almost every real reason to pause is a quick diagnostic. Forgetting to
    re-enable is the actual risk, so the default must expire by itself."""
    assert fs.DEFAULT_DURATION == "5m"
    assert fs.resume_at(fs.DEFAULT_DURATION, NOW) == NOW + 300


def test_short_options_come_first():
    """The dangerous option must not be the easiest one to tap."""
    assert fs.DURATION_ORDER[0] == "5m"
    assert fs.DURATION_ORDER[-1] == "indefinite"


def test_timed_pauses_expire():
    resume = fs.resume_at("5m", NOW)
    assert not fs.is_expired(resume, NOW + 299)
    assert fs.is_expired(resume, NOW + 301)


def test_indefinite_never_auto_resumes():
    """'Until I turn it back on' must mean exactly that. A box that silently
    re-enabled something the owner switched off would be overriding them."""
    assert fs.resume_at("indefinite", NOW) is None
    assert fs.is_expired(None, NOW + 10_000_000) is False


def test_until_reboot_has_no_timer_either():
    assert fs.resume_at("until_reboot", NOW) is None


def test_countdown_never_goes_negative():
    """A UI should not have to special-case a negative countdown."""
    resume = fs.resume_at("5m", NOW)
    assert fs.seconds_remaining(resume, NOW) == 300
    assert fs.seconds_remaining(resume, NOW + 600) == 0
    assert fs.seconds_remaining(None, NOW) is None


def test_enabled_state_reports_active():
    state = fs.describe(enabled=True)
    assert state["protectionStatus"] == "active"
    assert state["enabled"] is True
    assert state["pausedUntil"] is None


def test_paused_state_is_reported_as_unprotected():
    """THE test in this file. A paused box must never read as protected."""
    state = fs.describe(enabled=False, duration="30m",
                        resume_time=fs.resume_at("30m", NOW), now=NOW)
    assert state["protectionStatus"] == "paused"
    assert state["enabled"] is False
    assert state["protectionStatus"] != "active"


def test_paused_state_says_how_long_is_left():
    state = fs.describe(enabled=False, duration="2h",
                        resume_time=fs.resume_at("2h", NOW), now=NOW)
    assert state["secondsRemaining"] == 7200
    assert state["durationLabel"] == "2 hours"


def test_indefinite_pause_shows_no_countdown_but_still_reads_paused():
    state = fs.describe(enabled=False, duration="indefinite", resume_time=None)
    assert state["protectionStatus"] == "paused"
    assert state["secondsRemaining"] is None
    assert "turn it back on" in state["durationLabel"].lower()


def test_the_reason_is_echoed_back():
    """So a household member who finds protection off can see it was a choice
    rather than assuming the box is broken."""
    state = fs.describe(enabled=False, duration="5m",
                        resume_time=fs.resume_at("5m", NOW),
                        reason="testing whether the box breaks online banking",
                        now=NOW)
    assert "banking" in state["reason"]


def test_paused_and_bypass_are_distinguishable():
    """Both are unprotected; the remedy is completely different.

    'paused' is a button the owner pressed. 'bypass' is a fault the watchdog
    fell back to. Collapsing them would mean telling someone to press a button
    that will not fix their outage.
    """
    paused = fs.describe(enabled=False, duration="5m", resume_time=None)
    assert paused["protectionStatus"] == "paused"
    assert paused["protectionStatus"] != "bypass"


def test_long_pauses_require_confirmation():
    """Not forbidden - just not something to tap through by accident."""
    options = {d["id"]: d for d in fs.all_durations()}
    assert options["5m"]["requiresConfirmation"] is False
    assert options["30m"]["requiresConfirmation"] is False
    assert options["indefinite"]["requiresConfirmation"] is True
    assert options["until_reboot"]["requiresConfirmation"] is True


def test_every_duration_is_labelled_in_plain_language():
    for option in fs.all_durations():
        assert option["label"]
        assert option["id"] not in option["label"], "label must not just repeat the id"


@pytest.mark.parametrize("bad", [None, "", "forever", "10y", "0", "5M"])
def test_unknown_durations_are_rejected(bad):
    """A malformed duration must not become an accidental indefinite pause."""
    assert fs.valid_duration(bad) is False


def test_valid_durations_are_accepted():
    for duration in fs.DURATION_ORDER:
        assert fs.valid_duration(duration) is True
