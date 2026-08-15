"""Shared fixtures. Every test gets its own database and its own app instance.

`create_app(cfg, store)` exists precisely so the suite never has to reach into
a module-level singleton, and so two tests cannot see each other's rows.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from gateflame_feed.config import Config
from gateflame_feed.main import create_app
from gateflame_feed.security import hash_token
from gateflame_feed.storage import FeedStore

NODE_A = "GF-A7K29QX4"
NODE_B = "GF-B3M27TY5"
ADMIN_TOKEN = "admin-token-for-tests-only"


@pytest.fixture
def cfg(tmp_path) -> Config:
    return Config(
        db_path=str(tmp_path / "feed.db"),
        admin_token=ADMIN_TOKEN,
        token_pepper="test-pepper-not-a-real-secret",
        retention_days=90,
        min_interval_seconds=0.0,  # off unless a test asks for it
        max_reports_per_hour=1000,
    )


@pytest.fixture
def store(cfg) -> FeedStore:
    s = FeedStore(cfg.db_path)
    yield s
    s.close()


@pytest.fixture
def app(cfg, store):
    return create_app(cfg, store)


@pytest.fixture
def client(app) -> TestClient:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def token_a(store, cfg) -> str:
    _, token = store.issue_node_token(NODE_A, "test unit A", lambda t: hash_token(t, cfg.token_pepper))
    return token


@pytest.fixture
def token_b(store, cfg) -> str:
    _, token = store.issue_node_token(NODE_B, "test unit B", lambda t: hash_token(t, cfg.token_pepper))
    return token


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def valid_payload(node_id: str = NODE_A, **overrides) -> dict:
    """A minimal, valid §4.4-shaped report.

    Kept close to what `health_feed.build_payload()` actually emits; the
    round-trip against the real client lives in test_client_contract.py.
    """
    payload = {
        "nodeId": node_id,
        "agentVersion": "1.0.1",
        "sentAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "uptimeSeconds": 864000,
        "host": {
            "cpuPercent": 12.4,
            "memUsedMB": 412,
            "memTotalMB": 3906,
            "diskUsedPercent": 38,
            "tempC": 54.2,
            "throttleFlags": "0x0",
        },
        "modules": [
            {
                "id": "module_firewall_bounce",
                "status": "degraded",
                "gap": "no CAP_NET_ADMIN",
                "remedy": "grant CAP_NET_ADMIN to the agent unit",
                "restarts24h": 0,
            }
        ],
        "counters": {"errors24h": 3, "restarts24h": 0, "wanBudgetUsedPercent": 41},
        "piholeReachable": True,
    }
    payload.update(overrides)
    return payload
