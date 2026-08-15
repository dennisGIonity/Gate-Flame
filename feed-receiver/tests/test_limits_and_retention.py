"""Rate limiting, body size cap, and the 90-day retention promise."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from gateflame_feed.config import Config
from gateflame_feed.main import create_app

from .conftest import ADMIN_TOKEN, NODE_A, auth, valid_payload


def _stamp(offset_seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


@pytest.fixture
def limited_client(cfg, store):
    tight = Config(
        db_path=cfg.db_path,
        admin_token=cfg.admin_token,
        token_pepper=cfg.token_pepper,
        min_interval_seconds=30.0,
        max_reports_per_hour=3,
    )
    with TestClient(create_app(tight, store)) as c:
        yield c


def test_minimum_interval_between_distinct_reports(limited_client, store, token_a):
    """One broken node in a retry loop cannot fill the disk."""
    first = limited_client.post(
        f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(sentAt=_stamp(0)), headers=auth(token_a)
    )
    assert first.status_code == 202

    second = limited_client.post(
        f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(sentAt=_stamp(1)), headers=auth(token_a)
    )
    assert second.status_code == 429
    detail = second.json()["detail"]
    assert detail["error"] == "rate_limited"
    assert detail["reason"] == "min_interval"
    assert 0 < detail["retryAfterSeconds"] <= 30
    assert second.headers["Retry-After"]
    assert store.report_count(NODE_A) == 1, "a rate-limited report must not be stored"


def test_hourly_cap(cfg, store, token_a):
    burst = Config(
        db_path=cfg.db_path,
        admin_token=cfg.admin_token,
        token_pepper=cfg.token_pepper,
        min_interval_seconds=0.0,
        max_reports_per_hour=3,
    )
    with TestClient(create_app(burst, store)) as c:
        codes = [
            c.post(
                f"/api/v1/nodes/{NODE_A}/health",
                json=valid_payload(sentAt=_stamp(i)),
                headers=auth(token_a),
            ).status_code
            for i in range(6)
        ]
    assert codes == [202, 202, 202, 429, 429, 429]
    assert store.report_count(NODE_A) == 3


def test_rate_limit_state_is_one_row_per_node(store, token_a):
    """The limiter's own bookkeeping must not be the thing that fills the disk."""
    import sqlite3

    for i in range(50):
        store.check_rate_limit(NODE_A, 0.0, 1000, now=time.time() + i)
    conn = sqlite3.connect(store.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM node_rate").fetchone()[0] == 1
    finally:
        conn.close()


def test_rate_limits_are_per_node_not_per_source(cfg, store, token_a, token_b):
    """A fleet behind one carrier-grade NAT must not share a budget."""
    from .conftest import NODE_B

    tight = Config(
        db_path=cfg.db_path,
        admin_token=cfg.admin_token,
        token_pepper=cfg.token_pepper,
        min_interval_seconds=30.0,
        max_reports_per_hour=10,
    )
    with TestClient(create_app(tight, store)) as c:
        a = c.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
        b = c.post(
            f"/api/v1/nodes/{NODE_B}/health",
            json=valid_payload(node_id=NODE_B),
            headers=auth(token_b),
        )
    assert a.status_code == 202
    assert b.status_code == 202


# ---- body size ------------------------------------------------------------


def test_oversize_body_is_refused(client, store, token_a):
    """§4.3 rule 5 promises ≤ 8 KB per POST; the number is enforced, not advice.

    Refused in middleware on the declared Content-Length, before the body is
    parsed — so this is a cap, not a complaint issued after the allocation.
    """
    payload = valid_payload()
    payload["padding"] = "x" * 9000
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
    assert r.status_code == 413
    assert r.json()["error"] == "payload_too_large"
    assert store.report_count() == 0


def test_a_realistic_report_is_comfortably_inside_the_cap(token_a):
    """The 8 KB promise has to be livable, or it gets raised in a hurry."""
    import json

    from .conftest import valid_payload as vp

    body = json.dumps(vp())
    assert len(body) < 2048, f"a normal report is {len(body)} bytes"


def test_missing_content_length_is_refused(client, token_a):
    r = client.post(
        f"/api/v1/nodes/{NODE_A}/health",
        content=(b'{"a":1}' for _ in range(1)),  # chunked: no Content-Length
        headers={**auth(token_a), "Content-Type": "application/json"},
    )
    assert r.status_code == 411


def test_module_list_is_length_capped(client, store, token_a):
    payload = valid_payload()
    payload["modules"] = [{"id": f"module_{i}", "status": "running"} for i in range(40)]
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
    assert r.status_code in (413, 422)
    assert store.report_count() == 0


# ---- retention ------------------------------------------------------------


def test_retention_prunes_reports_older_than_the_stated_period(client, store, cfg, token_a):
    """90 days, stated in the README and implemented here.

    Rows are aged directly in the table rather than by waiting three months.
    """
    import sqlite3

    for i in range(3):
        assert (
            client.post(
                f"/api/v1/nodes/{NODE_A}/health",
                json=valid_payload(sentAt=_stamp(i)),
                headers=auth(token_a),
            ).status_code
            == 202
        )
    assert store.report_count(NODE_A) == 3

    old = time.time() - 91 * 86400
    conn = sqlite3.connect(store.db_path)
    try:
        conn.execute(
            "UPDATE health_reports SET received_at = ? WHERE id IN "
            "(SELECT id FROM health_reports ORDER BY id LIMIT 2)",
            (old,),
        )
        conn.commit()
    finally:
        conn.close()

    assert store.prune(cfg.retention_days, cfg.max_rows_per_node) == 2
    assert store.report_count(NODE_A) == 1
    # The child rows go too — no orphaned module rows accumulating forever.
    conn = sqlite3.connect(store.db_path)
    try:
        orphans = conn.execute(
            "SELECT COUNT(*) FROM module_reports WHERE report_id NOT IN (SELECT id FROM health_reports)"
        ).fetchone()[0]
        assert orphans == 0
    finally:
        conn.close()


def test_per_node_row_cap_is_independent_of_retention(client, store, token_a):
    """Belt and braces: even with retention misconfigured to 10 years, one
    node cannot hold unbounded rows."""
    for i in range(6):
        client.post(
            f"/api/v1/nodes/{NODE_A}/health",
            json=valid_payload(sentAt=_stamp(i)),
            headers=auth(token_a),
        )
    assert store.report_count(NODE_A) == 6
    assert store.prune(retention_days=3650, max_rows_per_node=2) == 4
    assert store.report_count(NODE_A) == 2
    # The rows kept are the newest ones — support wants recent history.
    history = store.node_history(NODE_A, 10)
    assert len(history) == 2


def test_prune_runs_on_the_accept_path(client, store, cfg, token_a, monkeypatch):
    """Retention needs no cron and no second process someone forgets to enable."""
    calls = []
    original = store.prune

    def spy(*args, **kwargs):
        calls.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(store, "prune", spy)
    store._last_prune = 0.0
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
    assert r.status_code == 202
    assert calls, "accepting a report did not trigger retention pruning"
    assert r.json()["retentionDays"] == 90


def test_node_deletion_removes_everything(client, store, token_a):
    """§4.2 lists deletion on request among the POPIA duties."""
    client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
    r = client.delete(f"/api/v1/admin/nodes/{NODE_A}", headers=auth(ADMIN_TOKEN))
    assert r.status_code == 200
    assert r.json()["deletedReports"] == 1
    assert store.report_count(NODE_A) == 0
    assert store.list_nodes() == []
    assert store.list_node_tokens(NODE_A) == []
