"""Simulate one T1 board against a running T1 server - end to end, the way the 0.2 firmware
does it: enrol (enrolment token -> a token of its own) -> manifest -> download -> SHA-256 +
ECDSA check -> telemetry -> commands.

  t1\\server\\.venv\\Scripts\\python.exe t1\\scripts\\sim-device.py [--reports 3] [--forget]

Proves the server side of the device contract before hardware is on the bench. The simulated
device is named sim-t1-<n>. The server enrols a board id exactly once, so a re-run resets the
simulated board's token first (admin call, loopback) - exactly what an administrator does for
a real board that was re-flashed. --forget removes the device afterwards.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from t1server import bloom, signing  # noqa: E402
from t1server.config import tokens  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--server", default="http://127.0.0.1:8095")
ap.add_argument("--level", default="low")
ap.add_argument("--id", default="sim-t1-1")
ap.add_argument("--reports", type=int, default=3)
ap.add_argument("--forget", action="store_true")
a = ap.parse_args()
tok = tokens()
admin = {"X-T1-Admin": tok["admin_token"]}

# 1. enrol - the one call a board makes with the enrolment token
def enrol() -> httpx.Response:
    return httpx.post(f"{a.server}/api/t1/v1/enrol", headers={"X-T1-Enrol": tok["enrol_token"]},
                      json={"id": a.id}, timeout=15)

r = enrol()
if r.status_code == 409:
    print(f"{a.id} is already enrolled: resetting its token (admin), as for a re-flashed board")
    httpx.post(f"{a.server}/api/t1/v1/devices/{a.id}/token/reset", headers=admin, timeout=15).raise_for_status()
    r = enrol()
r.raise_for_status()
token = r.json()["token"]
print(f"enrolled {a.id}: token of its own ({len(token)} chars)")
c = httpx.Client(base_url=a.server, headers={"X-T1-Id": a.id, "X-T1-Token": token}, timeout=60)

# 2. the shared enrolment token must NOT open the device API (it can only enrol)
bad = httpx.get(f"{a.server}/api/t1/v1/manifest.txt", headers={"X-T1-Id": a.id, "X-T1-Token": tok["enrol_token"]}, timeout=15)
print(f"enrolment token on the device API: HTTP {bad.status_code} (expected 401)")
if bad.status_code != 401:
    sys.exit(1)

man = dict(l.split("=", 1) for l in c.get(f"/api/t1/v1/manifest.txt?level={a.level}&fw=sim").text.split())
t = time.time()
blob = c.get(man["filter_url"]).content
ok = hashlib.sha256(blob).hexdigest() == man["filter_sha256"] and signing.verify(blob, man["filter_sig"])
f = bloom.Filter(blob)
print(f"filter {a.level} v{f.version}: {len(blob)/1e6:.2f} MB in {time.time()-t:.1f}s, signature {'OK' if ok else 'BAD'}")
if not ok:
    sys.exit(1)
probe = ["doubleclick.net", "googleadservices.com", "www.wikipedia.org", "github.com"]
print("lookups:", {d: f.contains(d) for d in probe})

q = blk = 0
last = {}
for i in range(a.reports):
    q += 120; blk += 23
    body = {"id": a.id, "product": "GateFlame-T1", "fw": "sim", "boot": "simboot", "status": "active", "level": a.level,
            "ip": "sim", "filter_version": f.version, "allow_version": int(man["allow_version"]), "uptime": 30 * (i + 1),
            "rssi": -58, "heap_free": 180000, "psram_total": 8388608, "psram_free": 8388608 - len(blob),
            "upstream": "9.9.9.9,149.112.112.112", "q": q, "blk": blk, "fwd": q - blk, "to": 0,
            "chit": 40 * (i + 1), "cmiss": 80, "tq": 3, "tblk": 1, "tfwd": 2, "terr": 0, "captive": 0,
            "pending_verify": 0, "ota": "", **last}
    r = c.post("/api/t1/v1/telemetry", json=body)
    print(f"report {i+1}: HTTP {r.status_code} {r.text.strip()!r}")
    r.raise_for_status()
    last = {}
    for line in r.text.splitlines():
        if line.startswith("cmd "):
            _, cid, name, arg = line.split(" ", 3)
            last = {"last_cmd_id": int(cid), "last_cmd_ok": 1, "last_cmd_msg": f"sim ran {name} {arg}"}
    if i < a.reports - 1:
        time.sleep(2)
if a.forget:
    httpx.delete(f"{a.server}/api/t1/v1/devices/{a.id}", headers=admin, timeout=10)
    print(f"forgot {a.id}")
