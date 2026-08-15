"""Idempotency, replay, and a node whose clock is wrong or lying."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from .conftest import NODE_A, auth, valid_payload


def _stamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_identical_report_twice_stores_one_row(client, store, token_a):
    """`_send_once` returns False on any transport error, including a response
    lost on the way back — so the agent re-posts byte-identical content."""
    payload = valid_payload()
    first = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
    second = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))

    assert first.status_code == 202 and first.json()["status"] == "stored"
    assert second.status_code == 202 and second.json()["status"] == "duplicate"
    assert store.report_count(NODE_A) == 1
    # History is not corrupted and the count the support console shows is honest.
    assert store.list_nodes()[0]["reportCount"] == 1


def test_replay_is_detected_regardless_of_json_key_order(client, store, token_a):
    """The dedupe key is the validated model, not the raw bytes.

    An HTTP client that reorders keys, or emits `38` where the last one emitted
    `38.0`, is still sending the same report.
    """
    payload = valid_payload()
    client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))

    reordered = {k: payload[k] for k in reversed(list(payload))}
    reordered["host"] = {**payload["host"], "diskUsedPercent": 38.0}
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=reordered, headers=auth(token_a))
    assert r.json()["status"] == "duplicate"
    assert store.report_count(NODE_A) == 1


def test_a_genuinely_new_report_is_stored(client, store, token_a):
    client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
    later = valid_payload(sentAt=_stamp(datetime.now(timezone.utc) + timedelta(seconds=1)))
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=later, headers=auth(token_a))
    assert r.json()["status"] == "stored"
    assert store.report_count(NODE_A) == 2


def test_replay_does_not_consume_rate_budget(cfg, store, token_a):
    """A retry storm must not lock a node out of its next real report.

    If the dedupe check ran after the limiter, a node whose responses were
    being dropped would burn its whole hourly budget on retries of a report
    the server already has, and then be unable to send the next one.
    """
    from fastapi.testclient import TestClient

    from gateflame_feed.config import Config
    from gateflame_feed.main import create_app

    tight = Config(
        db_path=cfg.db_path,
        admin_token=cfg.admin_token,
        token_pepper=cfg.token_pepper,
        min_interval_seconds=0.0,
        max_reports_per_hour=3,
    )
    payload = valid_payload()
    with TestClient(create_app(tight, store)) as c:
        assert c.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a)).status_code == 202
        for _ in range(20):
            r = c.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
            assert r.status_code == 202 and r.json()["status"] == "duplicate"

        fresh = valid_payload(sentAt=_stamp(datetime.now(timezone.utc) + timedelta(seconds=5)))
        r = c.post(f"/api/v1/nodes/{NODE_A}/health", json=fresh, headers=auth(token_a))
        assert r.status_code == 202, "replays consumed the node's budget"


# ---- clock skew -----------------------------------------------------------


def test_future_timestamp_is_stored_but_flagged_and_never_used_for_ordering(client, store, token_a):
    """A node claiming to be five years ahead must not become immortal or
    permanently 'freshest' on the support console."""
    future = valid_payload(sentAt=_stamp(datetime.now(timezone.utc) + timedelta(days=1825)))
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=future, headers=auth(token_a))
    assert r.status_code == 202
    body = r.json()
    assert body["clockSuspect"] is True
    assert body["clockSkewSeconds"] > 0

    # lastSeen is the server's receive time, not the node's claim.
    node = store.list_nodes()[0]
    assert abs(node["lastSeen"] - time.time()) < 5
    history = store.node_history(NODE_A, 10)
    assert history[0]["clockSuspect"] is True
    assert abs(history[0]["receivedAt"] - time.time()) < 5


def test_past_timestamp_from_a_pi_with_no_rtc_is_still_accepted(client, store, token_a):
    """A Pi has no battery-backed clock. A unit that boots without NTP
    genuinely believes it is 1970 — and is exactly the unit support needs to
    see, so its health is stored rather than thrown away."""
    ancient = valid_payload(sentAt="1970-01-01T00:00:00Z")
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=ancient, headers=auth(token_a))
    assert r.status_code == 202
    assert r.json()["clockSuspect"] is True
    assert store.report_count(NODE_A) == 1


def test_a_1970_timestamp_does_not_make_the_row_instantly_prunable(client, store, cfg, token_a):
    """Pruning keys on received_at. If it keyed on sentAt, a node with a dead
    RTC would have its health deleted the moment it landed."""
    client.post(
        f"/api/v1/nodes/{NODE_A}/health",
        json=valid_payload(sentAt="1970-01-01T00:00:00Z"),
        headers=auth(token_a),
    )
    assert store.prune(cfg.retention_days, cfg.max_rows_per_node) == 0
    assert store.report_count(NODE_A) == 1


def test_a_far_future_timestamp_does_not_make_a_row_immortal(client, store, token_a):
    client.post(
        f"/api/v1/nodes/{NODE_A}/health",
        json=valid_payload(sentAt=_stamp(datetime.now(timezone.utc) + timedelta(days=3000))),
        headers=auth(token_a),
    )
    # Retention measured from the server's clock still reaches it.
    assert store.prune(retention_days=0, max_rows_per_node=10_000) == 1
    assert store.report_count(NODE_A) == 0


def test_absurd_timestamps_are_refused(client, store, token_a):
    """Beyond ±10 years is not a clock problem, it is garbage or a probe."""
    for stamp in ("1901-01-01T00:00:00Z", "2400-01-01T00:00:00Z"):
        r = client.post(
            f"/api/v1/nodes/{NODE_A}/health",
            json=valid_payload(sentAt=stamp),
            headers=auth(token_a),
        )
        assert r.status_code == 422
        assert r.json()["detail"]["error"] == "implausible_timestamp"
    assert store.report_count() == 0


def test_unparseable_timestamp_is_a_schema_error(client, store, token_a):
    r = client.post(
        f"/api/v1/nodes/{NODE_A}/health",
        json=valid_payload(sentAt="last tuesday"),
        headers=auth(token_a),
    )
    assert r.status_code == 422
    assert r.json()["error"] == "schema_rejected"
    assert store.report_count() == 0


def test_offset_timestamps_are_normalised_not_rejected(client, store, token_a):
    now = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=2)))  # SAST
    r = client.post(
        f"/api/v1/nodes/{NODE_A}/health",
        json=valid_payload(sentAt=now.strftime("%Y-%m-%dT%H:%M:%S+02:00")),
        headers=auth(token_a),
    )
    assert r.status_code == 202
    assert r.json()["clockSuspect"] is False
    assert abs(r.json()["clockSkewSeconds"]) < 5
