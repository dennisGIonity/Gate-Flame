"""T1 server tests. The C-compatibility tests compile the FIRMWARE's headers on the host
and prove they read the server's files the same way - the one failure that would make
every T1 box silently filter the wrong domains."""
from __future__ import annotations

import hashlib
import random
import shutil
import string
import struct
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from t1server import bloom, lists, signing
from t1server.app import create_app
from t1server.config import tokens
from t1server.service import Service
from t1server.store import Store

HERE = Path(__file__).resolve().parent


def rand_domains(n, seed=1):
    r = random.Random(seed)
    return [".".join("".join(r.choices(string.ascii_lowercase + string.digits, k=r.randint(3, 12)))
                     for _ in range(r.randint(2, 4))) for _ in range(n)]


# ── bloom ──────────────────────────────────────────────────────────────────
def test_no_false_negatives_and_fp_near_target():
    doms = rand_domains(20000)
    bf = bloom.build(doms, "low", 1, fp_rate=0.01)
    f = bloom.Filter(bf.blob)
    assert all(f.contains(d) for d in doms)
    others = [d for d in rand_domains(20000, seed=99) if d not in set(doms)]
    fp = sum(f.contains(d) for d in others) / len(others)
    assert fp < 0.02, fp            # target 1 %, allow noise


def test_header_layout_is_the_documented_one():
    bf = bloom.build(["a.example.com"], "medium", 1234, 0.001)
    assert bf.blob[:8] == b"GFT1BLM\x00"
    fmt, k, _, m, n, ver = struct.unpack_from("<HBBIII", bf.blob, 8)
    assert (fmt, n, ver) == (1, 1, 1234)
    assert bf.blob[24:32].rstrip(b"\x00") == b"medium"
    assert len(bf.blob) == 32 + (m + 7) // 8


def test_matching_is_exact_like_pihole_gravity():
    f = bloom.Filter(bloom.build(["ads.example.com"], "low", 1, 0.0001).blob)
    assert f.contains("ADS.Example.com.")          # case and trailing dot normalised
    assert not f.contains("x.ads.example.com")      # NO parent-domain matching


def test_sizing_for_the_real_list():
    m, k = bloom.size_for(3_081_748, 0.001)
    assert 5.3e6 < m / 8 < 5.7e6 and k == 10        # fits the 8 MB PSRAM of an N16R8


# ── lists ──────────────────────────────────────────────────────────────────
def test_parse_formats():
    txt = "# c\n0.0.0.0 ads.a.com\n127.0.0.1  t.b.net # x\nplain.c.org\n||abp.d.io^\n0.0.0.0 localhost\n1.2.3.4\n!x\n"
    assert lists.parse(txt) == {"ads.a.com", "t.b.net", "plain.c.org", "abp.d.io"}


def test_levels_come_from_the_t3_threat_level_module():
    assert lists.sources("low") == lists.threat_level.lists_for("low")
    assert set(lists.sources("low")) < set(lists.sources("high"))


# ── signing ────────────────────────────────────────────────────────────────
def test_signature_round_trip_and_tamper():
    blob = b"hello filter"
    sig = signing.sign(blob)
    assert signing.verify(blob, sig)
    assert not signing.verify(blob + b"!", sig)
    assert "BEGIN PUBLIC KEY" in signing.firmware_header()


# ── API + service ──────────────────────────────────────────────────────────
FAKE = {u: "\n".join(f"0.0.0.0 {d}" for d in rand_domains(300, seed=i)) + "\n0.0.0.0 known-bad.example\n"
        for i, u in enumerate(lists.all_sources())}


@pytest.fixture()
def client(tmp_path):
    store = Store(tmp_path / "t.db")
    svc = Service(store, fetch=lambda u: FAKE[u])
    svc.build_filters(background=False)
    assert not svc.build_state["error"], svc.build_state
    return TestClient(create_app(store, svc)), svc


def enrol(c, did="gft1-aabbcc"):
    """Enrol a board the way the firmware does, and return the headers it then sends."""
    r = c.post("/api/t1/v1/enrol", json={"id": did}, headers={"X-T1-Enrol": tokens()["enrol_token"]})
    assert r.status_code == 200, r.text
    return {"X-T1-Id": did, "X-T1-Token": r.json()["token"]}


def test_device_needs_token(client):
    c, _ = client
    assert c.get("/api/t1/v1/manifest.txt").status_code == 401
    assert c.post("/api/t1/v1/telemetry", json={"id": "x"}).status_code == 401
    # The 0.1 shared fleet token no longer opens anything.
    assert c.get("/api/t1/v1/manifest.txt", headers={"X-T1-Token": tokens()["device_token"]}).status_code == 401


def test_manifest_file_and_signature_verify(client):
    c, _ = client
    H = enrol(c)
    man = dict(l.split("=", 1) for l in c.get("/api/t1/v1/manifest.txt?level=medium", headers=H).text.split())
    blob = c.get(man["filter_url"], headers=H).content
    assert len(blob) == int(man["filter_size"]) and hashlib.sha256(blob).hexdigest() == man["filter_sha256"]
    assert signing.verify(blob, man["filter_sig"])
    assert bloom.Filter(blob).contains("known-bad.example")


def test_telemetry_command_round_trip(client):
    c, svc = client
    H = enrol(c)
    base = {"id": "gft1-aabbcc", "fw": "0.1.0", "status": "active", "level": "low", "boot": "b1",
            "q": 10, "blk": 3, "fwd": 7, "filter_version": 0}
    assert c.post("/api/t1/v1/telemetry", json=base, headers=H).text == "ok\n"
    r = c.post("/api/t1/v1/devices/gft1-aabbcc/cmd", json={"command": "pause", "arg": "15"})
    cid = r.json()["queued"][0]
    assert c.post("/api/t1/v1/devices/gft1-aabbcc/cmd", json={"command": "rm -rf"}).status_code == 400
    text = c.post("/api/t1/v1/telemetry", json=base, headers=H).text
    assert f"cmd {cid} pause 15" in text
    # delivered once, not twice
    assert "cmd" not in c.post("/api/t1/v1/telemetry", json=base, headers=H).text
    c.post("/api/t1/v1/telemetry", json={**base, "status": "paused", "last_cmd_id": cid, "last_cmd_ok": 1,
                                          "last_cmd_msg": "paused 15 min"}, headers=H)
    d = c.get("/api/t1/v1/devices/gft1-aabbcc").json()
    assert d["status_label"] == "PAUSED" and d["commands"][0]["result_ok"] == 1
    assert d["filter_current"] is False            # reports version 0, server has a newer one


def test_check_domain_explains_itself(client):
    c, svc = client
    r = c.get("/api/t1/v1/check?domain=known-bad.example&level=low").json()
    assert r["verdict"] == "blocked (on a blocklist)"
    c.post("/api/t1/v1/allowlist", json={"domain": "known-bad.example"})
    assert c.get("/api/t1/v1/check?domain=known-bad.example").json()["verdict"].startswith("allowed (on the allow")
    assert c.get("/api/t1/v1/allow.txt", headers=enrol(c, "gft1-allow01")).text == "known-bad.example\n"


def test_mcp(client):
    c, _ = client
    assert c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"}).json()["result"]["serverInfo"]
    tools = c.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]["tools"]
    assert {t["name"] for t in tools} >= {"t1_fleet_summary", "t1_send_command", "t1_check_domain"}
    r = c.post("/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                             "params": {"name": "t1_check_domain", "arguments": {"domain": "known-bad.example"}}})
    assert "blocked" in r.json()["result"]["content"][0]["text"]


def test_dashboard_served(client):
    c, _ = client
    assert "Gate^Flame T1" in c.get("/").text


# ── C (firmware headers) vs Python ─────────────────────────────────────────
@pytest.fixture(scope="module")
def host_bin(tmp_path_factory):
    cc = shutil.which("gcc") or shutil.which("cc")
    if not cc:
        pytest.skip("no C compiler on this machine")
    out = tmp_path_factory.mktemp("c") / "host_test"
    subprocess.run([cc, "-O2", "-Wall", "-Werror", "-o", str(out), str(HERE / "c" / "host_test.c")], check=True)
    return out


def test_c_and_python_agree_on_a_real_file(host_bin, tmp_path):
    doms = rand_domains(5000)
    bf = bloom.build(doms, "high", 7, 0.01)
    (tmp_path / "f.bin").write_bytes(bf.blob)
    probe = doms[:500] + rand_domains(2000, seed=5) + ["UPPER." + doms[0].upper()[6:], doms[1] + ".", ""]
    (tmp_path / "d.txt").write_text("\n".join(probe) + "\n")
    got = subprocess.run([str(host_bin), "bloom", str(tmp_path / "f.bin"), str(tmp_path / "d.txt")],
                         capture_output=True, text=True, check=True).stdout.split()
    f = bloom.Filter(bf.blob)
    want = [("-1" if not bloom.normalise(p) else str(int(f.contains(p)))) for p in probe]
    assert got == want
    assert got[:500] == ["1"] * 500


def test_c_dns_block_reply(host_bin):
    out = subprocess.run([str(host_bin), "dns", "Ads.Example.com", "1"], capture_output=True, text=True,
                         check=True).stdout.split("\n")
    q, parse, block, servfail = out[0], out[1], out[2], out[3]
    assert parse == "parse 0 Ads.Example.com 1"
    b = bytes.fromhex(block)
    assert b[:2] == b"\xab\xcd"                         # same ID
    assert b[2] & 0x80 and b[3] & 0x80 and (b[3] & 0xF) == 0   # QR, RA, NOERROR
    assert b[6:8] == b"\x00\x01"                        # one answer
    assert b[-4:] == b"\x00\x00\x00\x00" and b[-6:-4] == b"\x00\x04"   # 0.0.0.0
    assert bytes.fromhex(servfail)[3] & 0xF == 2
    aaaa = subprocess.run([str(host_bin), "dns", "x.y", "28"], capture_output=True, text=True).stdout.split("\n")[2]
    assert bytes.fromhex(aaaa)[-16:] == b"\x00" * 16
    mx = subprocess.run([str(host_bin), "dns", "x.y", "15"], capture_output=True, text=True).stdout.split("\n")[2]
    assert bytes.fromhex(mx)[6:8] == b"\x00\x00"        # NODATA for other types
