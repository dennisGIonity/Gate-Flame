# ========================================================================================
# GATE^FLAME - HEALTH FEED: A CONSOLE THAT FORGOT THIS BOX MUST NOT SILENCE IT FOREVER
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# WHAT THESE PIN (BUG-30, 2026-10-03)
#
# The fleet console on the laptop was rebuilt on 2026-09-26 with an empty database. The
# lab Pi kept presenting the per-node token the August console had issued; the new one
# had no row for it, answered 401, and health_feed never tried anything else - 105
# check-ins refused in a row, fleet.db empty, the dashboard blank. A console database
# that is restored, migrated to the real server, or lost would do that to every box.
#
# The rule now: a STORED token that is refused earns exactly one retry with the shared
# enrolment token. 201 -> the console enrolled this box again, the new token replaces
# the old. 401 again -> the console knows this box under a token it no longer holds
# (or the shared token changed); that is a person's job and the log says so. The
# shared token is never retried when it IS the token that was refused, and a box that
# has no shared token has nothing to fall back to.
# ========================================================================================

import dataclasses
import logging

import httpx
import pytest

from gateflame import health_feed


class _Resp:
    def __init__(self, status: int, body: dict | None = None):
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


class _Store:
    """Just enough of Store: one settings dict and a node id."""

    def __init__(self, stored_token: str | None):
        self.settings = {}
        if stored_token:
            self.settings[health_feed.FEED_TOKEN_KEY] = stored_token

    def node_id(self):
        return "GF-TEST"

    def get_setting(self, key):
        return self.settings.get(key)

    def set_setting(self, key, value):
        self.settings[key] = value

    def device_names(self):
        return {}


@pytest.fixture
def feed(monkeypatch):
    """Patch the network and the payload; return the list of (url, bearer) posts made,
    driven by a scripted list of responses."""
    posts: list[tuple[str, str | None]] = []
    script: list[_Resp] = []

    def fake_post(url, json=None, headers=None, timeout=None):
        posts.append((url, (headers or {}).get("Authorization")))
        assert script, "more posts than scripted responses"
        return script.pop(0)

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(health_feed, "build_payload", lambda store: {"nodeId": "GF-TEST"})
    monkeypatch.setattr(
        health_feed, "config",
        dataclasses.replace(health_feed.config, feed_url="http://fleet.test/api/v1/nodes",
                            feed_token="shared-enrol-token"),
    )
    monkeypatch.setattr(health_feed, "_consecutive_failures", 0)
    monkeypatch.setattr(health_feed, "_last_error", None)
    return posts, script


def test_refused_stored_token_is_retried_once_with_the_shared_token_and_replaced(feed, caplog):
    posts, script = feed
    store = _Store("old-per-node-token")
    script += [_Resp(401), _Resp(201, {"nodeToken": "fresh-per-node-token"})]
    with caplog.at_level(logging.WARNING, logger="gateflame.health_feed"):
        assert health_feed._send_once(store) is True
    assert [b for _, b in posts] == ["Bearer old-per-node-token", "Bearer shared-enrol-token"]
    assert store.settings[health_feed.FEED_TOKEN_KEY] == "fresh-per-node-token"
    assert health_feed._consecutive_failures == 0
    assert "BUG-30" in caplog.text


def test_shared_token_refused_too_is_one_failure_and_a_loud_line(feed, caplog):
    posts, script = feed
    store = _Store("old-per-node-token")
    script += [_Resp(401), _Resp(401)]
    with caplog.at_level(logging.ERROR, logger="gateflame.health_feed"):
        assert health_feed._send_once(store) is False
    assert len(posts) == 2
    # Nothing was replaced: the box keeps the token it had, a person decides.
    assert store.settings[health_feed.FEED_TOKEN_KEY] == "old-per-node-token"
    assert health_feed._consecutive_failures == 1
    assert "DELETE /api/v1/nodes/GF-TEST/token" in caplog.text


def test_a_refused_shared_token_is_not_retried_with_itself(feed):
    """First contact, shared token wrong: one post, one failure - no loop."""
    posts, script = feed
    store = _Store(None)
    script += [_Resp(401)]
    assert health_feed._send_once(store) is False
    assert [b for _, b in posts] == ["Bearer shared-enrol-token"]
    assert health_feed.FEED_TOKEN_KEY not in store.settings


def test_no_shared_token_means_no_retry(feed, monkeypatch):
    posts, script = feed
    monkeypatch.setattr(health_feed, "config", dataclasses.replace(health_feed.config, feed_token=None))
    store = _Store("old-per-node-token")
    script += [_Resp(401)]
    assert health_feed._send_once(store) is False
    assert len(posts) == 1


def test_an_accepted_stored_token_posts_once_and_keeps_it(feed):
    posts, script = feed
    store = _Store("good-per-node-token")
    script += [_Resp(204)]
    assert health_feed._send_once(store) is True
    assert len(posts) == 1
    assert store.settings[health_feed.FEED_TOKEN_KEY] == "good-per-node-token"


def test_first_enrolment_still_stores_the_issued_token(feed):
    posts, script = feed
    store = _Store(None)
    script += [_Resp(201, {"nodeToken": "issued-1"})]
    assert health_feed._send_once(store) is True
    assert store.settings[health_feed.FEED_TOKEN_KEY] == "issued-1"
