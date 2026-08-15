"""Client/server agreement, proven against the real client.

Everything else in this suite tests the receiver against payloads this repo
wrote. That is circular: a schema and a fixture written by the same person on
the same afternoon will agree with each other and disagree with production.

So this module imports `build_payload` from
`node-agent/gateflame/health_feed.py` — the actual code that runs on the
appliance — builds a real payload from a real `Store` and real host telemetry,
and posts that exact object. If it fails to validate, one of the two sides is
wrong, and since `health_feed.py` is the shipped client, the receiver is the
side that gets fixed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# node-agent is a sibling directory, not an installed package. Importing the
# real module is the entire point of this file — a stub would prove nothing.
NODE_AGENT = Path(__file__).resolve().parents[2] / "node-agent"
if str(NODE_AGENT) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT))

health_feed = pytest.importorskip(
    "gateflame.health_feed",
    reason="node-agent sources not present next to feed-receiver",
)

from gateflame.storage import Store  # noqa: E402

from gateflame_feed.schema import HealthReport  # noqa: E402
from gateflame_feed.security import hash_token  # noqa: E402

from .conftest import auth  # noqa: E402


@pytest.fixture
def agent_store(tmp_path) -> Store:
    return Store(tmp_path / "agent-state.db")


@pytest.fixture
def real_payload(agent_store) -> dict:
    """Whatever the shipped agent actually produces on this host, unedited."""
    return health_feed.build_payload(agent_store)


def test_real_client_payload_validates_against_the_schema(real_payload):
    # Validate directly first: a failure here points at the schema, before any
    # HTTP layer can confuse the diagnosis.
    report = HealthReport.model_validate(real_payload)
    assert report.nodeId == real_payload["nodeId"]
    assert report.agentVersion == real_payload["agentVersion"]
    assert len(report.modules) == len(real_payload["modules"])


def test_real_client_payload_is_accepted_over_http(cfg, store, app, real_payload):
    """The end-to-end version: the client's own object, through the real route."""
    from fastapi.testclient import TestClient

    node_id = real_payload["nodeId"]
    _, token = store.issue_node_token(node_id, "contract test", lambda t: hash_token(t, cfg.token_pepper))

    with TestClient(app) as client:
        r = client.post(f"/api/v1/nodes/{node_id}/health", json=real_payload, headers=auth(token))

    assert r.status_code == 202, f"receiver rejected the real client payload: {r.text}"
    assert r.json()["status"] == "stored"
    assert store.report_count(node_id) == 1

    stored = store.node_history(node_id, 1)[0]
    assert stored["agentVersion"] == real_payload["agentVersion"]
    assert stored["uptimeSeconds"] == real_payload["uptimeSeconds"]
    assert {m["id"] for m in stored["modules"]} == {m["id"] for m in real_payload["modules"]}


def test_client_sends_exactly_the_fields_the_schema_accepts(real_payload):
    """Both directions of the contract, in one assertion each.

    Unknown key sent by the client  -> the receiver would 422 it in production.
    Required key missing            -> the receiver would 422 it in production.
    Either way this test fails here, at build time, not at 03:00 on a fleet.
    """
    sent = set(real_payload)
    accepted = set(HealthReport.model_fields)
    assert sent - accepted == set(), f"client sends fields the receiver rejects: {sent - accepted}"

    required = {
        name for name, f in HealthReport.model_fields.items() if f.is_required()
    }
    assert required - sent == set(), f"client omits required fields: {required - sent}"


def test_client_host_and_module_subobjects_match(real_payload):
    from gateflame_feed.schema import Counters, HostMetrics, ModuleHealth

    assert set(real_payload["host"]) <= set(HostMetrics.model_fields)
    assert set(real_payload["counters"]) <= set(Counters.model_fields)
    for module in real_payload["modules"]:
        assert set(module) <= set(ModuleHealth.model_fields)


def test_every_status_the_real_module_registry_can_emit_is_accepted():
    """The §4.4 example only shows running/degraded/stopped.

    `node-agent/gateflame/services.py:module_status()` also returns
    `not_implemented` (its honest-gaps design, for the three modules this
    build does not implement) and `unknown` (for an id absent from
    MODULE_DEFS). Accepting only the three from the document would 422 most of
    a real node's report. Read the registry, not the example.
    """
    from gateflame import services

    emitted = {m["status"] for m in services.list_modules()}
    allowed = set(HealthReport.model_fields["modules"].annotation.__args__[0].model_fields["status"].annotation.__args__)
    assert emitted <= allowed, f"registry emits statuses the schema rejects: {emitted - allowed}"


def test_real_client_nodeid_matches_the_documented_shape(real_payload):
    """§3.3 says `GF-` + 8 base32 chars; §4.4's example prints it grouped
    ("GF-A7K2-9QX4") while `storage._gen_node_id()` emits it ungrouped. Both
    are accepted; this asserts the one the code actually produces is."""
    import re

    from gateflame_feed.schema import NODE_ID_PATTERN

    assert re.match(NODE_ID_PATTERN, real_payload["nodeId"]), real_payload["nodeId"]
