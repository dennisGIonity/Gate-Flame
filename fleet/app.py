"""
Gate^Flame Fleet Dashboard — receives the health check-in every node already
sends (node-agent/gateflame/health_feed.py) and turns it into something you
can run a support business from at a few hundred boxes.

Contract (matches health_feed.py and docs/PAIRING-AND-TELEMETRY.md §4.4):

    POST {GATEFLAME_FEED_URL}/{node_id}/health      (FEED_URL ends in /api/v1/nodes)
    Authorization: Bearer <token>
    {
      "nodeId": "...", "agentVersion": "...", "sentAt": "...",
      "uptimeSeconds": 0,
      "host": {cpuPercent, memUsedMB, memTotalMB, diskUsedPercent, tempC, throttleFlags},
      "modules": [{id, status, gap}],
      "counters": {errors24h, restarts24h, wanBudgetUsedPercent},
      "piholeReachable": true,
      "shield": {configured, enabledCount, devices: [{mac, label, region, enabled, provider}]} | null
    }

SCOPE, DELIBERATELY: health fields, plus the per-device Shield rows the owner
configured (a product decision, 2026-08-31 — see health_feed.py). It never asks
for and has nowhere to put domains, query logs, client IPs or DPI output.

HISTORY. `samples` keeps every check-in for RAW_RETENTION_DAYS; a rollup folds
older whole hours into `samples_hourly`, kept HOURLY_RETENTION_DAYS.

PER-NODE TOKENS. The shared token (GATEFLAME_FLEET_TOKEN) only ENROLS a node
that has never activated its own token; after that only its own token works.
Support can FORGET a node's token (DELETE /api/v1/nodes/{id}/token) to re-admit
a re-imaged box: the row goes, the old token dies with it, and the node's next
check-in with the shared token enrols it again. The tokens table is the trust
store - back fleet.db up (tools\\fleet-backup.ps1).

REMOTE CONTROL is deliberately absent: nodes post outward and nothing reaches
back. The UI says so rather than offering a button that would do nothing.

AUTH
  - Node -> server: per-node bearer token (above).
  - Browser -> server: login page -> signed, HttpOnly, SameSite=Strict session
    cookie (Secure over HTTPS). Page loads without a session REDIRECT to the
    login page; they never answer 401, so a front door that bans on 401s (the
    Ionity Local Drive intrusion guard) is not tripped by an expired session.
  - Scripts (tools\\fleet-verify.ps1): HTTP Basic still works on every API route.
  - Failed logins / Basic attempts are rate-limited per client address.

PATH PREFIX. The same process serves http://host:8091/ and, behind a reverse
proxy, https://ionity.local/gateflame/. A TRUSTED proxy (GATEFLAME_FLEET_TRUSTED_
PROXIES, default loopback only) may send X-Forwarded-Prefix / -Proto / -For.
The page itself uses only relative URLs plus a server-rendered <base href>, so
every link, API call and redirect follows the prefix.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

from fastapi import Body, FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

DB_PATH = os.environ.get("GATEFLAME_FLEET_DB", "./fleet.db")
ENROL_TOKEN = os.environ.get("GATEFLAME_FLEET_TOKEN", "")
ADMIN_USER = os.environ.get("GATEFLAME_FLEET_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("GATEFLAME_FLEET_ADMIN_PASSWORD", "")
STATIC_DIR = Path(__file__).parent / "static"

# A node is offline once it has missed roughly two report cycles. The node's
# own default is 900s; the local drop-in uses 300s. 1800 covers both.
STALE_AFTER_SECONDS = int(os.environ.get("GATEFLAME_FLEET_STALE_SECONDS", "1800"))
RAW_RETENTION_DAYS = int(os.environ.get("GATEFLAME_FLEET_RAW_DAYS", "7"))
HOURLY_RETENTION_DAYS = int(os.environ.get("GATEFLAME_FLEET_HOURLY_DAYS", "90"))

# Optional fixed prefix when no proxy header is available (e.g. a proxy that
# forwards the FULL path /gateflame/... unchanged). Normally leave empty.
ROOT_PATH = os.environ.get("GATEFLAME_FLEET_ROOT_PATH", "").rstrip("/")
TRUSTED_PROXIES = os.environ.get("GATEFLAME_FLEET_TRUSTED_PROXIES", "127.0.0.1,::1")
COOKIE_SECURE = os.environ.get("GATEFLAME_FLEET_COOKIE_SECURE", "auto").lower()  # auto|always|never
SESSION_HOURS = float(os.environ.get("GATEFLAME_FLEET_SESSION_HOURS", "12"))
LOGIN_MAX_FAILURES = int(os.environ.get("GATEFLAME_FLEET_LOGIN_MAX_FAILURES", "8"))
LOGIN_WINDOW_SECONDS = int(os.environ.get("GATEFLAME_FLEET_LOGIN_WINDOW_SECONDS", "900"))

# §4.3 caps a check-in at 8 KB; Shield rows can push past that, so allow 8x
# headroom and refuse anything bigger rather than parse it.
MAX_INGEST_BYTES = 64 * 1024

BILLING_STATES = ("active", "trial", "suspended", "unpaid", "cancelled", "unknown")
COOKIE_NAME = "gf_fleet_session"
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "gateflame-fleet"

_write_lock = threading.Lock()
_maint_stop = threading.Event()


# ------------------------------------------------------------------- storage


@contextmanager
def db():
    # journal_mode=WAL is persistent in the file, so it is set once in
    # init_db rather than on every connection (it is a write, and it used to
    # run on every single request).
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")  # safe under WAL, far fewer fsyncs
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
-- activated_at: when the node first posted with its OWN token. Until then the
-- shared token still works for it (older agents cannot store a token); after
-- that the shared token can never be used to impersonate it again.
CREATE TABLE IF NOT EXISTS tokens (
    node_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    issued_at REAL NOT NULL,
    activated_at REAL
);

CREATE TABLE IF NOT EXISTS samples (
    node_id TEXT NOT NULL,
    at REAL NOT NULL,
    cpu REAL, mem_used REAL, mem_total REAL, disk REAL, temp REAL,
    pihole_ok INTEGER,
    modules_running INTEGER, modules_total INTEGER,
    PRIMARY KEY (node_id, at)
);
CREATE INDEX IF NOT EXISTS idx_samples_at ON samples (at);

CREATE TABLE IF NOT EXISTS samples_hourly (
    node_id TEXT NOT NULL,
    hour INTEGER NOT NULL,
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
    label TEXT,
    customer_ref TEXT,
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

-- Server-side settings that must survive a move to another host with the
-- database file (e.g. the session-signing key).
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def init_db() -> None:
    with db() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
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
        # CREATE TABLE IF NOT EXISTS does NOT add a column to an existing table.
        if cols and "activated_at" not in cols:
            conn.execute("ALTER TABLE tokens ADD COLUMN activated_at REAL")
        ncols = {r[1] for r in conn.execute("PRAGMA table_info(nodes)").fetchall()}
        if ncols and "first_seen_at" not in ncols:
            conn.execute("ALTER TABLE nodes ADD COLUMN first_seen_at REAL")
            conn.execute("UPDATE nodes SET first_seen_at = last_seen_at WHERE first_seen_at IS NULL")
    _session_key.cache_clear()


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ------------------------------------------------------------------ lifespan


def _check_config() -> None:
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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _check_config()
    init_db()
    _page_cache.clear()
    _maint_stop.clear()
    t = threading.Thread(target=_maintenance_loop, daemon=True, name="fleet-maintenance")
    t.start()
    try:
        yield
    finally:
        _maint_stop.set()


app = FastAPI(title="Gate^Flame Fleet Dashboard", lifespan=lifespan, docs_url=None,
              redoc_url=None, openapi_url=None)


# ---------------------------------------------------------------- retention


def _rollup_and_prune() -> None:
    """Fold whole hours older than the raw window into hourly averages, then
    drop what is past retention. A moving mid-hour cutoff used to fold a
    PARTIAL hour and then delete the rest of it — so only whole hours strictly
    below the cutoff are folded, and the same cutoff drives the delete."""
    now = time.time()
    raw_cutoff = float(int((now - RAW_RETENTION_DAYS * 86400) // 3600) * 3600)
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
    while not _maint_stop.is_set():
        try:
            _rollup_and_prune()
        except Exception:  # noqa: BLE001 — maintenance must never kill ingest
            pass
        _maint_stop.wait(3600)


# ------------------------------------------------------------ proxy / prefix

_PREFIX_RE = re.compile(r"^/[A-Za-z0-9._~-][A-Za-z0-9._~/-]*$")


def _parse_trusted(spec: str) -> list:
    nets = []
    for part in (p.strip() for p in spec.split(",")):
        if not part:
            continue
        if part == "*":
            return ["*"]
        try:
            nets.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            continue
    return nets


_TRUSTED = _parse_trusted(TRUSTED_PROXIES)


def _is_trusted_peer(host: str | None) -> bool:
    if not host:
        return False
    if _TRUSTED == ["*"]:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(ip in n for n in _TRUSTED)


def _clean_prefix(value: str) -> str:
    """Only a plain absolute path is accepted as a prefix. Anything else —
    `//evil.example`, a scheme, a query — is dropped, because the prefix ends
    up in redirects and in <base href>, and a crafted one would be an open
    redirect."""
    value = (value or "").strip().rstrip("/")
    if not value:
        return ""
    return value if _PREFIX_RE.match(value) and "//" not in value and ".." not in value else ""


class ProxyHeadersMiddleware:
    """Pure ASGI (no BaseHTTPMiddleware) so request bodies still stream.

    From a trusted peer only: X-Forwarded-Prefix -> root_path, X-Forwarded-Proto
    -> scheme, rightmost X-Forwarded-For -> client address. From anyone else the
    headers are ignored — the fleet binds 0.0.0.0 for the nodes, so a LAN client
    must not be able to claim to be a proxy.
    """

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            peer = (scope.get("client") or (None, None))[0]
            prefix = ROOT_PATH
            if _is_trusted_peer(peer):
                headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
                fwd_prefix = _clean_prefix(headers.get("x-forwarded-prefix", ""))
                if fwd_prefix:
                    prefix = fwd_prefix
                proto = headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
                if proto in ("http", "https"):
                    scope["scheme"] = proto
                xff = headers.get("x-forwarded-for", "")
                if xff:
                    real = xff.split(",")[-1].strip()
                    if real:
                        scope["client"] = (real, 0)
            if prefix:
                path = scope.get("path", "")
                # ASGI: `path` INCLUDES root_path. A proxy that strips the prefix
                # sends /x; one that does not sends /gateflame/x. Accept both.
                if not (path == prefix or path.startswith(prefix + "/")):
                    scope["path"] = prefix + path
                    raw = scope.get("raw_path")
                    if raw is not None:
                        scope["raw_path"] = prefix.encode() + raw
                scope["root_path"] = prefix
        await self.inner(scope, receive, send)


SECURITY_HEADERS = {
    # Every asset is self-hosted (fonts included — this runs on an offline
    # server), so the policy can be strict: no inline script, no inline style,
    # no third-party origin at all.
    "content-security-policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; "
        "form-action 'self'; frame-ancestors 'none'"
    ),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
}


class SecurityHeadersMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.inner(scope, receive, send)
        is_https = scope.get("scheme") == "https"
        path = scope.get("path", "")
        root = scope.get("root_path", "")
        is_asset = path.startswith(root + "/assets/")

        async def _send(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                for k, v in SECURITY_HEADERS.items():
                    if k.encode() not in present:
                        headers.append((k.encode(), v.encode()))
                if is_https:
                    headers.append((b"strict-transport-security", b"max-age=31536000"))
                if not is_asset and b"cache-control" not in present:
                    # Health data and pages behind a login must never sit in a
                    # shared or back-button cache.
                    headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        await self.inner(scope, receive, _send)


app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(ProxyHeadersMiddleware)  # outermost: runs first


def _root(request: Request) -> str:
    return request.scope.get("root_path", "") or ""


def _client_ip(request: Request) -> str:
    return (request.client.host if request.client else "") or "unknown"


# --------------------------------------------------------------- rate limit


class _LoginLimiter:
    """Failures per client address inside a sliding window. At the limit the
    address is refused (429) until its oldest failure ages out. A success
    clears the record. In memory on purpose: a restart forgiving a lockout is
    fine; a lockout that outlives the process is a support call."""

    def __init__(self):
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, ip: str, now: float) -> list[float]:
        lst = [t for t in self._fails.get(ip, []) if now - t < LOGIN_WINDOW_SECONDS]
        if lst:
            self._fails[ip] = lst
        else:
            self._fails.pop(ip, None)
        return lst

    def retry_after(self, ip: str) -> int:
        """Seconds until this address may try again; 0 if it may now."""
        now = time.time()
        with self._lock:
            lst = self._prune(ip, now)
            if len(lst) < LOGIN_MAX_FAILURES:
                return 0
            return max(1, int(LOGIN_WINDOW_SECONDS - (now - lst[0])) + 1)

    def fail(self, ip: str) -> None:
        now = time.time()
        with self._lock:
            lst = self._prune(ip, now)
            lst.append(now)
            self._fails[ip] = lst
            if len(self._fails) > 10000:  # bound memory under a spray
                for k in list(self._fails)[:5000]:
                    self._fails.pop(k, None)

    def success(self, ip: str) -> None:
        with self._lock:
            self._fails.pop(ip, None)

    def reset(self) -> None:
        with self._lock:
            self._fails.clear()


login_limiter = _LoginLimiter()


# ------------------------------------------------------------------- session


class _KeyCache:
    def __init__(self):
        self.value: bytes | None = None

    def cache_clear(self):
        self.value = None


_session_key = _KeyCache()


def _signing_key() -> bytes:
    """HMAC key for session cookies.

    GATEFLAME_FLEET_SESSION_SECRET if set; otherwise a random key minted once
    and kept in the database, so sessions survive a restart AND a move to a
    new server with fleet.db. The admin credentials are folded in, so changing
    the password signs every existing session out.
    """
    if _session_key.value is None:
        secret = os.environ.get("GATEFLAME_FLEET_SESSION_SECRET", "")
        if not secret:
            with _write_lock, db() as conn:
                row = conn.execute("SELECT value FROM meta WHERE key='session_secret'").fetchone()
                if row:
                    secret = row["value"]
                else:
                    secret = secrets.token_urlsafe(48)
                    conn.execute("INSERT INTO meta (key, value) VALUES ('session_secret', ?)", (secret,))
        cred = hashlib.sha256(f"{ADMIN_USER}\0{ADMIN_PASSWORD}".encode()).digest()
        _session_key.value = hashlib.sha256(secret.encode() + cred).digest()
    return _session_key.value


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_session(user: str, now: float | None = None) -> str:
    now = now or time.time()
    body = _b64(json.dumps({"u": user, "iat": int(now), "exp": int(now + SESSION_HOURS * 3600)},
                           separators=(",", ":")).encode())
    sig = _b64(hmac.new(_signing_key(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_session(value: str | None) -> str | None:
    """The user name if the cookie is genuine and unexpired, else None."""
    if not value or value.count(".") != 1:
        return None
    body, sig = value.split(".")
    want = _b64(hmac.new(_signing_key(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, want):
        return None
    try:
        data = json.loads(_unb64(body))
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict) or data.get("exp", 0) < time.time():
        return None
    user = data.get("u")
    return user if isinstance(user, str) and hmac.compare_digest(user, ADMIN_USER) else None


def _cookie_secure(request: Request) -> bool:
    if COOKIE_SECURE == "always":
        return True
    if COOKIE_SECURE == "never":
        return False
    return request.url.scheme == "https"


def _set_session_cookie(resp: Response, request: Request, value: str) -> None:
    resp.set_cookie(
        COOKIE_NAME, value, max_age=int(SESSION_HOURS * 3600), path=(_root(request) or "") + "/",
        httponly=True, samesite="strict", secure=_cookie_secure(request),
    )


# -------------------------------------------------------------------- auth


def _basic_ok(authorization: str) -> str | None:
    try:
        user, _, password = base64.b64decode(authorization[6:], validate=False).decode("utf-8").partition(":")
    except Exception:  # noqa: BLE001
        return None
    ok_user = secrets.compare_digest(user.encode(), ADMIN_USER.encode())
    ok_pass = secrets.compare_digest(password.encode(), ADMIN_PASSWORD.encode())
    return user if (ok_user and ok_pass) else None


def _require_admin(request: Request) -> str:
    """Session cookie (browser) or HTTP Basic (scripts). Returns the user.

    A 401 carries `WWW-Authenticate: Basic` ONLY when the caller tried Basic:
    sending the challenge to a browser whose session expired would pop the
    browser's own credentials dialog in the middle of a fetch().
    """
    authorization = request.headers.get("authorization") or ""
    if authorization.startswith("Basic "):
        ip = _client_ip(request)
        wait = login_limiter.retry_after(ip)
        if wait:
            raise HTTPException(status_code=429, detail="too many failed attempts",
                                headers={"Retry-After": str(wait)})
        user = _basic_ok(authorization)
        if not user:
            login_limiter.fail(ip)
            raise HTTPException(status_code=401, detail="bad credentials", headers={"WWW-Authenticate": "Basic"})
        return user

    user = read_session(request.cookies.get(COOKIE_NAME))
    if not user:
        raise HTTPException(status_code=401, detail="login required")
    # CSRF: SameSite=Strict already keeps the cookie off cross-site requests;
    # on top of that a state-changing cookie call must carry a custom header,
    # which a cross-site form cannot set without a CORS preflight we never grant.
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise HTTPException(status_code=403, detail="missing X-Requested-With header")
    return user


def _authorise_node(node_id: str, authorization: str | None) -> str | None:
    """Return a newly issued token if this call enrolled the node, else None.

    Accepted credentials, in order:
      1. The node's OWN token. Always valid, and using it ACTIVATES the node.
      2. The shared enrolment token — but only while the node has not yet
         activated (never seen, or an agent too old to store a token).
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
                    conn.execute("UPDATE tokens SET activated_at = ? WHERE node_id = ?", (time.time(), node_id))
            return None
        if row["activated_at"] is None and secrets.compare_digest(presented.encode(), ENROL_TOKEN.encode()):
            reissued = secrets.token_urlsafe(32)
            with _write_lock, db() as conn:
                changed = conn.execute(
                    "UPDATE tokens SET token_hash = ?, issued_at = ? WHERE node_id = ? AND activated_at IS NULL",
                    (_hash(reissued), time.time(), node_id),
                ).rowcount
            # The row was activated or forgotten between the read above and this
            # write. A 201 would hand the box a token this server does not hold -
            # a verdict it cannot back. Refuse this one check-in; the next sorts it out.
            if changed != 1:
                raise HTTPException(status_code=409, detail="this node's token changed during enrolment - retry")
            return reissued
        raise HTTPException(status_code=401, detail="bad token for this node")

    if not secrets.compare_digest(presented.encode(), ENROL_TOKEN.encode()):
        raise HTTPException(status_code=401, detail="bad or missing token")

    issued = secrets.token_urlsafe(32)
    with _write_lock, db() as conn:
        changed = conn.execute(
            "INSERT INTO tokens (node_id, token_hash, issued_at, activated_at) VALUES (?, ?, ?, NULL) "
            "ON CONFLICT(node_id) DO NOTHING",
            (node_id, _hash(issued), time.time()),
        ).rowcount
    if changed != 1:  # another enrolment for this id won the race; same reasoning as above
        raise HTTPException(status_code=409, detail="this node enrolled concurrently - retry")
    return issued


# ------------------------------------------------------------------ ingest


@app.get("/healthz")
def healthz() -> dict:
    """Liveness. Unauthenticated on purpose — says nothing about any node."""
    return {"ok": True}


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


@app.post("/api/v1/nodes/{node_id}/health", status_code=204)
async def ingest_health(node_id: str, request: Request) -> Response:
    issued = _authorise_node(node_id, request.headers.get("authorization"))

    raw = await request.body()
    if len(raw) > MAX_INGEST_BYTES:
        raise HTTPException(status_code=413, detail="check-in too large")
    try:
        payload: Any = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="body is not valid JSON")
    # A JSON array or string used to reach payload.get() and 500.
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    if payload.get("nodeId") != node_id:
        raise HTTPException(status_code=400, detail="nodeId in body does not match nodeId in path")

    host = payload.get("host") if isinstance(payload.get("host"), dict) else {}
    mods = [m for m in (payload.get("modules") or []) if isinstance(m, dict)] \
        if isinstance(payload.get("modules"), list) else []
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
                _num(payload.get("uptimeSeconds")),
                1 if payload.get("piholeReachable") else 0,
                # The body already IS JSON and was just validated — store it as
                # received instead of re-serialising.
                raw.decode("utf-8", errors="replace"),
            ),
        )
        conn.execute(
            "INSERT OR REPLACE INTO samples "
            "(node_id, at, cpu, mem_used, mem_total, disk, temp, pihole_ok, modules_running, modules_total) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                node_id, now,
                _num(host.get("cpuPercent")), _num(host.get("memUsedMB")), _num(host.get("memTotalMB")),
                _num(host.get("diskUsedPercent")), _num(host.get("tempC")),
                1 if payload.get("piholeReachable") else 0,
                sum(1 for m in mods if m.get("status") == "running"),
                len(mods),
            ),
        )

    if issued:
        return JSONResponse(status_code=201, content={"nodeToken": issued})
    return Response(status_code=204)


# -------------------------------------------------------------------- reads


def _status_for(age: float) -> str:
    if age < STALE_AFTER_SECONDS:
        return "online"
    if age < STALE_AFTER_SECONDS * 4:
        return "stale"
    return "offline"


# Parsed-payload cache. The list, the summary and the 15-second auto-refresh
# all used to json.loads every node's payload on every request; at 400 boxes
# that is 800 parses every 15 s for data that changes every 5-15 min. Keyed
# on last_seen_at, so a new check-in invalidates its entry by construction.
_payload_cache: dict[str, tuple[float, dict]] = {}
_payload_lock = threading.Lock()


def _payload(row) -> dict:
    key, seen = row["node_id"], row["last_seen_at"]
    with _payload_lock:
        hit = _payload_cache.get(key)
        if hit and hit[0] == seen:
            return hit[1]
    try:
        parsed = json.loads(row["payload_json"])
    except Exception:  # noqa: BLE001
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    with _payload_lock:
        _payload_cache[key] = (seen, parsed)
    return parsed


# ------------------------------------------------------- support assistant
#
# A reader of what the node ALREADY reported, turned into something a support
# person can act on. It is NOT the mobile app's IoniBot (which probes the box
# live over the LAN — a support console three provinces away cannot). Every
# finding is traceable to a field in the last check-in; `evidence` names it.

_MODULE_HELP: dict[str, dict] = {
    "module_dns_filter": {
        "name": "DNS filtering",
        "customer": "Ads and trackers are not being blocked for this household.",
        "check": "This is the product. Treat a stopped or degraded filter as urgent.",
    },
    "module_telemetry": {
        "name": "Telemetry",
        "customer": "Their app and wall console will show gaps in the numbers.",
        "check": "Protection itself is unaffected - do not alarm the customer about blocking.",
    },
    "module_passive_discovery": {
        "name": "Device discovery",
        "customer": "Their device list will be empty or stale, so Shield has nothing to pick from.",
        "check": "Usually a missing iproute2 or a permissions change on the box.",
    },
    "module_wan_audit": {
        "name": "WAN audit",
        "customer": "No effect they can see. Data-cap reporting is unavailable.",
        "check": "Needs GATEFLAME_WAN_INTERFACES set. Deliberately not guessed - guessing "
                 "wrong bills LAN traffic against the customer's cap.",
    },
    "module_firewall_bounce": {
        "name": "Firewall bounce",
        "customer": "None. Premium-tier only.",
        "check": "Expected to be stopped on a standard box. Not a fault.",
    },
    "module_dpi_flow": {
        "name": "DPI flow",
        "customer": "None. Premium-tier only.",
        "check": "Expected to be stopped on a standard box. Not a fault.",
    },
    "module_zero_trust": {
        "name": "Zero trust",
        "customer": "None. Premium-tier only.",
        "check": "Expected to be stopped on a standard box. Not a fault.",
    },
}

_PREMIUM_ONLY = {"module_firewall_bounce", "module_dpi_flow", "module_zero_trust"}


def _support_findings(detail: dict) -> list[dict]:
    """Read one node's last check-in and say what is worth a human's attention.
    Ordered worst-first."""
    findings: list[dict] = []
    status = detail.get("status")
    age = detail.get("lastSeenAgoSeconds")

    if status != "online":
        findings.append({
            "severity": "critical" if status == "offline" else "warning",
            "title": f"Box has not checked in for {_human_age(age)}",
            "customer": "Their protection may still be working - this box reports OUTWARD, "
                        "so silence here does not prove the household is unprotected.",
            "check": "Power, internet, or the agent service. Ask before assuming an outage: "
                     "load shedding explains most of these.",
            "evidence": f"lastSeenAgoSeconds={age}",
        })

    if not detail.get("piholeReachable", True):
        findings.append({
            "severity": "critical",
            "title": "The box cannot reach its own filter",
            "customer": "Filtering is likely down for the whole household right now.",
            "check": "Pi-hole container or service on the box. This is the product not working.",
            "evidence": "piholeReachable=false",
        })

    for m in detail.get("modules") or []:
        if not isinstance(m, dict):
            continue
        mid = m.get("id", "")
        mstatus = m.get("status")
        if mstatus == "running":
            continue
        if mid in _PREMIUM_ONLY and mstatus == "stopped":
            continue
        help_ = _MODULE_HELP.get(mid, {})
        findings.append({
            "severity": "critical" if mid == "module_dns_filter" else "warning",
            "title": f"{help_.get('name', mid)} is {mstatus}",
            "customer": help_.get("customer", "Effect on the customer is not documented for this module."),
            "check": m.get("gap") or help_.get("check", "No further detail was reported."),
            "evidence": f"modules[{mid}].status={mstatus}",
        })

    host = detail.get("host") or {}
    disk = _num(host.get("diskUsedPercent"))
    if disk is not None and disk >= 85:
        findings.append({
            "severity": "critical" if disk >= 95 else "warning",
            "title": f"Disk {disk:.0f}% full",
            "customer": "Nothing yet. A full disk will stop blocklist updates and logging.",
            "check": "Usually log growth. Safe to clear journald first.",
            "evidence": f"host.diskUsedPercent={disk}",
        })
    temp = _num(host.get("tempC"))
    if temp is not None and temp >= 75:
        findings.append({
            "severity": "warning",
            "title": f"Running hot at {temp:.0f}C",
            "customer": "They may notice slowdowns as the board throttles.",
            "check": "Ventilation or enclosure. Check host.throttleFlags for whether it "
                     "has actually throttled yet.",
            "evidence": f"host.tempC={temp}",
        })

    if detail.get("shield") is None and detail.get("shieldReported"):
        findings.append({
            "severity": "warning",
            "title": "The box could not read its own Shield state",
            "customer": "Their VPN picker may be empty even though Shield is installed.",
            "check": "Not the same as Shield being unconfigured - the box tried and failed.",
            "evidence": "shield=null",
        })

    order = {"critical": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda f: order.get(f["severity"], 3))
    return findings


def _human_age(seconds) -> str:
    if not isinstance(seconds, (int, float)):
        return "an unknown time"
    s = int(seconds)
    if s < 90:
        return f"{s}s"
    if s < 5400:
        return f"{s // 60} min"
    if s < 172800:
        return f"{s // 3600} hours"
    return f"{s // 86400} days"


def _admin_rows(conn) -> dict[str, dict]:
    out = {}
    for r in conn.execute("SELECT node_id, label, customer_ref, tags, billing_state FROM node_admin").fetchall():
        try:
            tags = json.loads(r["tags"] or "[]")
        except Exception:  # noqa: BLE001
            tags = []
        out[r["node_id"]] = {
            "label": r["label"], "customerRef": r["customer_ref"],
            "tags": tags if isinstance(tags, list) else [], "billingState": r["billing_state"],
        }
    return out


def _dict(v) -> dict:
    return v if isinstance(v, dict) else {}


def _list(v) -> list:
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


@app.get("/api/v1/nodes")
def list_nodes(request: Request, q: str | None = None, status: str | None = None, tag: str | None = None,
               billing: str | None = None, sort: str = "status") -> JSONResponse:
    """The fleet list. Filtering happens here, not in the browser."""
    _require_admin(request)
    now = time.time()
    out = []
    with db() as conn:
        admin = _admin_rows(conn)
        rows = conn.execute(
            "SELECT node_id, agent_version, first_seen_at, last_seen_at, sent_at, uptime_seconds, "
            "pihole_reachable, payload_json FROM nodes"
        ).fetchall()

    ql = (q or "").strip().lower()
    for row in rows:
        payload = _payload(row)
        age = now - row["last_seen_at"]
        st = _status_for(age)
        if status and st != status:
            continue
        a = admin.get(row["node_id"], {})
        tags = a.get("tags", [])
        billing_state = a.get("billingState", "unknown")
        if tag and tag not in tags:
            continue
        if billing and billing_state != billing:
            continue
        if ql:
            hay = " ".join(str(x) for x in (row["node_id"], a.get("label"), a.get("customerRef"), " ".join(tags))
                           if x).lower()
            if ql not in hay:
                continue
        mods = _list(payload.get("modules"))
        out.append({
            "nodeId": row["node_id"],
            "label": a.get("label"),
            "customerRef": a.get("customerRef"),
            "tags": tags,
            "billingState": billing_state,
            "agentVersion": row["agent_version"],
            "lastSeenAgoSeconds": round(age),
            "firstSeenAt": row["first_seen_at"],
            "status": st,
            "sentAt": row["sent_at"],
            "uptimeSeconds": row["uptime_seconds"],
            "piholeReachable": bool(row["pihole_reachable"]),
            "host": _dict(payload.get("host")),
            "modules": mods,
            "modulesRunning": sum(1 for m in mods if m.get("status") == "running"),
            "counters": _dict(payload.get("counters")),
        })

    order = {"offline": 0, "stale": 1, "online": 2}

    def _temp(n):
        return _num(n["host"].get("tempC")) or 0

    if sort == "status":
        out.sort(key=lambda n: (order.get(n["status"], 3), -_temp(n)))
    elif sort == "name":
        out.sort(key=lambda n: (n["label"] or n["nodeId"]).lower())
    elif sort == "temp":
        out.sort(key=lambda n: -_temp(n))
    elif sort == "seen":
        out.sort(key=lambda n: n["lastSeenAgoSeconds"])
    return JSONResponse(out)


@app.get("/api/v1/fleet/summary")
def fleet_summary(request: Request) -> JSONResponse:
    """Aggregates for the header tiles and the fleet-wide graph."""
    _require_admin(request)
    now = time.time()
    with db() as conn:
        rows = conn.execute("SELECT node_id, last_seen_at, pihole_reachable, payload_json FROM nodes").fetchall()
        admin = _admin_rows(conn)
        trend = conn.execute(
            "SELECT hour, AVG(cpu) cpu, AVG(temp) temp, AVG(mem_pct) mem, COUNT(DISTINCT node_id) nodes "
            "FROM samples_hourly WHERE hour >= ? GROUP BY hour ORDER BY hour",
            ((now - 7 * 86400) / 3600,),
        ).fetchall()
        recent = conn.execute(
            "SELECT CAST(at/3600 AS INTEGER) hour, AVG(cpu) cpu, AVG(temp) temp, "
            "AVG(CASE WHEN mem_total>0 THEN 100.0*mem_used/mem_total END) mem, "
            "COUNT(DISTINCT node_id) nodes "
            "FROM samples WHERE at >= ? GROUP BY hour ORDER BY hour",
            (now - 7 * 86400,),
        ).fetchall()

    counts = {"online": 0, "stale": 0, "offline": 0}
    temps, filtering = [], 0
    versions: dict[str, int] = {}
    for r in rows:
        counts[_status_for(now - r["last_seen_at"])] += 1
        if r["pihole_reachable"]:
            filtering += 1
        p = _payload(r)
        t = _num(_dict(p.get("host")).get("tempC"))
        if t is not None:
            temps.append(t)
        v = p.get("agentVersion") or "unknown"
        versions[str(v)] = versions.get(str(v), 0) + 1

    by_hour: dict[int, dict] = {}
    for src in (trend, recent):
        for r in src:
            by_hour[int(r["hour"])] = {"hour": int(r["hour"]), "cpu": r["cpu"], "temp": r["temp"],
                                       "mem": r["mem"], "nodes": r["nodes"]}

    tag_counts: dict[str, int] = {}
    billing_counts: dict[str, int] = {}
    for a in admin.values():
        for t in a["tags"]:
            tag_counts[t] = tag_counts.get(t, 0) + 1
        billing_counts[a["billingState"]] = billing_counts.get(a["billingState"], 0) + 1

    return JSONResponse({
        "total": len(rows),
        "online": counts["online"],
        "stale": counts["stale"],
        "offline": counts["offline"],
        "filtering": filtering,
        "hottestC": max(temps) if temps else None,
        "trend": [by_hour[k] for k in sorted(by_hour)],
        "tags": tag_counts,
        "billing": billing_counts,
        "agentVersions": versions,
        "staleAfterSeconds": STALE_AFTER_SECONDS,
        "remoteControl": False,
    })


@app.get("/api/v1/nodes/{node_id}")
def node_detail(node_id: str, request: Request) -> JSONResponse:
    _require_admin(request)
    now = time.time()
    with db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="no such node")
        a = conn.execute("SELECT label, customer_ref, tags, billing_state FROM node_admin WHERE node_id = ?",
                         (node_id,)).fetchone()
        notes = [
            {"id": n["id"], "body": n["body"], "author": n["author"], "createdAt": n["created_at"]}
            for n in conn.execute(
                "SELECT id, body, author, created_at FROM notes WHERE node_id = ? "
                "ORDER BY created_at DESC LIMIT 200", (node_id,)
            ).fetchall()
        ]
        enrolled = conn.execute("SELECT issued_at, activated_at FROM tokens WHERE node_id = ?",
                                (node_id,)).fetchone()

    try:
        tags = json.loads(a["tags"] or "[]") if a else []
    except Exception:  # noqa: BLE001
        tags = []
    payload = _payload(row)
    detail = {
        "nodeId": node_id,
        "label": a["label"] if a else None,
        "customerRef": a["customer_ref"] if a else None,
        "tags": tags if isinstance(tags, list) else [],
        "billingState": a["billing_state"] if a else "unknown",
        "agentVersion": row["agent_version"],
        "status": _status_for(now - row["last_seen_at"]),
        "lastSeenAgoSeconds": round(now - row["last_seen_at"]),
        "lastSeenAt": row["last_seen_at"],
        "sentAt": row["sent_at"],
        "firstSeenAt": row["first_seen_at"],
        "uptimeSeconds": row["uptime_seconds"],
        "piholeReachable": bool(row["pihole_reachable"]),
        "host": _dict(payload.get("host")),
        "modules": _list(payload.get("modules")),
        "counters": _dict(payload.get("counters")),
        # Three-valued on purpose — dict: reported; None + shieldReported: the
        # box tried and could not read it; shieldReported False: agent predates
        # the field. Only on the DETAIL view, never on the list.
        "shield": (payload.get("shield") if isinstance(payload.get("shield"), dict) else None)
        if "shield" in payload else None,
        "shieldReported": "shield" in payload,
        "notes": notes,
        "tokenIssuedAt": enrolled["issued_at"] if enrolled else None,
        "tokenActivatedAt": enrolled["activated_at"] if enrolled else None,
    }
    detail["findings"] = _support_findings(detail)
    return JSONResponse(detail)


_WINDOWS = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400}


@app.get("/api/v1/nodes/{node_id}/history")
def node_history_route(node_id: str, request: Request, window: str = "24h") -> JSONResponse:
    _require_admin(request)
    return _history(node_id, window)


def node_history(node_id: str, window: str = "24h", authorization: str | None = None) -> JSONResponse:
    """Direct-call form (kept for tests and scripts): Basic credentials only."""
    if not (authorization and authorization.startswith("Basic ") and _basic_ok(authorization)):
        raise HTTPException(status_code=401, detail="bad credentials")
    return _history(node_id, window)


def _history(node_id: str, window: str) -> JSONResponse:
    """Trend for one box. Raw samples inside the raw window, hourly averages
    beyond it — and the response says which, because a chart that silently
    changes meaning is worse than one that says 'hourly average'."""
    now = time.time()
    if window not in _WINDOWS:
        window = "24h"
    span = _WINDOWS[window]
    since = now - span

    with db() as conn:
        if span <= RAW_RETENTION_DAYS * 86400:
            rows = conn.execute(
                "SELECT at, cpu, disk, temp, "
                "CASE WHEN mem_total>0 THEN 100.0*mem_used/mem_total END mem, pihole_ok "
                "FROM samples WHERE node_id = ? AND at >= ? ORDER BY at",
                (node_id, since),
            ).fetchall()
            points = [{"t": r["at"], "cpu": r["cpu"], "mem": r["mem"], "disk": r["disk"],
                       "temp": r["temp"], "piholeOk": r["pihole_ok"]} for r in rows]
            return JSONResponse({"window": window, "resolution": "every check-in (raw samples)",
                                 "stepSeconds": None, "points": points})

        # Hourly rows only exist for samples OLDER than the raw window, so the
        # most recent week is unioned in from raw, averaged per hour, so both
        # halves mean the same thing.
        hourly = conn.execute(
            "SELECT hour, cpu, mem_pct mem, disk, temp, pihole_ok_pct "
            "FROM samples_hourly WHERE node_id = ? AND hour >= ? ORDER BY hour",
            (node_id, since / 3600),
        ).fetchall()
        recent = conn.execute(
            "SELECT CAST(at/3600 AS INTEGER) hour, AVG(cpu) cpu, "
            "AVG(CASE WHEN mem_total>0 THEN 100.0*mem_used/mem_total END) mem, "
            "AVG(disk) disk, AVG(temp) temp, 100.0*AVG(COALESCE(pihole_ok,0)) pihole_ok_pct "
            "FROM samples WHERE node_id = ? AND at >= ? GROUP BY hour ORDER BY hour",
            (node_id, since),
        ).fetchall()
    seen = {r["hour"] for r in hourly}
    merged = sorted(list(hourly) + [r for r in recent if r["hour"] not in seen], key=lambda r: r["hour"])
    points = [{"t": r["hour"] * 3600, "cpu": r["cpu"], "mem": r["mem"], "disk": r["disk"], "temp": r["temp"],
               "piholeOk": None if r["pihole_ok_pct"] is None else r["pihole_ok_pct"] / 100.0}
              for r in merged]
    return JSONResponse({"window": window, "resolution": "hourly averages", "stepSeconds": 3600,
                         "points": points})


# ------------------------------------------------------------------- admin


@app.put("/api/v1/nodes/{node_id}/admin")
def set_admin(node_id: str, request: Request, body: dict = Body(...)) -> JSONResponse:
    """Your own record of a box. Never sent to the node."""
    _require_admin(request)
    label = str(body.get("label") or "").strip()[:64] or None
    ref = str(body.get("customerRef") or "").strip()[:64] or None
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
def add_note(node_id: str, request: Request, body: dict = Body(...)) -> JSONResponse:
    """Append to the support log. Append-only: an editable history is not one.
    The author is whoever is signed in — not a field the browser may set."""
    user = _require_admin(request)
    text = str(body.get("body") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="a note needs a body")
    with _write_lock, db() as conn:
        cur = conn.execute(
            "INSERT INTO notes (node_id, body, author, created_at) VALUES (?,?,?,?)",
            (node_id, text[:4000], user[:48], time.time()),
        )
        note_id = cur.lastrowid
    return JSONResponse(status_code=201, content={"id": note_id, "ok": True})


def _utc(ts: float | None) -> str:
    return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(ts)) if ts else "at an unknown time"


@app.delete("/api/v1/nodes/{node_id}/token")
def forget_token(node_id: str, request: Request) -> JSONResponse:
    """Forget the credential a node posts with - the console half of BUG-30.

    For a box that was re-imaged or lost its stored token. While this server
    holds an ACTIVATED token for it, its shared-token check-ins are refused
    (that boundary is what stops the shared token impersonating an enrolled
    box), and the box's own log tells support to call exactly this route.

    Deletes the `tokens` row and nothing else: node record, history, admin
    record and support log stay. The old token stops working at once - there
    is no row left for it to match - and the box's next check-in with the
    shared enrolment token enrols it again (201, fresh token). Until then
    anyone holding the shared token could enrol under this id, which is why
    this is an authenticated, audited support action and never automatic.

    The audit line is a support-log note written in the SAME transaction as
    the delete, so neither exists without the other. Nothing on file is a 404,
    never a success: "forgotten" and "there was nothing to forget" must not
    share a sentence.
    """
    user = _require_admin(request)
    now = time.time()
    with _write_lock, db() as conn:
        row = conn.execute("SELECT issued_at, activated_at FROM tokens WHERE node_id = ?", (node_id,)).fetchone()
        if not row:
            known = conn.execute("SELECT 1 FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
            raise HTTPException(status_code=404, detail=(
                "no token on file for this node - nothing was forgotten; its next check-in with the "
                "shared enrolment token enrols it" if known else
                "this server has no token and no check-in for a node with that id - nothing was forgotten"))
        if conn.execute("DELETE FROM tokens WHERE node_id = ?", (node_id,)).rowcount != 1:
            raise HTTPException(status_code=409, detail="the token changed while it was being forgotten - retry")
        used = (f"first used by the box {_utc(row['activated_at'])}" if row["activated_at"]
                else "never used by the box")
        note_id = conn.execute(
            "INSERT INTO notes (node_id, body, author, created_at) VALUES (?,?,?,?)",
            (node_id,
             f"Feed token forgotten by {user[:48]} at {_utc(now)}. It was issued {_utc(row['issued_at'])} "
             f"and {used}; it no longer works. The box re-enrols with the shared enrolment token on its "
             f"next check-in.",
             user[:48], now),
        ).lastrowid
    return JSONResponse({"ok": True, "nodeId": node_id, "forgottenIssuedAt": row["issued_at"],
                         "forgottenActivatedAt": row["activated_at"], "noteId": note_id})


@app.get("/api/v1/session")
def session_info(request: Request) -> JSONResponse:
    user = _require_admin(request)
    return JSONResponse({"user": user})


# -------------------------------------------------------------------- pages

_page_cache: dict[str, str] = {}


def _page(name: str, root: str, **subs: str) -> HTMLResponse:
    """Serve a static page with a server-rendered <base href>, so the page's
    relative URLs resolve under whatever prefix it is being served at."""
    if name not in _page_cache:
        _page_cache[name] = (STATIC_DIR / name).read_text(encoding="utf-8")
    html = _page_cache[name].replace("%%BASE%%", _html_attr(root + "/"))
    for k, v in subs.items():
        html = html.replace(f"%%{k}%%", v)
    return HTMLResponse(html)


def _html_attr(s: str) -> str:
    return (s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;"))


def _to(request: Request, rel: str) -> str:
    return f"{_root(request)}/{rel}"


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request) -> Response:
    # A page load without a session is a redirect, never a 401 — see AUTH.
    if not read_session(request.cookies.get(COOKIE_NAME)):
        auth = request.headers.get("authorization") or ""
        if not (auth.startswith("Basic ") and _basic_ok(auth)):
            return RedirectResponse(_to(request, "login"), status_code=303)
    return _page("index.html", _root(request))


_LOGIN_MESSAGES = {
    "": "",
    "bad": "That user name and password did not match.",
    "locked": "Too many failed attempts from this address. Try again in a few minutes.",
    "out": "You are signed out.",
    "expired": "Your session ended. Sign in again.",
}


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, e: str = "") -> Response:
    if read_session(request.cookies.get(COOKIE_NAME)):
        return RedirectResponse(_to(request, ""), status_code=303)
    msg = _LOGIN_MESSAGES.get(e, "")
    return _page("login.html", _root(request),
                 MSG=_html_attr(msg), MSGCLASS="msg" if msg else "msg hidden",
                 USER=_html_attr(ADMIN_USER if e == "bad" else ""))


@app.post("/login")
async def login_submit(request: Request) -> Response:
    ip = _client_ip(request)
    wait = login_limiter.retry_after(ip)
    if wait:
        r = RedirectResponse(_to(request, "login?e=locked"), status_code=303)
        r.headers["Retry-After"] = str(wait)
        return r
    raw = await request.body()
    if len(raw) > 4096:
        return RedirectResponse(_to(request, "login?e=bad"), status_code=303)
    form = parse_qs(raw.decode("utf-8", errors="replace"), keep_blank_values=True)
    user = (form.get("username") or [""])[0]
    password = (form.get("password") or [""])[0]
    ok = secrets.compare_digest(user.encode(), ADMIN_USER.encode()) & \
        secrets.compare_digest(password.encode(), ADMIN_PASSWORD.encode())
    if not ok:
        login_limiter.fail(ip)
        return RedirectResponse(_to(request, "login?e=bad"), status_code=303)
    login_limiter.success(ip)
    resp = RedirectResponse(_to(request, ""), status_code=303)
    _set_session_cookie(resp, request, make_session(ADMIN_USER))
    return resp


@app.post("/logout")
def logout(request: Request) -> Response:
    resp = RedirectResponse(_to(request, "login?e=out"), status_code=303)
    resp.delete_cookie(COOKIE_NAME, path=(_root(request) or "") + "/", httponly=True, samesite="strict",
                       secure=_cookie_secure(request))
    return resp


# Static assets (css, js, fonts, icons). They hold no customer data, so they
# are public — which lets the login page be styled before anyone signs in.
app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")
