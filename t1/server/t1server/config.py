"""T1 server settings. Everything operational lives under DATA_DIR (git-ignored)."""
from __future__ import annotations

import json
import os
import secrets
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]           # t1/server
REPO_ROOT = SERVER_DIR.parents[1]                            # E:\Gateflame
DATA_DIR = Path(os.environ.get("T1_DATA_DIR", SERVER_DIR / "data"))
PORT = int(os.environ.get("T1_PORT", "8095"))               # 8090 dev agent, 8091 fleet, 8099 ESP32-MCP
FP_RATE = float(os.environ.get("T1_FP_RATE", "0.001"))
RETENTION_DAYS = int(os.environ.get("T1_RETENTION_DAYS", "7"))
FETCH_TIMEOUT = float(os.environ.get("T1_FETCH_TIMEOUT", "180"))
KEEP_FILTERS = 3
ONLINE_S, STALE_S = 90, 300          # device reports every 30 s
LEVELS = ("low", "medium", "high")
COMMANDS = ("pause", "resume", "update", "reboot", "identify", "set_level", "set_upstream")


def data_path(*parts: str) -> Path:
    p = DATA_DIR.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def tokens() -> dict:
    """device_token (baked into firmware by the build script) and admin_token (dashboard
    from another machine, MCP over the LAN). Generated once, never printed to logs."""
    f = data_path("secrets.json")
    if f.exists():
        return json.loads(f.read_text())
    t = {"device_token": secrets.token_urlsafe(24), "admin_token": secrets.token_urlsafe(24)}
    f.write_text(json.dumps(t, indent=2))
    return t
