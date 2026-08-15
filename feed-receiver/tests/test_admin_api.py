"""The Ionity support read API."""

from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timedelta, timezone

from .conftest import ADMIN_TOKEN, NODE_A, NODE_B, auth, valid_payload


def _stamp(offset_seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def test_list_nodes_shows_last_seen_and_status(client, token_a, token_b):
    client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
    client.post(
        f"/api/v1/nodes/{NODE_B}/health", json=valid_payload(node_id=NODE_B), headers=auth(token_b)
    )

    r = client.get("/api/v1/admin/nodes", headers=auth(ADMIN_TOKEN))
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    by_id = {n["nodeId"]: n for n in body["nodes"]}
    assert set(by_id) == {NODE_A, NODE_B}
    a = by_id[NODE_A]
    assert a["status"] == "online"
    assert a["lastSeen"].endswith("Z")
    assert a["lastSeenAgeSeconds"] < 5
    assert a["agentVersion"] == "1.0.1"
    assert a["reportCount"] == 1
    # "which units are on an old agent" (§4.1) is answerable from this list.
    assert a["degradedModules"] == ["module_firewall_bounce"]


def test_status_ages_from_online_to_stale_to_offline(client, store, token_a):
    client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))

    def status_after(age_seconds: float) -> str:
        conn = sqlite3.connect(store.db_path)
        try:
            conn.execute("UPDATE nodes SET last_seen = ?", (time.time() - age_seconds,))
            conn.commit()
        finally:
            conn.close()
        r = client.get("/api/v1/admin/nodes", headers=auth(ADMIN_TOKEN))
        return r.json()["nodes"][0]["status"]

    assert status_after(60) == "online"          # inside one 15-min interval
    assert status_after(40 * 60) == "online"     # two missed posts tolerated
    assert status_after(2 * 3600) == "stale"
    assert status_after(48 * 3600) == "offline"


def test_history_returns_recent_reports_newest_first(client, token_a):
    for i in range(3):
        client.post(
            f"/api/v1/nodes/{NODE_A}/health",
            json=valid_payload(sentAt=_stamp(i), uptimeSeconds=1000 + i),
            headers=auth(token_a),
        )

    r = client.get(f"/api/v1/admin/nodes/{NODE_A}/history", headers=auth(ADMIN_TOKEN))
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 3
    assert body["retentionDays"] == 90
    assert [rep["uptimeSeconds"] for rep in body["reports"]] == [1002, 1001, 1000]

    first = body["reports"][0]
    assert first["host"]["tempC"] == 54.2
    assert first["counters"]["errors24h"] == 3
    assert first["piholeReachable"] is True
    assert first["modules"][0]["id"] == "module_firewall_bounce"
    assert first["modules"][0]["gap"] == "no CAP_NET_ADMIN"
    assert first["receivedAt"].endswith("Z")


def test_history_limit_is_bounded(client, token_a):
    client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
    assert (
        client.get(f"/api/v1/admin/nodes/{NODE_A}/history?limit=1", headers=auth(ADMIN_TOKEN)).json()[
            "count"
        ]
        == 1
    )
    # An operator cannot ask for the whole table in one request.
    assert (
        client.get(
            f"/api/v1/admin/nodes/{NODE_A}/history?limit=100000", headers=auth(ADMIN_TOKEN)
        ).status_code
        == 422
    )


def test_history_for_an_unseen_node_is_empty_not_an_error(client):
    r = client.get("/api/v1/admin/nodes/GF-ZZZZZZZZ/history", headers=auth(ADMIN_TOKEN))
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_healthz_needs_no_auth_and_exposes_no_data(client, token_a):
    client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert NODE_A not in r.text
