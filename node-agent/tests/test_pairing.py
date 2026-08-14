"""Covers the security properties from PAIRING-AND-TELEMETRY.md §3, and the
revoke-all takeover defect explicitly called out to carry forward."""

from __future__ import annotations

import os
import tempfile

os.environ["GATEFLAME_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")

from fastapi.testclient import TestClient  # noqa: E402

from gateflame.main import app, store  # noqa: E402


def loopback_client() -> TestClient:
    return TestClient(app, client=("127.0.0.1", 12345))


def lan_client(ip: str = "192.168.1.50") -> TestClient:
    return TestClient(app, client=(ip, 12345))


def public_client() -> TestClient:
    return TestClient(app, client=("8.8.8.8", 12345))


def test_pair_request_requires_kiosk_scope():
    # A LAN-but-not-loopback caller has no scope at all — no bearer token,
    # no loopback, so it can't be granted `kiosk`.
    with lan_client() as c:
        r = c.post("/api/v1/pair/request")
        assert r.status_code == 401


def test_full_pairing_flow():
    with loopback_client() as kiosk:
        req = kiosk.post("/api/v1/pair/request")
        assert req.status_code == 201
        code = req.json()["code"]
        assert len(code) == 6

    with lan_client("192.168.9.10") as phone:
        claim = phone.post("/api/v1/pair/claim", json={"code": code, "deviceName": "Test Phone"})
        assert claim.status_code == 200
        body = claim.json()
        assert "deviceToken" in body
        assert set(body["scopes"]) == {"read", "control"}
        assert store.is_provisioned()


def test_code_is_single_use():
    with loopback_client() as kiosk:
        code = kiosk.post("/api/v1/pair/request").json()["code"]
    with lan_client("192.168.9.11") as first_caller:
        first = first_caller.post("/api/v1/pair/claim", json={"code": code, "deviceName": "A"})
        assert first.status_code == 200
    with lan_client("192.168.9.12") as second_caller:
        second = second_caller.post("/api/v1/pair/claim", json={"code": code, "deviceName": "B"})
        assert second.status_code == 401


def test_five_wrong_guesses_destroy_code():
    with loopback_client() as kiosk:
        code = kiosk.post("/api/v1/pair/request").json()["code"]
    wrong = "000000" if code != "000000" else "111111"

    for i in range(5):
        # A distinct source IP per attempt to isolate this test from the
        # per-source rate limit — the point under test is the attempt
        # counter, not the rate limiter (covered separately below).
        with lan_client(f"192.168.9.{i + 1}") as attacker:
            r = attacker.post("/api/v1/pair/claim", json={"code": wrong, "deviceName": "attacker"})
            assert r.status_code == 401

    with lan_client("192.168.9.99") as late:
        real_attempt = late.post("/api/v1/pair/claim", json={"code": code, "deviceName": "late legit"})
        assert real_attempt.status_code in (401, 410)


def test_rate_limit_applies_per_source_ip():
    with loopback_client() as kiosk:
        kiosk.post("/api/v1/pair/request")

    with lan_client("192.168.9.200") as c:
        r1 = c.post("/api/v1/pair/claim", json={"code": "999999", "deviceName": "x"})
        r2 = c.post("/api/v1/pair/claim", json={"code": "999999", "deviceName": "x"})
        assert r1.status_code == 401
        assert r2.status_code == 429


def test_revoke_all_does_not_unprovision_node():
    """The defect this test guards: revoke_all() must never clear
    `provisioned`, or a lost-phone response re-arms first-boot admin."""
    with loopback_client() as kiosk:
        code = kiosk.post("/api/v1/pair/request").json()["code"]
    with lan_client("192.168.9.20") as phone:
        phone.post("/api/v1/pair/claim", json={"code": code, "deviceName": "phone"})
    assert store.is_provisioned()

    with loopback_client() as kiosk2:
        revoke = kiosk2.post("/api/v1/pair/devices/revoke-all")
        assert revoke.status_code == 200
        assert revoke.json()["provisioned"] is True
        assert store.is_provisioned() is True


def test_stop_requires_kiosk_not_control():
    with loopback_client() as kiosk:
        code = kiosk.post("/api/v1/pair/request").json()["code"]
    with lan_client("192.168.9.30") as phone:
        token = phone.post(
            "/api/v1/pair/claim", json={"code": code, "deviceName": "phone"}
        ).json()["deviceToken"]

    # A remote (private, non-loopback) caller with a control-scope token can
    # start...
    with lan_client("192.168.1.77") as remote:
        start = remote.post(
            "/api/v1/services/module_telemetry/start",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert start.status_code == 200
        assert start.json()["ok"] is True

        # ...but not stop. Only kiosk (loopback) scope can.
        stop = remote.post(
            "/api/v1/services/module_telemetry/stop",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert stop.status_code == 401

    with loopback_client() as kiosk2:
        stop = kiosk2.post(
            "/api/v1/services/module_telemetry/stop",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert stop.status_code == 200


def test_non_lan_source_is_refused():
    with public_client() as c:
        r = c.get("/api/v1/system/status")
        assert r.status_code == 403
