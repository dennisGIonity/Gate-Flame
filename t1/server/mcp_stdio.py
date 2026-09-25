"""stdio <-> HTTP bridge so an MCP client that only speaks stdio (e.g. Claude Desktop) can
use the T1 server's /mcp endpoint. Answers initialize/tools/list locally when the server
is down, so the client does not drop the connector; tool calls then report the outage.

Claude Desktop config (claude_desktop_config.json):
  "gateflame-t1": {
    "command": "E:\\\\Gateflame\\\\t1\\\\server\\\\.venv\\\\Scripts\\\\python.exe",
    "args": ["E:\\\\Gateflame\\\\t1\\\\server\\\\mcp_stdio.py"]
  }
Set T1_MCP_URL (and T1_ADMIN_TOKEN when the server is on another machine) if needed.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from t1server import mcp  # noqa: E402

URL = os.environ.get("T1_MCP_URL", "http://127.0.0.1:8095/mcp")
HEADERS = {"X-T1-Admin": os.environ.get("T1_ADMIN_TOKEN", "")}


def local(msg: dict) -> dict | None:
    m = msg.get("method")
    if m == "initialize":
        return {"jsonrpc": "2.0", "id": msg.get("id"), "result": {
            "protocolVersion": mcp.PROTOCOL, "serverInfo": mcp.SERVER_INFO, "capabilities": {"tools": {}}}}
    if m == "tools/list":
        return {"jsonrpc": "2.0", "id": msg.get("id"), "result": {"tools": [
            {"name": n, "description": d, "inputSchema": {"type": "object", "properties": p, "required": r}}
            for n, d, p, r in mcp.TOOLS]}}
    if m and m.startswith("notifications/"):
        return None
    return {"jsonrpc": "2.0", "id": msg.get("id"), "result": {"isError": True, "content": [
        {"type": "text", "text": f"T1 server not reachable at {URL} - start it with tools\\T1-SERVER.cmd"}]}}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            r = httpx.post(URL, json=msg, headers=HEADERS, timeout=60)
            out = r.json() if r.status_code == 200 else None
        except httpx.HTTPError:
            out = local(msg)
        if out is not None:
            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
