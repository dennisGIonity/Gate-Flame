"""
Gate^Flame Fleet Dashboard — receives the existing health_feed.py POSTs from
every node and shows them on one page.

Contract (matches node-agent/gateflame/health_feed.py and
docs/PAIRING-AND-TELEMETRY.md §4.4 exactly):

    POST /api/v1/nodes/{node_id}/health
    Authorization: Bearer <token>
    {
      "nodeId": "...", "agentVersion": "...", "sentAt": "...",
      "uptimeSeconds": 0,
      "host": {cpuPercent, memUsedMB, memTotalMB, diskUsedPercent, tempC, throttleFlags},
      "modules": [{id, status, gap}],
      "counters": {errors24h, restarts24h, wanBudgetUsedPercent},
      "piholeReachable": true
    }

Scope, deliberately: this is HEALTH ONLY, same as the payload it receives.
It never asks for and would have nowhere to put domains, client IPs, hostnames
or threat logs even if a node someday sent them. See §4.1's two columns.

Auth model (read this before deploying):

  - Node -> server: one shared bearer token (GATEFLAME_FLEET_TOKEN), matching
    what node-agent's health_feed.py sends today via GATEFLAME_FEED_TOKEN.
    docs/PAIRING-AND-TELEMETRY.md §4.4 documents a PER-NODE token issued at
    provisioning instead. This server stores tokens in a table (see `tokens`)
    so upgrading to per-node tokens later is a data migration, not a rewrite —
    but until that's done, ANY node with the shared token can post as ANY
    nodeId. Fine for your own test unit; do this properly before real
    customers' boxes report here.

  - Browser -> server (the dashboard itself): HTTP Basic Auth
    (GATEFLAME_FLEET_ADMIN_USER / GATEFLAME_FLEET_ADMIN_PASSWORD). This page
    shows real customer fleet data once more than one box reports in — it
    must never be left open on the public internet without this set.

Storage: SQLite, one row per node (latest snapshot only, upserted). No
history table in v1 — "just the fleet dashboard" was the ask. Add one later
if you want uptime graphs; the schema comment below marks where.
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse

DB_PATH = os.environ.get("GATEFLAME_FLEET_DB", "./fleet.db")
FEED_TOKEN = os.environ.get("GATEFLAME_FLEET_TOKEN", "")
ADMIN_USER = os.environ.get("GATEFLAME_FLEET_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("GATEFLAME_FLEET_ADMIN_PASSWORD", "")
STATIC_DIR = Path(__file__).parent / "static"

# A node is considered offline once it's missed roughly two report cycles.
# node-agent's default GATEFLAME_FEED_INTERVAL_SECONDS is 900 (15 min).
STALE_AFTER_SECONDS = int(os.environ.get("GATEFLAME_FLEET_STALE_SECONDS", "1800"))

app = FastAPI(title="Gate^Flame Fleet Dashboard")


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS nodes (
                node_id TEXT PRIMARY KEY,
                agent_version TEXT,
                last_seen_at REAL NOT NULL,
                sent_at TEXT,
                uptime_seconds INTEGER,
                pihole_reachable INTEGER,
                payload_json TEXT NOT NULL
            )
            """
        )
        # Upgrade path for per-node feed tokens (§4.4). Empty/unused in v1 —
        # every post is checked against GATEFLAME_FLEET_TOKEN instead. Wire
        # this up before real customer units report here.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tokens (
                node_id TEXT PRIMARY KEY,
                token TEXT NOT NULL,
                issued_at REAL NOT NULL
            )
            """
        )


@app.on_event("startup")
def _startup() -> None:
    if not FEED_TOKEN:
        raise RuntimeError(
            "GATEFLAME_FLEET_TOKEN is not set. Refusing to start with an open "
            "ingest endpoint — set it to the same value as node-agent's "
            "GATEFLAME_FEED_TOKEN."
        )
    if not ADMIN_PASSWORD:
        raise RuntimeError(
            "GATEFLAME_FLEET_ADMIN_PASSWORD is not set. Refusing to start with "
            "an open dashboard — set it before running this anywhere reachable."
        )
    init_db()


def _check_basic_auth(authorization: str | None) -> None:
    """Constant-time-ish Basic Auth check for the dashboard/API reads."""
    if not authorization or not authorization.startswith("Basic "):
        raise HTTPException(status_code=401, detail="auth required", headers={"WWW-Authenticate": "Basic"})
    import base64

    try:
        decoded = base64.b64decode(authorization[6:]).decode("utf-8")
        user, _, password = decoded.partition(":")
    except Exception:
        raise HTTPException(status_code=401, detail="malformed auth", headers={"WWW-Authenticate": "Basic"})
    if not (secrets.compare_digest(user, ADMIN_USER) and secrets.compare_digest(password, ADMIN_PASSWORD)):
        raise HTTPException(status_code=401, detail="bad credentials", headers={"WWW-Authenticate": "Basic"})


@app.get("/healthz")
def healthz() -> dict:
    """Liveness check for whatever's watching this service itself. Unauthenticated
    on purpose — it says nothing about any node, only that this process is up."""
    return {"ok": True}


@app.post("/api/v1/nodes/{node_id}/health", status_code=204)
async def ingest_health(node_id: str, request: Request, authorization: str | None = Header(None)) -> Response:
    expected = f"Bearer {FEED_TOKEN}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="bad or missing token")

    try:
        payload: dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body is not valid JSON")

    if payload.get("nodeId") != node_id:
        raise HTTPException(status_code=400, detail="nodeId in body does not match nodeId in path")

    host = payload.get("host") or {}
    with db() as conn:
        conn.execute(
            """
            INSERT INTO nodes (node_id, agent_version, last_seen_at, sent_at, uptime_seconds, pihole_reachable, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(node_id) DO UPDATE SET
                agent_version=excluded.agent_version,
                last_seen_at=excluded.last_seen_at,
                sent_at=excluded.sent_at,
                uptime_seconds=excluded.uptime_seconds,
                pihole_reachable=excluded.pihole_reachable,
                payload_json=excluded.payload_json
            """,
            (
                node_id,
                payload.get("agentVersion"),
                time.time(),
                payload.get("sentAt"),
                payload.get("uptimeSeconds"),
                1 if payload.get("piholeReachable") else 0,
                json.dumps(payload),
            ),
        )
    return Response(status_code=204)


@app.get("/api/v1/nodes")
def list_nodes(authorization: str | None = Header(None)) -> JSONResponse:
    _check_basic_auth(authorization)
    now = time.time()
    out = []
    with db() as conn:
        rows = conn.execute("SELECT * FROM nodes ORDER BY last_seen_at DESC").fetchall()
    for row in rows:
        payload = json.loads(row["payload_json"])
        age = now - row["last_seen_at"]
        status = "online" if age < STALE_AFTER_SECONDS else ("stale" if age < STALE_AFTER_SECONDS * 4 else "offline")
        out.append(
            {
                "nodeId": row["node_id"],
                "agentVersion": row["agent_version"],
                "lastSeenAgoSeconds": round(age),
                "status": status,
                "sentAt": row["sent_at"],
                "uptimeSeconds": row["uptime_seconds"],
                "piholeReachable": bool(row["pihole_reachable"]),
                "host": payload.get("host", {}),
                "modules": payload.get("modules", []),
                "counters": payload.get("counters", {}),
            }
        )
    return JSONResponse(out)


@app.get("/")
def dashboard(authorization: str | None = Header(None)) -> FileResponse:
    _check_basic_auth(authorization)
    return FileResponse(STATIC_DIR / "index.html")
