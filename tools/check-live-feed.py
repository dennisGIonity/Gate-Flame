"""Is the REAL Pi still getting through after the auth change?"""
import base64
import json
import re
import urllib.request
from pathlib import Path

ENV = Path(r"C:\Users\DGMic\Downloads\GF Files\gateflame-fleet\fleet.env.ps1").read_text(encoding="utf-8-sig")
user = re.search(r'ADMIN_USER\s*=\s*"([^"]+)"', ENV).group(1)
pw = re.search(r'ADMIN_PASSWORD\s*=\s*"([^"]+)"', ENV).group(1)
auth = base64.b64encode(f"{user}:{pw}".encode()).decode()


def get(path):
    req = urllib.request.Request("http://127.0.0.1:8091" + path, headers={"Authorization": "Basic " + auth})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


s = get("/api/v1/fleet/summary")
print(f"fleet: {s['total']} total · {s['online']} online · {s['stale']} stale · {s['offline']} offline")
print(f"trend points: {len(s['trend'])}")
print()
for n in get("/api/v1/nodes"):
    print(f"  {n['nodeId']:<18} {n['status']:<8} seen {n['lastSeenAgoSeconds']}s ago  "
          f"agent {n['agentVersion']}  cpu {n['host'].get('cpuPercent')}  temp {n['host'].get('tempC')}")
print()
real = [n for n in get("/api/v1/nodes") if n["nodeId"].startswith("GF-72")]
if real:
    n = real[0]
    print(f"LIVE PI: last seen {n['lastSeenAgoSeconds']}s ago -> "
          f"{'STILL REPORTING' if n['lastSeenAgoSeconds'] < 900 else 'HAS NOT REPORTED RECENTLY - CHECK IT'}")
    h = get(f"/api/v1/nodes/{n['nodeId']}/history?window=24h")
    print(f"history: {len(h['points'])} points, {h['resolution']}")
else:
    print("LIVE PI NOT PRESENT")
