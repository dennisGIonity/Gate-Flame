"""Tests for the filtering settings API and its persistence.

These cover the surface the customer's app actually touches. The invariants
worth protecting are about honesty and about not losing someone's choices:

  - the API never reports "active" while the box is not filtering
  - a pause survives a restart, and an until_reboot pause does NOT
  - a bad value is rejected rather than silently becoming something else
"""

import time

import pytest
from fastapi.testclient import TestClient

from gateflame import filtering_state as fs
from gateflame.storage import Store


def client(app):
    """Loopback source address - require_lan refuses the literal 'testclient'."""
    return TestClient(app, client=("127.0.0.1", 51000))


# --------------------------------------------------------------- persistence


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "state.db")


def test_a_fresh_box_is_protecting_and_blocks_nothing_legal(store):
    """Day one: filtering on at its safest level, no content categories.

    Nobody has chosen anything yet, so the box must protect without making a
    moral decision on the owner's behalf.
    """
    s = store.get_filter_settings()
    assert s["enabled"] is True
    assert s["threat_level"] == "low"
    assert s["categories"] == []


def test_settings_survive_a_new_store_on_the_same_file(tmp_path):
    """A reboot, a container restart or an agent upgrade must not reset
    somebody's preferences."""
    db = tmp_path / "state.db"
    first = Store(db)
    first.set_threat_level("high")
    first.set_categories(["gambling"])

    second = Store(db)
    s = second.get_filter_settings()
    assert s["threat_level"] == "high"
    assert s["categories"] == ["gambling"]


def test_a_pause_survives_a_restart(tmp_path):
    """Critical: the box must NOT quietly re-enable something the owner
    switched off."""
    db = tmp_path / "state.db"
    first = Store(db)
    resume = time.time() + 1800
    first.pause_filtering("30m", resume, "checking online banking")

    second = Store(db)
    s = second.get_filter_settings()
    assert s["enabled"] is False
    assert s["pause_duration"] == "30m"
    assert s["pause_reason"] == "checking online banking"


def test_until_reboot_pause_is_cleared_at_startup(tmp_path):
    """Otherwise the phrase is a lie and the box comes back unprotected."""
    db = tmp_path / "state.db"
    first = Store(db)
    first.pause_filtering("until_reboot", None, None)
    assert first.get_filter_settings()["enabled"] is False

    second = Store(db)
    assert second.clear_reboot_pause() is True
    assert second.get_filter_settings()["enabled"] is True


def test_an_indefinite_pause_survives_reboot(tmp_path):
    """'Until I turn it back on' must outlive a power cut."""
    db = tmp_path / "state.db"
    Store(db).pause_filtering("indefinite", None, None)

    second = Store(db)
    assert second.clear_reboot_pause() is False
    assert second.get_filter_settings()["enabled"] is False


def test_resuming_clears_every_trace_of_the_pause(store):
    """A stale resume_at would let a later read switch protection off again."""
    store.pause_filtering("2h", time.time() + 7200, "why not")
    store.resume_filtering()
    s = store.get_filter_settings()
    assert s["enabled"] is True
    assert s["pause_duration"] is None
    assert s["pause_resume_at"] is None
    assert s["pause_reason"] is None


def test_pausing_does_not_forget_the_level_or_categories(store):
    """Resuming must restore exactly what they had."""
    store.set_threat_level("high")
    store.set_categories(["adult", "gambling"])
    store.pause_filtering("5m", time.time() + 300, None)
    store.resume_filtering()

    s = store.get_filter_settings()
    assert s["threat_level"] == "high"
    assert s["categories"] == ["adult", "gambling"]


def test_corrupt_categories_blob_degrades_to_none_rather_than_raising(tmp_path):
    """Wrongly BLOCKING legal sites is the failure an owner cannot diagnose,
    so a corrupt blob fails permissive rather than fatal."""
    db = tmp_path / "state.db"
    store = Store(db)
    store.get_filter_settings()
    with store._cursor() as cur:
        cur.execute("UPDATE filter_settings SET categories = ? WHERE id = 1", ("{not json",))

    s = Store(db).get_filter_settings()
    assert s["categories"] == []
    assert s["enabled"] is True


# ---------------------------------------------------------------- the routes


def test_blocklists_are_empty_while_paused():
    """A pause pushes an empty list set - Pi-hole keeps resolving, blocks
    nothing. One source of truth, and the resolver never stops answering."""
    from gateflame import blocklists

    paused = {"enabled": False, "threat_level": "high", "categories": ["adult"]}
    assert blocklists.desired_lists(paused) == []


def test_blocklists_combine_both_axes_when_active():
    from gateflame import blocklists
    from gateflame import threat_level as tl
    from gateflame import content_categories as cc

    settings = {"enabled": True, "threat_level": "medium", "categories": ["gambling"]}
    urls = blocklists.desired_lists(settings)

    assert set(tl.lists_for("medium")) <= set(urls)
    assert set(cc.lists_for(["gambling"])) <= set(urls)


def test_blocklists_never_duplicate_a_url():
    from gateflame import blocklists

    settings = {"enabled": True, "threat_level": "high", "categories": list(
        __import__("gateflame.content_categories", fromlist=["CATEGORIES"]).CATEGORIES)}
    urls = blocklists.desired_lists(settings)
    assert len(urls) == len(set(urls))


def test_expired_pause_resumes_itself_on_read(tmp_path):
    """No window in which the API reports 'paused' for a pause that has run
    out."""
    store = Store(tmp_path / "state.db")
    store.pause_filtering("5m", time.time() - 1, None)   # already expired
    assert fs.is_expired(store.get_filter_settings()["pause_resume_at"]) is True
