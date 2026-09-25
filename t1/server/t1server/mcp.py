"""MCP (JSON-RPC 2.0, protocol 2024-11-05) over HTTP POST /mcp.

Every tool is a thin wrapper over Service, so an AI answer and the dashboard are
reading the same numbers. Tool names are prefixed `t1_` so they never collide with
the separate ESP32-MCP project's tools when both are connected to one client.
"""
from __future__ import annotations

import json

from .config import COMMANDS, LEVELS
from .service import Service

PROTOCOL = "2024-11-05"
SERVER_INFO = {"name": "gateflame-t1-mcp", "version": "0.1.0"}

_S = {"type": "string"}
TOOLS = [
    ("t1_fleet_summary", "Counts of T1 devices by health and protection status, total queries/blocked, "
     "which devices run an out-of-date filter, and current filter versions.", {}, []),
    ("t1_list_devices", "Every T1 device with health, protection status, filter version, query/block "
     "counters, Wi-Fi RSSI and memory.", {}, []),
    ("t1_get_device", "One device in detail: last 24 h of telemetry, recent commands and events.",
     {"device_id": _S}, ["device_id"]),
    ("t1_send_command", f"Queue a command for a device (or '*' for all). Delivered on the device's next "
     f"report (<=30 s). Commands: {', '.join(COMMANDS)}. pause arg = minutes; set_level arg = "
     f"{'/'.join(LEVELS)}; set_upstream arg = 'ip[,ip]'.",
     {"device_id": _S, "command": {"type": "string", "enum": list(COMMANDS)}, "arg": _S},
     ["device_id", "command"]),
    ("t1_filter_status", "Current filter per level (domains, size, false-positive rate, sources and "
     "whether each was read live or from cache), the build state, and the allow-list version.", {}, []),
    ("t1_build_filters", "Rebuild all three level filters from the blocklist sources (runs in the "
     "background; poll t1_filter_status).", {}, []),
    ("t1_check_domain", "What a T1 box on a level does with a domain, and why: on a blocklist, a Bloom "
     "false positive, or allow-listed.", {"domain": _S, "level": {"type": "string", "enum": list(LEVELS)}},
     ["domain"]),
    ("t1_allowlist_add", "Allow a domain on every T1 device (fixes a false positive). Devices pick it up "
     "on their next update check.", {"domain": _S, "note": _S}, ["domain"]),
    ("t1_allowlist_remove", "Remove a domain from the allow-list.", {"domain": _S}, ["domain"]),
    ("t1_recent_events", "Fleet event log, newest first.", {"limit": {"type": "integer"}}, []),
]


def _call(svc: Service, name: str, a: dict):
    if name == "t1_fleet_summary":
        return svc.fleet_summary()
    if name == "t1_list_devices":
        return svc.devices()
    if name == "t1_get_device":
        d = svc.device(a["device_id"])
        if d is None:
            raise KeyError(f"no device {a['device_id']}")
        return d
    if name == "t1_send_command":
        return svc.send_command(a["device_id"], a["command"], a.get("arg", ""))
    if name == "t1_filter_status":
        return svc.filter_status()
    if name == "t1_build_filters":
        return svc.build_filters()
    if name == "t1_check_domain":
        return svc.check_domain(a["domain"], a.get("level", "low"))
    if name == "t1_allowlist_add":
        return svc.allow_add(a["domain"], a.get("note", ""))
    if name == "t1_allowlist_remove":
        return svc.allow_remove(a["domain"])
    if name == "t1_recent_events":
        return svc.events(int(a.get("limit", 50)))
    raise LookupError(name)


def handle(svc: Service, msg: dict) -> dict | None:
    mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}

    def ok(result):
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    def err(code, text):
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": text}}

    if method == "initialize":
        return ok({"protocolVersion": PROTOCOL, "serverInfo": SERVER_INFO, "capabilities": {"tools": {}}})
    if method and method.startswith("notifications/"):
        return None
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": [{"name": n, "description": d,
                              "inputSchema": {"type": "object", "properties": p, "required": r}}
                             for n, d, p, r in TOOLS]})
    if method == "tools/call":
        name = params.get("name")
        if name not in {t[0] for t in TOOLS}:
            return err(-32602, f"unknown tool {name}")
        try:
            res = _call(svc, name, params.get("arguments") or {})
            return ok({"content": [{"type": "text", "text": json.dumps(res, indent=1, default=str)}]})
        except (KeyError, ValueError) as e:
            return ok({"content": [{"type": "text", "text": f"error: {e}"}], "isError": True})
    return err(-32601, f"method not found: {method}")
