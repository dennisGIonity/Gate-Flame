"""A slow gravity rebuild is not a failed one.

THE FAULT THIS PINS, found on the live box 2026-09-06.

Dennis moved the threat level from Medium to High. That took the box from
347,905 gravity domains to 3.08 million. The rebuild ran for minutes and
finished correctly - Pi-hole logged "Gravity database has been updated,
reloading now" - but `apply()` had sent the gravity POST with the same 30
second timeout it uses for a list add, httpx gave up, `_post` returned None,
and the code recorded:

    _last_error = "gravity rebuild failed"

So the threat dial reported broken BECAUSE it was asked to do more work. The
bigger the blocklist, the more likely the "failure" - exactly backwards. The
kiosk then rendered the resulting `degraded` state as "Paused - unknown
duration", telling the owner they had switched protection off.

This module's own docstring said a rebuild is "tens of seconds on a Pi",
eight lines above `_TIMEOUT = 30.0`. Nothing in 548 tests connected the two,
because no test ever let a rebuild take longer than its timeout.

THE RULE THIS ENFORCES

The project already says: never claim success without a read-back. These
tests say the mirror: NEVER CLAIM FAILURE WITHOUT A READ-BACK. A dropped
connection is evidence about the connection, not about what Pi-hole did.
"""

from __future__ import annotations

import httpx
import pytest

from gateflame import blocklists


@pytest.fixture(autouse=True)
def _fast_polling(monkeypatch):
    """Keep the verify loop honest but quick - the logic is what is under test."""
    monkeypatch.setattr(blocklists, "_GRAVITY_VERIFY_INTERVAL", 0.0)
    monkeypatch.setattr(blocklists, "_GRAVITY_VERIFY_SECONDS", 1.0)
    blocklists._last_error = None
    yield
    blocklists._last_error = None


def _settings():
    return {"enabled": True, "threat_level": "high", "categories": ["adult"]}


def _wire(monkeypatch, *, gravity_raises: bool, summaries: list):
    """Pi-hole that accepts every list write, and whose gravity POST times out.

    `summaries` is consumed one call at a time by summary(), so a test can say
    "the count was X, then later it was Y".
    """
    wanted = blocklists.desired_lists(_settings())

    monkeypatch.setattr(blocklists, "current_lists", lambda: list(wanted))

    calls = {"gravity": 0}

    def fake_post(path, payload, timeout=None):
        if path.startswith("/api/action/gravity"):
            calls["gravity"] += 1
            calls["timeout"] = timeout
            if gravity_raises:
                return None
            return {"ok": True}
        return {"ok": True}

    monkeypatch.setattr(blocklists, "_post", fake_post)
    monkeypatch.setattr(blocklists, "_delete", lambda path: True)

    seq = list(summaries)

    def fake_summary():
        return seq.pop(0) if seq else (summaries[-1] if summaries else None)

    monkeypatch.setattr(blocklists, "summary", fake_summary)
    return calls


def test_gravity_gets_a_bigger_timeout_than_a_list_write(monkeypatch):
    """The regression in one line: the rebuild must not inherit _TIMEOUT."""
    calls = _wire(
        monkeypatch,
        gravity_raises=False,
        summaries=[{"domainsOnGravity": 347905}, {"domainsOnGravity": 3082238}],
    )
    assert blocklists.apply(_settings()) is True
    assert calls["gravity"] == 1
    assert calls["timeout"] is not None, "gravity POST sent with the default 30s timeout"
    assert calls["timeout"] > blocklists._TIMEOUT, (
        f"gravity timeout {calls['timeout']} is not greater than the "
        f"list-write timeout {blocklists._TIMEOUT} - a 3M-domain rebuild will "
        "be reported as a failure again"
    )


def test_timeout_then_completion_is_a_success_not_a_failure(monkeypatch):
    """The exact 2026-09-06 sequence: POST dies, Pi-hole finishes anyway."""
    _wire(
        monkeypatch,
        gravity_raises=True,
        summaries=[
            {"domainsOnGravity": 347905},   # before the rebuild
            {"domainsOnGravity": 347905},   # still the old build, mid-rebuild
            {"domainsOnGravity": 3082238},  # finished
        ],
    )
    assert blocklists.apply(_settings()) is True
    assert blocklists.last_error() is None, (
        "a rebuild that completed was recorded as an error - this is the "
        "bug that made the threat dial look broken for four hours"
    )


def test_a_rebuild_that_never_finishes_is_still_a_failure(monkeypatch):
    """NON-VACUITY. The fix must not turn every failure into a success."""
    _wire(
        monkeypatch,
        gravity_raises=True,
        summaries=[{"domainsOnGravity": 347905}],  # count never moves
    )
    assert blocklists.apply(_settings()) is False
    assert blocklists.last_error(), "a genuinely stuck rebuild must record an error"
    assert "did not finish" in blocklists.last_error()


def test_an_unchanged_count_is_not_proof_of_a_new_build(monkeypatch):
    """A non-zero count is not the same as a NEW count.

    The previous gravity was also non-zero. Accepting "non-zero" as proof of
    completion would let a failed apply report success - the same false-green
    that a restart produced on the live box.
    """
    _wire(
        monkeypatch,
        gravity_raises=True,
        summaries=[{"domainsOnGravity": 347905}, {"domainsOnGravity": 347905}],
    )
    assert blocklists.apply(_settings()) is False


def test_pihole_never_coming_back_is_a_failure(monkeypatch):
    """summary() returning None forever must not be read as 'finished'."""
    _wire(monkeypatch, gravity_raises=True, summaries=[{"domainsOnGravity": 1}, None])
    monkeypatch.setattr(blocklists, "summary", lambda: None)
    assert blocklists.apply(_settings()) is False
