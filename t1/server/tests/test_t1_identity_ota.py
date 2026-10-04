"""One token per board, signed staged firmware, and the backup that keeps both recoverable.

What these pin (docs/T1-BLUEPRINT.md patterns 3 and 5):
  * a board can enrol ONCE with the enrolment token and gets a token of its own; the server
    keeps only the hash;
  * a board can report only as itself;
  * revoking one board cuts off that board and no other;
  * a revoked or already-enrolled id cannot enrol again until an admin resets it;
  * firmware is signed by the same key as the filters, offered only to the boards in the wave,
    and the wave is stable: the 10 % that got it stay in the 100 %.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import zipfile

import pytest
from fastapi.testclient import TestClient

from t1server import signing
from t1server.app import create_app
from t1server.config import tokens
from t1server.service import Service
from t1server.store import Store

ENROL = lambda: {"X-T1-Enrol": tokens()["enrol_token"]}  # noqa: E731


@pytest.fixture()
def env(tmp_path):
    store = Store(tmp_path / "t.db")
    svc = Service(store, fetch=lambda u: "0.0.0.0 known-bad.example\n")
    svc.build_filters(background=False)
    return TestClient(create_app(store, svc)), svc, store


def enrol(c, did):
    r = c.post("/api/t1/v1/enrol", json={"id": did}, headers=ENROL())
    assert r.status_code == 200, r.text
    return {"X-T1-Id": did, "X-T1-Token": r.json()["token"]}


def image(n=100_000, fill=7):
    return b"\xe9" + bytes([fill]) * (n - 1)


# ── enrolment ──────────────────────────────────────────────────────────────
def test_enrol_needs_the_enrolment_token(env):
    c, *_ = env
    assert c.post("/api/t1/v1/enrol", json={"id": "gft1-000000000001"}).status_code == 401
    assert c.post("/api/t1/v1/enrol", json={"id": "gft1-000000000001"},
                  headers={"X-T1-Enrol": tokens()["admin_token"]}).status_code == 401
    # The old shared fleet token cannot enrol either.
    assert c.post("/api/t1/v1/enrol", json={"id": "gft1-000000000001"},
                  headers={"X-T1-Enrol": tokens()["device_token"]}).status_code == 401


def test_the_server_keeps_only_a_hash_of_the_token(env):
    c, _, store = env
    H = enrol(c, "gft1-000000000002")
    row = store.q("SELECT token_hash FROM device_tokens WHERE device_id=?", ("gft1-000000000002",))[0]
    assert row["token_hash"] == hashlib.sha256(H["X-T1-Token"].encode()).hexdigest()
    assert H["X-T1-Token"] not in json.dumps(store.q("SELECT * FROM device_tokens"))


def test_enrolled_board_works_and_a_wrong_token_or_id_does_not(env):
    c, *_ = env
    H = enrol(c, "gft1-000000000003")
    assert c.get("/api/t1/v1/manifest.txt", headers=H).status_code == 200
    assert c.get("/api/t1/v1/manifest.txt", headers={**H, "X-T1-Token": "nope"}).status_code == 401
    assert c.get("/api/t1/v1/manifest.txt", headers={**H, "X-T1-Id": "gft1-000000000009"}).status_code == 401
    assert c.get("/api/t1/v1/manifest.txt", headers={"X-T1-Token": H["X-T1-Token"]}).status_code == 401


def test_a_board_can_only_report_as_itself(env):
    c, *_ = env
    a, b = enrol(c, "gft1-00000000000a"), enrol(c, "gft1-00000000000b")
    ok = c.post("/api/t1/v1/telemetry", json={"id": "gft1-00000000000a", "status": "active"}, headers=a)
    assert ok.status_code == 200
    spoof = c.post("/api/t1/v1/telemetry", json={"id": "gft1-00000000000a", "status": "active"}, headers=b)
    assert spoof.status_code == 403


def test_enrolling_twice_is_refused_until_an_admin_resets_it(env):
    c, *_ = env
    enrol(c, "gft1-00000000000c")
    again = c.post("/api/t1/v1/enrol", json={"id": "gft1-00000000000c"}, headers=ENROL())
    assert again.status_code == 409 and "already enrolled" in again.json()["detail"]
    assert c.post("/api/t1/v1/devices/gft1-00000000000c/token/reset").status_code == 200
    assert enrol(c, "gft1-00000000000c")["X-T1-Token"]


def test_revoking_one_board_cuts_it_off_and_touches_no_other(env):
    c, *_ = env
    a, b = enrol(c, "gft1-0000000000a1"), enrol(c, "gft1-0000000000b1")
    assert c.post("/api/t1/v1/devices/gft1-0000000000a1/token/revoke").status_code == 200
    assert c.get("/api/t1/v1/manifest.txt", headers=a).status_code == 401
    assert c.get("/api/t1/v1/manifest.txt", headers=b).status_code == 200
    # Revoked is not "may enrol again": that needs an explicit reset.
    again = c.post("/api/t1/v1/enrol", json={"id": "gft1-0000000000a1"}, headers=ENROL())
    assert again.status_code == 409 and "revoked" in again.json()["detail"]


def test_forgetting_a_board_removes_its_token_too(env):
    c, *_ = env
    H = enrol(c, "gft1-0000000000f1")
    c.post("/api/t1/v1/telemetry", json={"id": "gft1-0000000000f1", "status": "active"}, headers=H)
    assert c.delete("/api/t1/v1/devices/gft1-0000000000f1").status_code == 200
    assert c.get("/api/t1/v1/manifest.txt", headers=H).status_code == 401


def test_bad_ids_are_refused(env):
    c, *_ = env
    for bad in ("", "x", "UPPER-CASE-ID", "has space", "a" * 49, "../etc"):
        assert c.post("/api/t1/v1/enrol", json={"id": bad}, headers=ENROL()).status_code == 400, bad


def test_enrolment_is_rate_limited(env, monkeypatch):
    import t1server.app as appmod
    monkeypatch.setattr(appmod, "ENROL_PER_MINUTE", 3)
    store = Store(":memory:")
    svc = Service(store, fetch=lambda u: "0.0.0.0 x.example\n")
    c = TestClient(appmod.create_app(store, svc))
    codes = [c.post("/api/t1/v1/enrol", json={"id": f"gft1-rate{i:08d}"}, headers=ENROL()).status_code
             for i in range(5)]
    assert codes[:3] == [200, 200, 200] and codes[3:] == [429, 429]


def test_the_old_shared_token_works_only_when_asked_for(env, monkeypatch):
    c, *_ = env
    shared = {"X-T1-Token": tokens()["device_token"]}
    assert c.get("/api/t1/v1/manifest.txt", headers=shared).status_code == 401
    import t1server.app as appmod
    monkeypatch.setattr(appmod, "LEGACY_SHARED_TOKEN", True)
    store = Store(":memory:")
    c2 = TestClient(appmod.create_app(store, Service(store, fetch=lambda u: "0.0.0.0 x.example\n")))
    assert c2.get("/api/t1/v1/manifest.txt", headers=shared).status_code == 200


# ── firmware ───────────────────────────────────────────────────────────────
def upload(c, version, blob=None, **kw):
    return c.post(f"/api/t1/v1/firmware?version={version}", content=blob if blob is not None else image(), **kw)


def test_firmware_must_be_an_esp32_image_of_a_sensible_size(env):
    c, *_ = env
    assert upload(c, "0.2.0", b"MZ" + b"\x00" * 200_000).status_code == 400          # not an ESP image
    assert upload(c, "0.2.0", b"\xe9" * 100).status_code == 400                       # far too small
    assert upload(c, "0.2.0", b"\xe9" * (3 * 1024 * 1024)).status_code == 400         # larger than a slot
    assert upload(c, "bad version!", image()).status_code == 400
    assert upload(c, "0.2.0").status_code == 200


def test_firmware_is_signed_with_the_filter_key_and_verifies(env):
    c, *_ = env
    blob = image()
    assert upload(c, "0.2.1", blob).json()["sha256"] == hashlib.sha256(blob).hexdigest()
    c.post("/api/t1/v1/firmware/rollout", json={"version": "0.2.1", "percent": 100})
    H = enrol(c, "gft1-0000000000c1")
    man = dict(l.split("=", 1) for l in c.get("/api/t1/v1/manifest.txt?fw=0.1.0", headers=H).text.split())
    got = c.get(man["fw_url"], headers=H).content
    assert got == blob and int(man["fw_size"]) == len(blob)
    assert hashlib.sha256(got).hexdigest() == man["fw_sha256"]
    assert signing.verify(got, man["fw_sig"])
    assert not signing.verify(got + b"!", man["fw_sig"])


def test_nothing_is_offered_until_a_rollout_is_set(env):
    c, *_ = env
    upload(c, "0.2.2")
    H = enrol(c, "gft1-0000000000c2")
    assert "fw_version" not in c.get("/api/t1/v1/manifest.txt?fw=0.1.0", headers=H).text
    assert c.get("/api/t1/v1/firmware/0.2.2.bin", headers=H).status_code == 200      # file exists, just not offered


def test_a_board_already_on_the_version_is_not_offered_it(env):
    c, *_ = env
    upload(c, "0.2.3")
    c.post("/api/t1/v1/firmware/rollout", json={"version": "0.2.3", "percent": 100})
    H = enrol(c, "gft1-0000000000c3")
    assert "fw_version=0.2.3" in c.get("/api/t1/v1/manifest.txt?fw=0.2.2", headers=H).text
    assert "fw_version" not in c.get("/api/t1/v1/manifest.txt?fw=0.2.3", headers=H).text


def test_canary_then_a_stable_percentage_wave(env):
    c, svc, _ = env
    upload(c, "0.2.4")
    ids = [f"gft1-wave{i:08d}" for i in range(200)]
    heads = {i: enrol(c, i) for i in ids[:3]}                                         # only a few need real tokens
    c.post("/api/t1/v1/firmware/rollout", json={"version": "0.2.4", "percent": 0, "devices": [ids[0]]})
    assert "fw_version" in c.get("/api/t1/v1/manifest.txt?fw=0.1.0", headers=heads[ids[0]]).text
    assert "fw_version" not in c.get("/api/t1/v1/manifest.txt?fw=0.1.0", headers=heads[ids[1]]).text

    def wave(pct):
        svc.rollout_set("0.2.4", pct, [])
        return {i for i in ids if svc.firmware_offer(i, "0.1.0")}

    w10, w50, w100 = wave(10), wave(50), wave(100)
    assert 5 <= len(w10) <= 40                                    # about 10 % of 200
    assert w10 <= w50 <= w100 and len(w100) == 200                # the 10 % stay in the 50 %, and in the 100 %
    assert wave(0) == set()


def test_a_rollout_cannot_name_firmware_that_does_not_exist(env):
    c, *_ = env
    assert c.post("/api/t1/v1/firmware/rollout", json={"version": "9.9.9", "percent": 10}).status_code == 404
    upload(c, "0.2.5")
    assert c.post("/api/t1/v1/firmware/rollout", json={"version": "0.2.5", "percent": 101}).status_code == 400
    assert c.delete("/api/t1/v1/firmware/rollout").status_code == 200
    assert c.get("/api/t1/v1/firmware").json()["rollout"] is None


def test_the_firmware_in_a_live_rollout_is_never_pruned(env):
    c, svc, _ = env
    upload(c, "1.0.0", image(fill=1))
    c.post("/api/t1/v1/firmware/rollout", json={"version": "1.0.0", "percent": 100})
    for i in range(8):
        upload(c, f"1.1.{i}", image(fill=i + 2))
    versions = {f["version"] for f in svc.firmware_list()}
    assert "1.0.0" in versions and len(versions) <= 6


def test_firmware_endpoints_are_admin_only_from_another_machine(env, monkeypatch):
    import t1server.app as appmod
    monkeypatch.setattr(appmod, "TRUST_LOOPBACK", False)
    store = Store(":memory:")
    c = TestClient(appmod.create_app(store, Service(store, fetch=lambda u: "0.0.0.0 x.example\n")))
    assert upload(c, "0.3.0").status_code == 401
    assert c.get("/api/t1/v1/firmware").status_code == 401
    admin = {"X-T1-Admin": tokens()["admin_token"]}
    assert upload(c, "0.3.0", headers=admin).status_code == 200


# ── fleet view ─────────────────────────────────────────────────────────────
def test_fleet_summary_breaks_boards_down_by_firmware(env):
    c, *_ = env
    for i, fw in enumerate(["0.1.0", "0.1.0", "0.2.0"]):
        did = f"gft1-fleet{i:07d}"
        c.post("/api/t1/v1/telemetry", json={"id": did, "fw": fw, "status": "active"}, headers=enrol(c, did))
    fleet = c.get("/api/t1/v1/status").json()["fleet"]
    assert fleet["firmware"] == {"0.1.0": 2, "0.2.0": 1}
    dev = c.get("/api/t1/v1/devices").json()[0]
    assert dev["token"] == "enrolled"


# ── MCP ────────────────────────────────────────────────────────────────────
def test_mcp_has_firmware_and_token_tools(env):
    c, *_ = env
    tools = {t["name"] for t in c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
             .json()["result"]["tools"]}
    assert {"t1_firmware_list", "t1_firmware_rollout", "t1_revoke_device", "t1_reset_device_token"} <= tools
    upload(c, "0.4.0")
    r = c.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
        "name": "t1_firmware_rollout", "arguments": {"version": "0.4.0", "percent": 10}}}).json()["result"]
    assert "isError" not in r and "0.4.0" in r["content"][0]["text"]
    bad = c.post("/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
        "name": "t1_firmware_rollout", "arguments": {"version": "nope", "percent": 10}}}).json()["result"]
    assert bad["isError"] is True


# ── backup ─────────────────────────────────────────────────────────────────
def test_backup_holds_the_signing_key_the_secrets_and_a_readable_database(env, tmp_path):
    c, svc, store = env
    enrol(c, "gft1-0000000000bk")
    from t1server.backup import make_backup
    z = make_backup(tmp_path / "out", store=store)
    with zipfile.ZipFile(z) as zf:
        names = set(zf.namelist())
        assert "keys/t1-signing.pem" in names and "secrets.json" in names and "t1.db" in names
        db = tmp_path / "restored.db"
        db.write_bytes(zf.read("t1.db"))
    rows = sqlite3.connect(db).execute("SELECT device_id FROM device_tokens").fetchall()
    assert rows == [("gft1-0000000000bk",)]
