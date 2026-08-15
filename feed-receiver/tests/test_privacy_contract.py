"""The §4.1 promise, tested as a property of the system rather than a comment.

`docs/PAIRING-AND-TELEMETRY.md` §4.1 tells the customer, in writing, that the
support feed never carries domains, client IPs, MACs, hostnames, threat logs,
per-client DNS volumes or DPI output, and §4.2 explains that receiving them
would change Ionity's obligations under POPIA. These tests exist so that a
future edit which quietly widens the payload fails CI instead of shipping.

Three independent things are asserted here:

1. A payload carrying forbidden fields is **rejected**, not cleaned — and
   nothing at all is written.
2. No forbidden name is a field in any schema model (so no future model edit
   can add one without deleting a test).
3. The database has no column, and no blob, that such data could live in even
   if validation were bypassed entirely.
"""

from __future__ import annotations

import sqlite3

import pytest

from gateflame_feed import schema
from gateflame_feed.schema import FORBIDDEN_FIELD_NAMES, HealthReport

from .conftest import NODE_A, auth, valid_payload


def test_payload_with_client_identifiers_is_rejected_and_nothing_is_stored(client, store, token_a):
    """The headline case: the exact leak §4.1 forbids.

    A future buggy or malicious agent build attaches `clientIps`, `domains`
    and `hostnames` to an otherwise perfectly valid health report. The
    dangerous outcome is not "the extra data is saved" — it is "the extra data
    is silently dropped and the report is accepted", because then the fleet
    posts personal information to Ionity's endpoint for months and the only
    evidence is in someone else's traffic logs.
    """
    payload = valid_payload()
    payload["clientIps"] = ["192.168.1.42", "192.168.1.77"]
    payload["domains"] = ["ads.example.com", "bank.example.co.za"]
    payload["hostnames"] = ["dennis-pixel8", "kitchen-tablet"]

    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))

    assert r.status_code == 422, "extra fields must be rejected, never silently dropped"
    body = r.json()
    assert body["error"] == "schema_rejected"
    rejected = {item["field"]: item["reason"] for item in body["rejected"]}
    assert rejected["clientIps"] == "extra_forbidden"
    assert rejected["domains"] == "extra_forbidden"
    assert rejected["hostnames"] == "extra_forbidden"

    # Nothing persisted — not the forbidden fields, and not the valid part of
    # the report either. A partial write would mean the report "half arrived",
    # which is worse than a clean rejection the agent will retry.
    assert store.report_count() == 0
    assert store.list_nodes() == [] or store.list_nodes()[0]["lastSeen"] is None

    # And the forbidden values are not echoed back in the error either — the
    # response must not be the leak channel the schema just closed.
    text = r.text
    for leaked in ("192.168.1.42", "ads.example.com", "dennis-pixel8"):
        assert leaked not in text


def test_error_response_never_echoes_rejected_values(client, token_a):
    payload = valid_payload()
    payload["dnsQueries"] = {"bank.example.co.za": 412}
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
    assert r.status_code == 422
    assert "bank.example.co.za" not in r.text
    assert "dnsQueries" in r.text  # the field *name* is fine; it is schema, not data


@pytest.mark.parametrize("forbidden", FORBIDDEN_FIELD_NAMES)
def test_every_named_forbidden_field_is_rejected(client, store, token_a, forbidden):
    payload = valid_payload()
    payload[forbidden] = "anything at all"
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
    assert r.status_code == 422, f"{forbidden} was accepted"
    assert store.report_count() == 0


def test_forbidden_names_are_not_fields_on_any_model():
    """Guards against the other direction: someone *adding* one to the schema."""
    models = (schema.HealthReport, schema.HostMetrics, schema.ModuleHealth, schema.Counters)
    for model in models:
        for name in FORBIDDEN_FIELD_NAMES:
            assert name not in model.model_fields, f"{model.__name__}.{name} must not exist"


def test_extra_forbidden_applies_to_nested_objects(client, store, token_a):
    """`extra="forbid"` on the top level alone would be a hole.

    A leak is just as effective smuggled inside `host` or a module entry as it
    is at the top level, so every model — not just the root — is strict.
    """
    nested_cases = [
        ("host", {"clientIps": ["10.0.0.5"]}),
        ("counters", {"queriesPerClient": 42}),
    ]
    for field, extra in nested_cases:
        payload = valid_payload()
        payload[field] = {**payload[field], **extra}
        r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
        assert r.status_code == 422, f"extra field inside {field} was accepted"

    payload = valid_payload()
    payload["modules"][0]["sniHost"] = "bank.example.co.za"
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
    assert r.status_code == 422
    assert store.report_count() == 0


def test_module_id_cannot_express_a_domain_or_address(client, store, token_a):
    """Identifier *shapes* are part of the enforcement, not just field names.

    A field named `id` is unremarkable; a field named `id` whose value is
    `bank.example.co.za` is a leak with a boring name. The pattern makes the
    value space incapable of holding one.
    """
    for bad in ("bank.example.co.za", "192.168.1.42", "fe80::1", "MODULE_X", "a b"):
        payload = valid_payload()
        payload["modules"][0]["id"] = bad
        r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
        assert r.status_code == 422, f"module id {bad!r} was accepted"
    assert store.report_count() == 0


def test_node_id_cannot_be_a_hostname(client, store, token_a):
    payload = valid_payload(nodeId="kitchen-tablet.lan")
    r = client.post("/api/v1/nodes/kitchen-tablet.lan/health", json=payload, headers=auth(token_a))
    # 401 first — the token is not bound to that id — and the schema would
    # refuse it regardless.
    assert r.status_code == 401
    assert store.report_count() == 0


def test_free_text_gap_rejects_ip_and_mac_literals():
    """`gap`/`remedy` are the only free text §4.1 permits. They are checked."""
    for bad in (
        "cannot reach client 192.168.1.42",
        "neighbour 10.0.0.5:53 not responding",
        "lease for aa:bb:cc:dd:ee:ff expired",
        "peer fe80::1c2d:3e4f:5a6b:7c8d unreachable",
    ):
        assert schema.contains_network_identifier(bad), bad
        with pytest.raises(ValueError):
            schema.ModuleHealth(id="module_x", status="degraded", gap=bad)


def test_free_text_check_does_not_false_positive_on_real_agent_gaps():
    """The check is scoped to what is unambiguous, and this proves why.

    Every string below is a real gap or remedy produced by
    `node-agent/gateflame/services.py` / `firewall.py`. Note
    `gateflame.service` — domain-shaped, entirely legitimate. A validator that
    rejected it would break honest reports, and a validator that cries wolf
    gets switched off, so the check tests for parseable addresses only.
    """
    real_gaps = [
        "requires `ip` (iproute2) on PATH",
        "Pi-hole not configured or unreachable",
        "`nft` is not on PATH — install nftables (apt install nftables)",
        "nftables is installed but `nft --version` failed",
        "no CAP_NET_ADMIN — grant it to the unit "
        "(AmbientCapabilities=CAP_NET_ADMIN in gateflame.service), never run as root",
        "AF_PACKET SNI/Host capture not implemented in this build",
        "throughput/latency/budget accounting not implemented in this build",
        "posture audit + hardened unit generation not implemented in this build",
        "agent 0.1.0 older than fleet 1.0.6",
    ]
    for gap in real_gaps:
        assert not schema.contains_network_identifier(gap), gap
        schema.ModuleHealth(id="module_x", status="degraded", gap=gap)


def test_free_text_is_length_capped(client, store, token_a):
    payload = valid_payload()
    payload["modules"][0]["gap"] = "x" * 201
    r = client.post(f"/api/v1/nodes/{NODE_A}/health", json=payload, headers=auth(token_a))
    assert r.status_code == 422
    assert store.report_count() == 0


# ---- the storage-layer half of the promise --------------------------------

# Every column in the database, named explicitly. This is a change-detector
# test on purpose: adding a column has to be a deliberate, reviewable edit,
# because "add a JSON blob and dump the payload in it" is exactly how a
# health-only feed becomes a surveillance feed by accident.
EXPECTED_COLUMNS = {
    "nodes": {"node_id", "first_seen", "last_seen", "last_agent_version", "report_count"},
    "node_tokens": {"id", "node_id", "token_hash", "label", "issued_at", "revoked"},
    "health_reports": {
        "id", "node_id", "report_hash", "received_at", "sent_at", "clock_skew_seconds",
        "clock_suspect", "agent_version", "uptime_seconds", "cpu_percent", "mem_used_mb",
        "mem_total_mb", "disk_used_percent", "temp_c", "throttle_flags", "errors_24h",
        "restarts_24h", "wan_budget_used_percent", "pihole_reachable",
    },
    "module_reports": {"report_id", "module_id", "status", "gap", "remedy", "restarts_24h"},
    "node_rate": {"node_id", "window_start", "window_count", "last_accepted_at"},
}


def test_schema_has_no_column_that_could_hold_forbidden_data(store):
    conn = sqlite3.connect(store.db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        assert tables == set(EXPECTED_COLUMNS), "a table was added or removed"
        for table, expected in EXPECTED_COLUMNS.items():
            actual = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            assert actual == expected, f"{table} columns drifted: {actual ^ expected}"
    finally:
        conn.close()


def test_no_json_or_blob_column_anywhere(store):
    """No `payload`, no `raw`, no `extra`, no BLOB.

    The module list gets its own table with named columns rather than a
    `modules_json TEXT`. A JSON column is a schema-shaped hole: it accepts
    anything, so the storage layer would stop being an independent check and
    §4.1 would rest on `schema.py` alone.
    """
    conn = sqlite3.connect(store.db_path)
    try:
        for (table,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ):
            for row in conn.execute(f"PRAGMA table_info({table})"):
                name, decl_type = row[1].lower(), (row[2] or "").upper()
                assert "BLOB" not in decl_type, f"{table}.{name} is a BLOB"
                assert not any(
                    marker in name
                    for marker in ("json", "payload", "raw", "blob", "extra", "body", "log")
                ), f"{table}.{name} looks like a free-form dumping ground"
    finally:
        conn.close()


def test_accepted_field_list_is_published_without_auth(client):
    """§4.3 rule 3: a customer can see exactly what leaves the device."""
    r = client.get("/api/v1/contract")
    assert r.status_code == 200
    body = r.json()
    assert set(body["acceptedFields"][""]) == set(HealthReport.model_fields)
    assert body["extraFieldsPolicy"].startswith("rejected with 422")
    # The published list is the enforced list, not a hand-maintained copy.
    assert set(body["acceptedFields"]["host"]) == set(schema.HostMetrics.model_fields)
    assert set(body["acceptedFields"]["modules[]"]) == set(schema.ModuleHealth.model_fields)
    assert set(body["acceptedFields"]["counters"]) == set(schema.Counters.model_fields)
