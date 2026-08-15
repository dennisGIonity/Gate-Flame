"""Per-node bearer auth, and the separation between node and admin credentials."""

from __future__ import annotations

import sqlite3

from gateflame_feed.security import hash_token

from .conftest import ADMIN_TOKEN, NODE_A, NODE_B, auth, valid_payload


def test_no_token_is_rejected(client, store):
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload())
    assert r.status_code == 401
    assert r.json()["detail"] == {"error": "unauthorized"}
    assert store.report_count() == 0


def test_wrong_token_is_rejected(client, store, token_a):
    r = client.post(
        f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth("not-the-token")
    )
    assert r.status_code == 401
    assert store.report_count() == 0


def test_valid_token_is_accepted(client, store, token_a):
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
    assert r.status_code == 202
    assert r.json()["status"] == "stored"
    assert store.report_count(NODE_A) == 1


def test_unknown_node_id_is_indistinguishable_from_a_wrong_token(client, token_a):
    """No existence oracle.

    `nodeId`s are printed on enclosure labels and read out on support calls
    (§3.3). An endpoint that answers differently for "no such unit" and "wrong
    credential" lets anyone enumerate which units Ionity has sold and which
    are provisioned, from the public internet, unauthenticated.
    """
    unknown = client.post(
        "/api/v1/nodes/GF-ZZZZZZZZ/health",
        json=valid_payload(node_id="GF-ZZZZZZZZ"),
        headers=auth("wrong-token"),
    )
    known_wrong = client.post(
        f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth("wrong-token")
    )
    assert unknown.status_code == known_wrong.status_code == 401
    assert unknown.json() == known_wrong.json()


def test_a_valid_token_for_another_node_is_also_just_unauthorized(client, store, token_a, token_b):
    """Node A's token, pointed at node B's ingest path.

    Same 401, same body — a real credential must not become a probe for which
    other node ids exist.
    """
    r = client.post(
        f"/api/v1/nodes/{NODE_B}/health",
        json=valid_payload(node_id=NODE_B),
        headers=auth(token_a),
    )
    assert r.status_code == 401
    assert r.json()["detail"] == {"error": "unauthorized"}
    assert store.report_count(NODE_B) == 0


def test_revoked_token_stops_working(client, store, cfg, token_a):
    tokens = store.list_node_tokens(NODE_A)
    assert store.revoke_node_token(tokens[0]["id"])
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
    assert r.status_code == 401
    assert store.report_count() == 0


def test_token_is_never_stored_in_plaintext(store, cfg, token_a):
    """A dump of feed.db must not hand out live node tokens."""
    conn = sqlite3.connect(store.db_path)
    try:
        rows = list(conn.execute("SELECT token_hash FROM node_tokens"))
        assert rows
        for (stored,) in rows:
            assert stored != token_a
            assert token_a not in stored
            assert len(stored) == 64  # hex sha256 digest
        # And the whole file, in case a token ever leaked into another column.
        blob = open(store.db_path, "rb").read()
        assert token_a.encode() not in blob
    finally:
        conn.close()


def test_token_hash_is_keyed_by_the_pepper(cfg):
    """Different pepper, different hash — a stolen DB alone verifies nothing."""
    a = hash_token("some-token", "pepper-one")
    b = hash_token("some-token", "pepper-two")
    assert a != b
    assert a == hash_token("some-token", "pepper-one")


def test_node_id_and_body_must_agree(client, store, token_a):
    r = client.post(
        f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(node_id=NODE_B), headers=auth(token_a)
    )
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "node_id_mismatch"
    assert store.report_count() == 0


# ---- admin credential separation ------------------------------------------


def test_node_token_cannot_use_the_fleet_list(client, token_a):
    r = client.get("/api/v1/admin/nodes", headers=auth(token_a))
    assert r.status_code == 401


def test_node_token_cannot_read_another_nodes_history(client, store, token_a, token_b):
    """The explicit cross-tenant read test.

    Node B posts real health; node A then asks for B's history with its own
    perfectly valid token. It must not get it, and must not learn that B
    exists.
    """
    assert (
        client.post(
            f"/api/v1/nodes/{NODE_B}/health",
            json=valid_payload(node_id=NODE_B),
            headers=auth(token_b),
        ).status_code
        == 202
    )

    r = client.get(f"/api/v1/admin/nodes/{NODE_B}/history", headers=auth(token_a))
    assert r.status_code == 401
    assert r.json()["detail"] == {"error": "unauthorized"}

    # Identical to asking about a node that does not exist at all.
    missing = client.get("/api/v1/admin/nodes/GF-ZZZZZZZZ/history", headers=auth(token_a))
    assert missing.status_code == 401
    assert missing.json() == r.json()


def test_node_token_may_read_its_own_history(client, token_a):
    client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(token_a))
    r = client.get(f"/api/v1/admin/nodes/{NODE_A}/history", headers=auth(token_a))
    assert r.status_code == 200
    assert r.json()["count"] == 1


def test_admin_token_cannot_post_health(client, store):
    """The separation runs both ways: support reads, it does not write health."""
    r = client.post(
        f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=auth(ADMIN_TOKEN)
    )
    assert r.status_code == 401
    assert store.report_count() == 0


def test_admin_api_fails_closed_when_no_admin_token_is_configured(cfg, store):
    from fastapi.testclient import TestClient

    from gateflame_feed.config import Config
    from gateflame_feed.main import create_app

    unconfigured = Config(
        db_path=cfg.db_path, admin_token=None, token_pepper=cfg.token_pepper
    )
    with TestClient(create_app(unconfigured, store)) as c:
        r = c.get("/api/v1/admin/nodes", headers=auth("anything"))
        assert r.status_code == 503
        assert r.json()["detail"]["error"] == "admin_api_not_configured"


def test_malformed_authorization_headers(client, store, token_a):
    for header in ({"Authorization": token_a}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer "}):
        r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=valid_payload(), headers=header)
        assert r.status_code == 401
    assert store.report_count() == 0
