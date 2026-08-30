"""
Gate^Flame Fleet Dashboard — receives the health check-in every node already
sends (node-agent/gateflame/health_feed.py) and turns it into something you
can run a support business from at a few hundred boxes.

Contract (matches health_feed.py and docs/PAIRING-AND-TELEMETRY.md §4.4):

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

SCOPE, DELIBERATELY: this is HEALTH ONLY, the same as the payload it receives.
It never asks for and has nowhere to put domains, client IPs, hostnames,
device names or threat logs. §4.1's two columns are the whole boundary, and
the owner-typed LAN device names added to the node in device_names.py stay on
the box for exactly this reason.

WHAT CHANGED FOR SCALE (v2)
---------------------------
v1 kept one row per node — the latest snapshot, upserted — and that was the
right size for "just the fleet dashboard". At hundreds of customer units it
is not, so:

  * HISTORY. `samples` keeps every 5-minute check-in for 7 days; a rollup
    folds anything older into hourly averages in `samples_hourly`, kept for
    90 days. Trend graphs need history and there was none. Sized so a few
    hundred boxes stay in the low hundreds of MB rather than growing forever.
  * PER-NODE TOKENS. v1 checked every post against one shared secret, which
    meant any box holding it could post as any nodeId — fine for one test
    unit, a real hole once boxes are in strangers' houses. Tokens are now
    per node, issued on first enrolment. The shared token still works, but
    ONLY to enrol a node that has never been seen before; after that the node
    must use its own. That keeps the existing live box working without
    leaving the door open.
  * ADMIN. Tags, billing state, a customer reference and a timestamped
    support-note log per box — the things that make GF-72TYTITQ mean
    something to the person answering the phone.
  * SEARCH / FILTER / SORT, because a list of 400 is not a list you scroll.

WHAT IS DELIBERATELY NOT HERE
-----------------------------
Remote control. Nodes post outward and nothing reaches back, so this server
cannot currently change anything on a box. The chosen direction is a
persistent per-box tunnel, which needs the Headscale control plane that Shield
is also waiting on (config.headscale_url — `controlPlaneReachable: false`
today). Rather than fake a control surface that cannot work, the schema
carries the per-node identity that enrolment will need, and the UI states
plainly that remote actions are not available yet. See docs/FLEET-TUNNEL.md.

AUTH
  - Node -> server: per-node bearer token (see above).
  - Browser -> server: HTTP Basic. This page shows real customer data; it must
    never be exposed without GATEFLAME_FLEET_ADMIN_PASSWORD set.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse

DB_PATH = os.environ.get("GATEFLAME_FLEET_DB", "./fleet.db")
ENROL_TOKEN = os.environ.get("GATEFLAME_FLEET_TOKEN", "")
ADMIN_USER = os.environ.get("GATEFLAME_FLEET_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("GATEFLAME_FLEET_ADMIN_PASSWORD", "")
STATIC_DIR = Path(__file__).parent / "static"

# A node is offline once it has missed roughly two report cycles. The node's
# own default is 900s; the local drop-in uses 300s. 1800 covers both.
STALE_AFTER_SECONDS = int(os.environ.get("GATEFLAME_FLEET_STALE_SECONDS", "1800"))

# Retention. Raw samples are what you want while diagnosing this week's
# problem; hourly averages are what you want to answer "has this box always
# run hot?". Keeping raw forever buys nothing and costs disk on a machine
# that has other work to do.
RAW_RETENTION_DAYS = int(os.environ.get("GATEFLAME_FLEET_RAW_DAYS", "7"))
HOURLY_RETENTION_DAYS = int(os.environ.get("GATEFLAME_FLEET_HOURLY_DAYS", "90"))

BILLING_STATES = ("active", "trial", "suspended", "unpaid", "cancelled", "unknown")

app = FastAPI(title="Gate^Flame Fleet Dashboard")

_write_lock = threading.Lock()


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        # WAL so a long dashboard read cannot block an incoming check-in.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        yield conn
        conn.commit()
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    node_id TEXT PRIMARY KEY,
    agent_version TEXT,
    first_seen_at REAL NOT NULL,
    last_seen_at REAL NOT NULL,
    sent_at TEXT,
    uptime_seconds INTEGER,
    pihole_reachable INTEGER,
    payload_json TEXT NOT NULL
);

-- One row per node, holding the credential that node posts with.
--
-- v1 had this table but never used it, checking a single shared secret
-- instead. That meant a box in one customer's house could post as a box in
-- another's. Enrolment now mints a token per node on first contact.
CREATE TABLE IF NOT EXISTS tokens (
    node_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    issued_at REAL NOT NULL,
    -- When the node first successfully posted using its OWN token.
    --
    -- This column is the whole reason the rollout does not break anything.
    -- Without it, enrolment mints a token, the node (which does not yet know
    -- to store one) keeps sending the shared token, and its NEXT check-in is
    -- rejected 401 - silently killing the feed of every box already in the
    -- field. Caught exactly that way in testing before it shipped.
    --
    -- So: until a node has proven it can use its own token, the shared token
    -- still works for it. The moment it uses its own, the shared token stops
    -- working for that node and cannot be used to impersonate it again.
    -- Security tightens per box, as each box becomes capable of it.
    activated_at REAL
);

-- Raw check-ins. One row per post, pruned after RAW_RETENTION_DAYS.
CREATE TABLE IF NOT EXISTS samples (
    node_id TEXT NOT NULL,
    at REAL NOT NULL,
    cpu REAL, mem_used REAL, mem_total REAL, disk REAL, temp REAL,
    pihole_ok INTEGER,
    modules_running INTEGER, modules_total INTEGER,
    PRIMARY KEY (node_id, at)
);
CREATE INDEX IF NOT EXISTS idx_samples_at ON samples (at);

-- Hourly averages, so 90 days of trend costs almost nothing to keep or draw.
CREATE TABLE IF NOT EXISTS samples_hourly (
    node_id TEXT NOT NULL,
    hour INTEGER NOT NULL,          -- unix hour bucket
    cpu REAL, mem_pct REAL, disk REAL, temp REAL,
    pihole_ok_pct REAL,
    sample_count INTEGER NOT NULL,
    PRIMARY KEY (node_id, hour)
);
CREATE INDEX IF NOT EXISTS idx_hourly_hour ON samples_hourly (hour);

-- What YOU record about a box. None of this comes from the node, and none of
-- it is ever sent back to one.
CREATE TABLE IF NOT EXISTS node_admin (
    node_id TEXT PRIMARY KEY,
    label TEXT,                     -- what you call this box
    customer_ref TEXT,              -- your own reference, not a name dump
    tags TEXT NOT NULL DEFAULT '[]',
    billing_state TEXT NOT NULL DEFAULT 'unknown',
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_node ON notes (node_id, created_at DESC);
"""


def init_db() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)
        # v1 shipped a `tokens` table with a plaintext `token` column that was
        # never populated. Migrate rather than fail on an existing file.
        cols = {r[1] for r in conn.execute("PRAGMA table_info(tokens)").fetchall()}
        if cols and "token_hash" not in cols:
            conn.executescript(
                "ALTER TABLE tokens RENAME TO tokens_v1;"
                "CREATE TABLE tokens (node_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL,"
                " issued_at REAL NOT NULL, activated_at REAL);"
            )
            cols = {"node_id", "token_hash", "issued_at", "activated_at"}
        # CREATE TABLE IF NOT EXISTS does NOT add a column to a table that
        # already exists, so a database created by an earlier run of THIS file
        # keeps the old shape and every read of activated_at 500s. Found
        # exactly that way in testing.
        if cols and "activated_at" not in cols:
            conn.execute("ALTER TABLE tokens ADD COLUMN activated_at REAL")
        # v1's nodes table had no first_seen_at.
        ncols = {r[1] for r in conn.execute("PRAGMA table_info(nodes)").fetchall()}
        if ncols and "first_seen_at" not in ncols:
            conn.execute("ALTER TABLE nodes ADD COLUMN first_seen_at REAL")
            conn.execute("UPDATE nodes SET first_seen_at = last_seen_at WHERE first_seen_at IS NULL")


def _hash(token: str) -> str:
    import hashlib

    return hashlib.sha256(token.encode()).hexdigest()


@app.on_event("startup")
def _startup() -> None:
    if not ENROL_TOKEN:
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
    threading.Thread(target=_maintenance_loop, daemon=True).start()


# ---------------------------------------------------------------- retention


def _rollup_and_prune() -> None:
    """Fold raw samples older than the raw window into hourly averages, then
    drop what is past retention.

    Averaging is done in SQL over the bucket rather than by re-reading rows in
    python: at a few hundred nodes this runs in milliseconds and never holds
    the write lock long enough to delay a check-in.
    """
    now = time.time()
    raw_cutoff = now - RAW_RETENTION_DAYS * 86400
    hourly_cutoff = now - HOURLY_RETENTION_DAYS * 86400
    with _write_lock, db() as conn:
        conn.execute(
            """
            INSERT INTO samples_hourly (node_id, hour, cpu, mem_pct, disk, temp, pihole_ok_pct, sample_count)
            SELECT node_id,
                   CAST(at / 3600 AS INTEGER) AS hour,
                   AVG(cpu),
                   AVG(CASE WHEN mem_total > 0 THEN 100.0 * mem_used / mem_total END),
                   AVG(disk),
                   AVG(temp),
                   100.0 * AVG(COALESCE(pihole_ok, 0)),
                   COUNT(*)
              FROM samples
             WHERE at < ?
             GROUP BY node_id, hour
            ON CONFLICT(node_id, hour) DO NOTHING
            """,
            (raw_cutoff,),
        )
        conn.execute("DELETE FROM samples WHERE at < ?", (raw_cutoff,))
        conn.execute("DELETE FROM samples_hourly WHERE hour < ?", (hourly_cutoff / 3600,))


def _maintenance_loop() -> None:
    while True:
        try:
            _rollup_and_prune()
        except Exception:  # noqa: BLE001 — maintenance must never kill ingest
            pass
        time.sleep(3600)


# -------------------------------------------------------------------- auth


def _check_basic_auth(authorization: str | None) -> None:
    if not authorization or not authorization.startswith("Basic "):
        raise HTTPException(status_code=401, detail="auth required", headers={"WWW-Authenticate": "Basic"})
    try:
        decoded = base64.b64decode(authorization[6:]).decode("utf-8")
        user, _, password = decoded.partition(":")
    except Exception:
        raise HTTPException(status_code=401, detail="malformed auth", headers={"WWW-Authenticate": "Basic"})
    if not (secrets.compare_digest(user, ADMIN_USER) and secrets.compare_digest(password, ADMIN_PASSWORD)):
        raise HTTPException(status_code=401, detail="bad credentials", headers={"WWW-Authenticate": "Basic"})


def _authorise_node(node_id: str, authorization: str | None) -> str | None:
    """Return a newly issued token if this call enrolled the node, else None.

    Accepted credentials, in order:
      1. The node's OWN token. Always valid, and using it ACTIVATES the node.
      2. The shared enrolment token — but only while the node has not yet
         activated. That covers two cases with one rule: a box that has never
         been seen (mint it a token) and a box running an agent too old to
         store one (keep working, keep re-offering the token).

    Once a node has activated, the shared token is refused for it. An
    installer secret that leaks therefore cannot be used to impersonate any
    box that is already running properly.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="bad or missing token")
    presented = authorization[7:]

    with db() as conn:
        row = conn.execute(
            "SELECT token_hash, activated_at FROM tokens WHERE node_id = ?", (node_id,)
        ).fetchone()

    if row:
        if secrets.compare_digest(_hash(presented), row["token_hash"]):
            if row["activated_at"] is None:
                with _write_lock, db() as conn:
                    conn.execute(
                        "UPDATE tokens SET activated_at = ? WHERE node_id = ?", (time.time(), node_id)
                    )
            return None
        # Wrong token. Fall back to the shared one ONLY if this node has never
        # managed to use its own — i.e. it is still on an agent that does not
        # know about per-node tokens.
        if row["activated_at"] is None and secrets.compare_digest(presented, ENROL_TOKEN):
            # Only the HASH was stored, so the original cannot be handed back.
            # Mint a fresh one and replace it — safe precisely because this
            # node has never activated, so no credential is being invalidated
            # out from under a working box.
            reissued = secrets.token_urlsafe(32)
            with _write_lock, db() as conn:
                conn.execute(
                    "UPDATE tokens SET token_hash = ?, issued_at = ? WHERE node_id = ? AND activated_at IS NULL",
                    (_hash(reissued), time.time(), node_id),
                )
            return reissued
        raise HTTPException(status_code=401, detail="bad token for this node")

    if not secrets.compare_digest(presented, ENROL_TOKEN):
        raise HTTPException(status_code=401, detail="bad or missing token")

    issued = secrets.token_urlsafe(32)
    with _write_lock, db() as conn:
        conn.execute(
            "INSERT INTO tokens (node_id, token_hash, issued_at, activated_at) VALUES (?, ?, ?, NULL) "
            "ON CONFLICT(node_id) DO NOTHING",
            (node_id, _hash(issued), time.time()),
        )
    return issued


# ------------------------------------------------------------------ ingest


@app.get("/healthz")
def healthz() -> dict:
    """Liveness for whatever watches this service. Unauthenticated on purpose —
    it says nothing about any node, only that this process is up."""
    return {"ok": True}


@app.post("/api/v1/nodes/{node_id}/health", status_code=204)
async def ingest_health(node_id: str, request: Request, authorization: str | None = Header(None)) -> Response:
    issued = _authorise_node(node_id, authorization)

    try:
        payload: dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body is not valid JSON")

    if payload.get("nodeId") != node_id:
        raise HTTPException(status_code=400, detail="nodeId in body does not match nodeId in path")

    host = payload.get("host") or {}
    mods = payload.get("modules") or []
    now = time.time()

    with _write_lock, db() as conn:
        conn.execute(
            """
            INSERT INTO nodes (node_id, agent_version, first_seen_at, last_seen_at, sent_at,
                               uptime_seconds, pihole_reachable, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
                now,
                now,
                payload.get("sentAt"),
                payload.get("uptimeSeconds"),
                1 if payload.get("piholeReachable") else 0,
                json.dumps(payload),
            ),
        )
        conn.execute(
            "INSERT OR REPLACE INTO samples "
            "(node_id, at, cpu, mem_used, mem_total, disk, temp, pihole_ok, modules_running, modules_total) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                node_id,
                now,
                host.get("cpuPercent"),
                host.get("memUsedMB"),
                host.get("memTotalMB"),
                host.get("diskUsedPercent"),
                host.get("tempC"),
                1 if payload.get("piholeReachable") else 0,
                sum(1 for m in mods if m.get("status") == "running"),
                len(mods),
            ),
        )

    if issued:
        # 201 + the node's own credential, once, at enrolment. The node is
        # expected to store this and stop using the shared token.
        return JSONResponse(status_code=201, content={"nodeToken": issued})
    return Response(status_code=204)


# -------------------------------------------------------------------- reads


def _status_for(age: float) -> str:
    if age < STALE_AFTER_SECONDS:
        return "online"
    if age < STALE_AFTER_SECONDS * 4:
        return "stale"
    return "offline"


def _admin_rows(conn) -> dict[str, dict]:
    out = {}
    for r in conn.execute("SELECT * FROM node_admin").fetchall():
        out[r["node_id"]] = {
            "label": r["label"],
            "customerRef": r["customer_ref"],
            "tags": json.loads(r["tags"] or "[]"),
            "billingState": r["billing_state"],
        }
    return out


@app.get("/api/v1/nodes")
def list_nodes(
    q: str | None = None,
    status: str | None = None,
    tag: str | None = None,
    billing: str | None = None,
    sort: str = "status",
    authorization: str | None = Header(None),
) -> JSONResponse:
    """The fleet list. Filtering happens here, not in the browser: shipping
    four hundred payloads to filter five of them client-side is how a
    dashboard becomes unusable exactly when the business grows."""
    _check_basic_auth(authorization)
    now = time.time()
    out = []
    with db() as conn:
        admin = _admin_rows(conn)
        rows = conn.execute("SELECT * FROM nodes").fetchall()

    for row in rows:
        payload = json.loads(row["payload_json"])
        age = now - row["last_seen_at"]
        st = _status_for(age)
        a = admin.get(row["node_id"], {})
        mods = payload.get("modules", [])
        entry = {
            "nodeId": row["node_id"],
            "label": a.get("label"),
            "customerRef": a.get("customerRef"),
            "tags": a.get("tags", []),
            "billingState": a.get("billingState", "unknown"),
            "agentVersion": row["agent_version"],
            "lastSeenAgoSeconds": round(age),
            "firstSeenAt": row["first_seen_at"],
            "status": st,
            "sentAt": row["sent_at"],
            "uptimeSeconds": row["uptime_seconds"],
            "piholeReachable": bool(row["pihole_reachable"]),
            "host": payload.get("host", {}),
            "modules": mods,
            "modulesRunning": sum(1 for m in mods if m.get("status") == "running"),
            "counters": payload.get("counters", {}),
        }
        if status and st != status:
            continue
        if tag and tag not in entry["tags"]:
            continue
        if billing and entry["billingState"] != billing:
            continue
        if q:
            hay = " ".join(
                str(x) for x in (entry["nodeId"], entry["label"], entry["customerRef"], " ".join(entry["tags"]))
                if x
            ).lower()
            if q.lower() not in hay:
                continue
        out.append(entry)

    # Default puts what needs attention first: offline, then stale, then the
    # hottest box that is still up. A healthy fleet should be boring at the
    # bottom of the page.
    order = {"offline": 0, "stale": 1, "online": 2}
    if sort == "status":
        out.sort(key=lambda n: (order.get(n["status"], 3), -(n["host"].get("tempC") or 0)))
    elif sort == "name":
        out.sort(key=lambda n: (n["label"] or n["nodeId"]).lower())
    elif sort == "temp":
        out.sort(key=lambda n: -(n["host"].get("tempC") or 0))
    elif sort == "seen":
        out.sort(key=lambda n: n["lastSeenAgoSeconds"])
    return JSONResponse(out)


@app.get("/api/v1/fleet/summary")
def fleet_summary(authorization: str | None = Header(None)) -> JSONResponse:
    """Aggregates for the header tiles and the fleet-wide graph."""
    _check_basic_auth(authorization)
    now = time.time()
    with db() as conn:
        rows = conn.execute("SELECT last_seen_at, pihole_reachable, payload_json FROM nodes").fetchall()
        admin = _admin_rows(conn)
        # Fleet-wide hourly averages for the last 7 days.
        trend = conn.execute(
            "SELECT hour, AVG(cpu) cpu, AVG(temp) temp, AVG(mem_pct) mem, COUNT(DISTINCT node_id) nodes "
            "FROM samples_hourly WHERE hour >= ? GROUP BY hour ORDER BY hour",
            ((now - 7 * 86400) / 3600,),
        ).fetchall()
        # Raw samples cover the recent window that has not been rolled up yet.
        recent = conn.execute(
            "SELECT CAST(at/3600 AS INTEGER) hour, AVG(cpu) cpu, AVG(temp) temp, "
            "AVG(CASE WHEN mem_total>0 THEN 100.0*mem_used/mem_total END) mem, "
            "COUNT(DISTINCT node_id) nodes "
            "FROM samples WHERE at >= ? GROUP BY hour ORDER BY hour",
            (now - 7 * 86400,),
        ).fetchall()

    counts = {"online": 0, "stale": 0, "offline": 0}
    temps, filtering = [], 0
    for r in rows:
        counts[_status_for(now - r["last_seen_at"])] += 1
        if r["pihole_reachable"]:
            filtering += 1
        t = (json.loads(r["payload_json"]).get("host") or {}).get("tempC")
        if t is not None:
            temps.append(t)

    by_hour: dict[int, dict] = {}
    for src in (trend, recent):
        for r in src:
            by_hour[int(r["hour"])] = {
                "hour": int(r["hour"]),
                "cpu": r["cpu"],
                "temp": r["temp"],
                "mem": r["mem"],
                "nodes": r["nodes"],
            }

    tag_counts: dict[str, int] = {}
    billing_counts: dict[str, int] = {}
    for a in admin.values():
        for t in a["tags"]:
            tag_counts[t] = tag_counts.get(t, 0) + 1
        billing_counts[a["billingState"]] = billing_counts.get(a["billingState"], 0) + 1

    return JSONResponse(
        {
            "total": len(rows),
            "online": counts["online"],
            "stale": counts["stale"],
            "offline": counts["offline"],
            "filtering": filtering,
            "hottestC": max(temps) if temps else None,
            "trend": [by_hour[k] for k in sorted(by_hour)],
            "tags": tag_counts,
            "billing": billing_counts,
            # Stated so the UI never implies remote capability it lacks.
            "remoteControl": False,
        }
    )


@app.get("/api/v1/nodes/{node_id}")
def node_detail(node_id: str, authorization: str | None = Header(None)) -> JSONResponse:
    _check_basic_auth(authorization)
    now = time.time()
    with db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="no such node")
        admin = _admin_rows(conn).get(node_id, {})
        notes = [
            {"id": n["id"], "body": n["body"], "author": n["author"], "createdAt": n["created_at"]}
            for n in conn.execute(
                "SELECT * FROM notes WHERE node_id = ? ORDER BY created_at DESC LIMIT 200", (node_id,)
            ).fetchall()
        ]
        enrolled = conn.execute("SELECT issued_at FROM tokens WHERE node_id = ?", (node_id,)).fetchone()

    payload = json.loads(row["payload_json"])
    return JSONResponse(
        {
            "nodeId": node_id,
            "label": admin.get("label"),
            "customerRef": admin.get("customerRef"),
            "tags": admin.get("tags", []),
            "billingState": admin.get("billingState", "unknown"),
            "agentVersion": row["agent_version"],
            "status": _status_for(now - row["last_seen_at"]),
            "lastSeenAgoSeconds": round(now - row["last_seen_at"]),
            "firstSeenAt": row["first_seen_at"],
            "uptimeSeconds": row["uptime_seconds"],
            "piholeReachable": bool(row["pihole_reachable"]),
            "host": payload.get("host", {}),
            "modules": payload.get("modules", []),
            "counters": payload.get("counters", {}),
            "notes": notes,
            "tokenIssuedAt": enrolled["issued_at"] if enrolled else None,
        }
    )


@app.get("/api/v1/nodes/{node_id}/history")
def node_history(node_id: str, window: str = "24h", authorization: str | None = Header(None)) -> JSONResponse:
    """Trend for one box.

    Reads raw samples inside the raw window and hourly averages beyond it, so
    a 24h view is detailed and a 90d view is cheap. The response says which
    resolution it used — a chart that silently changes meaning is worse than
    one that says 'hourly average'.
    """
    _check_basic_auth(authorization)
    now = time.time()
    spans = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400}
    span = spans.get(window, 86400)
    since = now - span
    use_raw = span <= RAW_RETENTION_DAYS * 86400

    with db() as conn:
        if use_raw:
            rows = conn.execute(
                "SELECT at, cpu, disk, temp, "
                "CASE WHEN mem_total>0 THEN 100.0*mem_used/mem_total END mem, pihole_ok "
                "FROM samples WHERE node_id = ? AND at >= ? ORDER BY at",
                (node_id, since),
            ).fetchall()
            points = [
                {"t": r["at"], "cpu": r["cpu"], "mem": r["mem"], "disk": r["disk"],
                 "temp": r["temp"], "piholeOk": r["pihole_ok"]}
                for r in rows
            ]
            resolution = "5 minute samples"
        else:
            rows = conn.execute(
                "SELECT hour, cpu, mem_pct mem, disk, temp, pihole_ok_pct "
                "FROM samples_hourly WHERE node_id = ? AND hour >= ? ORDER BY hour",
                (node_id, since / 3600),
            ).fetchall()
            points = [
                {"t": r["hour"] * 3600, "cpu": r["cpu"], "mem": r["mem"], "disk": r["disk"],
                 "temp": r["temp"], "piholeOk": (r["pihole_ok_pct"] or 0) / 100.0}
                for r in rows
            ]
            resolution = "hourly averages"

    return JSONResponse({"window": window, "resolution": resolution, "points": points})


# ------------------------------------------------------------------- admin


@app.put("/api/v1/nodes/{node_id}/admin")
def set_admin(node_id: str, body: dict = Body(...), authorization: str | None = Header(None)) -> JSONResponse:
    """Your own record of a box. Never sent to the node."""
    _check_basic_auth(authorization)
    label = (body.get("label") or "").strip()[:64] or None
    ref = (body.get("customerRef") or "").strip()[:64] or None
    tags = body.get("tags") or []
    if not isinstance(tags, list):
        raise HTTPException(status_code=400, detail="tags must be a list")
    tags = sorted({str(t).strip()[:24] for t in tags if str(t).strip()})[:20]
    billing = body.get("billingState") or "unknown"
    if billing not in BILLING_STATES:
        raise HTTPException(status_code=400, detail=f"billingState must be one of {BILLING_STATES}")

    with _write_lock, db() as conn:
        conn.execute(
            "INSERT INTO node_admin (node_id, label, customer_ref, tags, billing_state, updated_at) "
            "VALUES (?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET "
            "label=excluded.label, customer_ref=excluded.customer_ref, tags=excluded.tags, "
            "billing_state=excluded.billing_state, updated_at=excluded.updated_at",
            (node_id, label, ref, json.dumps(tags), billing, time.time()),
        )
    return JSONResponse({"ok": True, "label": label, "customerRef": ref, "tags": tags, "billingState": billing})


@app.post("/api/v1/nodes/{node_id}/notes", status_code=201)
def add_note(node_id: str, body: dict = Body(...), authorization: str | None = Header(None)) -> JSONResponse:
    """Append to the support log. Append-only on purpose: an editable support
    history is not a history."""
    _check_basic_auth(authorization)
    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="a note needs a body")
    with _write_lock, db() as conn:
        cur = conn.execute(
            "INSERT INTO notes (node_id, body, author, created_at) VALUES (?,?,?,?)",
            (node_id, text[:4000], (body.get("author") or ADMIN_USER)[:48], time.time()),
        )
        note_id = cur.lastrowid
    return JSONResponse({"id": note_id, "ok": True})


@app.get("/")
def dashboard(authorization: str | None = Header(None)) -> FileResponse:
    _check_basic_auth(authorization)
    return FileResponse(STATIC_DIR / "index.html")
