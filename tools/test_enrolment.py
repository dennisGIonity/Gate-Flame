"""Prove the per-node token rollout cannot break a box already in the field.

Written in python rather than PowerShell after the PS version silently mixed
its own log lines into the value it returned and reported success it had not
observed. A test that can lie is worse than no test.
"""
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ENV = Path(r"C:\Users\DGMic\Downloads\GF Files\gateflame-fleet\fleet.env.ps1").read_text(encoding="utf-8-sig")
SHARED = re.search(r'GATEFLAME_FLEET_TOKEN\s*=\s*"([^"]+)"', ENV).group(1)
NODE = "GF-ROLLOUTTEST"
BASE = f"http://127.0.0.1:8091/api/v1/nodes/{NODE}/health"

BODY = json.dumps({
    "nodeId": NODE, "agentVersion": "0.0.0", "sentAt": "2026-08-31T00:00:00Z",
    "uptimeSeconds": 1, "host": {}, "modules": [], "counters": {}, "piholeReachable": False,
}).encode()


def post(bearer):
    req = urllib.request.Request(
        BASE, data=BODY, method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + bearer},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            raw = r.read().decode() or ""
            tok = json.loads(raw).get("nodeToken") if raw.strip().startswith("{") else None
            return r.status, tok
    except urllib.error.HTTPError as e:
        return e.code, None


fails = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}: got {got}, expected {want}")
    if not ok:
        fails.append(label)


print("1. brand new box enrols with the shared installer token")
code, tok1 = post(SHARED)
check("enrolment accepted", code, 201)
check("a token was issued", tok1 is not None, True)

print("\n2. OLD agent ignores the token and posts with the shared one again")
print("   (this is the exact case that broke the live Pi in the first attempt)")
code, tok2 = post(SHARED)
check("still accepted", code, 201)
check("token re-offered", tok2 is not None, True)

print("\n3. upgraded agent posts with its OWN token - this activates it")
code, _ = post(tok2)
check("own token accepted", code, 204)

print("\n4. now the shared installer token must be REFUSED for this box")
code, _ = post(SHARED)
check("shared token rejected after activation", code, 401)

print("\n5. its own token keeps working")
code, _ = post(tok2)
check("own token still accepted", code, 204)

print("\n6. a stranger's token is refused")
code, _ = post("not-a-real-token")
check("bogus token rejected", code, 401)

print()
print("ALL PASSED" if not fails else f"{len(fails)} FAILED: {fails}")
