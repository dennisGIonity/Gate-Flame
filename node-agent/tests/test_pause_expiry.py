"""A timed pause ends on time AND puts the blocklists back.

THE BUG (found in review, 2026-09-26). A pause removes every list from Pi-hole.
When a 5-minute pause ran out, the /filtering payload flipped `enabled` back on
in the database - and nothing re-applied the lists. The settings said
"protected", Pi-hole held the empty paused set, /filtering reported `degraded`
("Pi-hole has no blocklist loaded"), and the household stayed unfiltered until a
human touched a toggle or the box rebooted. With no screen open, the pause did
not even end: expiry only happened "the moment anyone looks".

filtering_state.py promises "PAUSED IS TEMPORARY ... the box resumes on its
own". These tests are that promise.
"""

from __future__ import annotations

import time

import pytest

from gateflame import blocklists, filtering_state, main


@pytest.fixture
def applied(monkeypatch):
    calls: list = []
    monkeypatch.setattr(blocklists, "apply_async", lambda store: calls.append(store))
    monkeypatch.setattr(main, "pihole_bypass_active", lambda: False)
    yield calls
    main.store.resume_filtering()


def _expired_pause():
    main.store.pause_filtering("5m", time.time() - 1, "testing")


def test_an_expired_pause_is_ended_and_reapplied(applied):
    _expired_pause()
    assert main.end_expired_pause() is True
    assert main.store.get_filter_settings()["enabled"] is True
    assert applied == [main.store], "ending a pause must put the lists back"


def test_reading_filtering_after_expiry_reapplies(applied):
    """The path the old code took - and the step it skipped."""
    _expired_pause()
    out = main._filtering_state_payload()
    assert out["protectionStatus"] != "paused"
    assert len(applied) == 1


def test_a_running_pause_is_left_alone(applied):
    main.store.pause_filtering("30m", filtering_state.resume_at("30m"), None)
    assert main.end_expired_pause() is False
    assert main.store.get_filter_settings()["enabled"] is False
    assert applied == []


def test_an_indefinite_pause_never_expires(applied):
    main.store.pause_filtering("indefinite", None, None)
    assert main.end_expired_pause() is False
    assert applied == []


def test_expiry_is_applied_once_even_when_polled_concurrently(applied):
    import threading

    _expired_pause()
    results: list = []
    threads = [threading.Thread(target=lambda: results.append(main.end_expired_pause())) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(5)
    assert results.count(True) == 1
    assert len(applied) == 1


def test_the_pause_watch_ends_a_pause_with_nobody_looking(applied):
    _expired_pause()
    watch = main.PauseWatch(interval=0.02)
    watch.start()
    try:
        deadline = time.monotonic() + 5
        while main.store.get_filter_settings()["enabled"] is False and time.monotonic() < deadline:
            time.sleep(0.02)
    finally:
        watch.stop()
    assert main.store.get_filter_settings()["enabled"] is True
    assert len(applied) == 1
