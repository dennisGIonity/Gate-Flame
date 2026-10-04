"""T1 server settings. Everything operational lives under DATA_DIR (git-ignored)."""
from __future__ import annotations

import json
import os
import secrets
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]           # t1/server
REPO_ROOT = SERVER_DIR.parents[1]                            # E:\.claude\Ionity\Gateflame
DATA_DIR = Path(os.environ.get("T1_DATA_DIR", SERVER_DIR / "data"))
PORT = int(os.environ.get("T1_PORT", "8095"))               # 8090 dev agent, 8091 fleet, 8099 ESP32-MCP
FP_RATE = float(os.environ.get("T1_FP_RATE", "0.001"))
RETENTION_DAYS = int(os.environ.get("T1_RETENTION_DAYS", "7"))
FETCH_TIMEOUT = float(os.environ.get("T1_FETCH_TIMEOUT", "180"))
KEEP_FILTERS = 3
KEEP_FIRMWARE = 5
MAX_FIRMWARE_BYTES = 3 * 1024 * 1024 - 64 * 1024     # one app slot of app3M_fat9M_16MB, with headroom
# 0.1 boards authenticate with ONE shared token. Off by default: a lost or stolen board must be
# cuttable without reflashing the others (docs/T1-BLUEPRINT.md pattern 3). Set T1_LEGACY_TOKEN=1
# only while migrating lab boards.
LEGACY_SHARED_TOKEN = os.environ.get("T1_LEGACY_TOKEN", "0") == "1"
# Admin from this machine needs no token (the server runs on Dennis's workstation). Set to 0 when
# the server sits behind a reverse proxy, where every request would look like loopback.
TRUST_LOOPBACK = os.environ.get("T1_TRUST_LOOPBACK", "1") == "1"
ENROL_PER_MINUTE = int(os.environ.get("T1_ENROL_PER_MINUTE", "20"))
ONLINE_S, STALE_S = 90, 300          # device reports every 30 s
LEVELS = ("low", "medium", "high")
COMMANDS = ("pause", "resume", "update", "reboot", "identify", "set_level", "set_upstream")


def data_path(*parts: str) -> Path:
    p = DATA_DIR.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def tokens() -> dict:
    """enrol_token (typed into a board ONCE at provisioning; it can only enrol, never read
    a filter or report), admin_token (dashboard from another machine, MCP over the LAN) and
    device_token (the pre-0.2 shared fleet token, kept only so an old board can still be
    reached while it is re-provisioned - see LEGACY_SHARED_TOKEN). Generated once, never
    printed to logs."""
    f = data_path("secrets.json")
    if f.exists():
        t = json.loads(f.read_text())
        if "enrol_token" not in t:                      # a 0.1 secrets.json: add, never rewrite
            t["enrol_token"] = secrets.token_urlsafe(24)
            f.write_text(json.dumps(t, indent=2))
        return t
    t = {"device_token": secrets.token_urlsafe(24), "admin_token": secrets.token_urlsafe(24),
         "enrol_token": secrets.token_urlsafe(24)}
    f.write_text(json.dumps(t, indent=2))
    return t
