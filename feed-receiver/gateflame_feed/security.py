"""Bearer auth for the feed receiver — two credential types, kept apart.

Mirrors the separation in node-agent's `security.py`: independent checks that
are deliberately not folded into one "is this caller allowed" function.

- **Node token** — one per appliance, issued at provisioning (§4.4). It can do
  exactly one thing: POST that node's own health, and read that node's own
  history. It is on customer hardware in a customer's house, so it is assumed
  to be recoverable by a determined owner and is scoped accordingly.
- **Admin token** — Ionity support. Reads the fleet. Never posts. It lives in
  the receiver's environment, not on any appliance.

A node token is never accepted where an admin token is required, and a node
token is never accepted for another node's data. Both are stated here and
tested in `tests/test_auth.py`.

## Why the failures all look identical

Every auth failure — no header, malformed header, unknown token, revoked
token, right token for the wrong node, node token on an admin route — returns
`401 {"error": "unauthorized"}` with no further detail. In particular, posting
to `/api/v1/nodes/GF-DOESNOTEXIST/health` and posting to a real node id with a
wrong token are indistinguishable. `nodeId`s are printed on enclosure labels
and read out on support calls (§3.3); an endpoint that says "that node is
real, wrong password" turns the public endpoint into an oracle for which units
Ionity has sold and which are online.
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
import stat
from hashlib import sha256
from pathlib import Path

from fastapi import HTTPException, Request

from .config import Config
from .storage import FeedStore

logger = logging.getLogger("gateflame_feed.security")

UNAUTHORIZED = HTTPException(status_code=401, detail={"error": "unauthorized"})


def hash_token(token: str, pepper: str) -> str:
    """HMAC-SHA256(pepper, token), hex.

    **Why HMAC-SHA256 and not bcrypt/argon2/scrypt.** Those are password
    hashes; their cost factor buys resistance to offline guessing of
    *low-entropy human-chosen* secrets. These tokens are
    `secrets.token_urlsafe(32)` — 256 bits from the OS CSPRNG. There is no
    guessing attack to slow down, and a deliberately slow hash on the
    authentication path of an endpoint every node in the fleet hits every 15
    minutes is a self-inflicted denial of service: the whole fleet's tokens
    would be verified at, by design, a few hundred hashes per second per core.

    **Why HMAC and not a bare SHA-256.** node-agent's `storage.py:_hash_token`
    uses a bare digest (its comment says "salted", which it is not — worth
    fixing there, out of scope here). A bare digest of a bearer token is a
    deterministic, keyless function: anyone who obtains a database dump can
    verify a guessed or leaked token offline, and can confirm whether a token
    seen elsewhere belongs to this fleet. Keying the hash with a pepper held
    outside the database means a stolen `feed.db` is inert on its own — the
    attacker also needs the pepper file, which is not in the DB, not in a
    backup of the DB, and not in the same row-level dump a SQL injection or a
    misplaced copy would produce.

    Constant-time comparison is unnecessary here because lookup is by hash
    (an index probe on a value the attacker already controls), not a
    comparison of the secret itself.
    """
    return hmac.new(pepper.encode("utf-8"), token.encode("utf-8"), sha256).hexdigest()


def load_or_create_pepper(cfg: Config) -> str:
    """Return the token pepper, generating a persistent one if unset.

    Preference order: `GATEFLAME_FEED_TOKEN_PEPPER` from the environment (a
    secrets manager, a systemd `LoadCredential=`), else a 0600 sidecar file
    beside the database. The sidecar is a *separate file* on purpose: the
    point of the pepper is that `feed.db` alone is not enough, so it must not
    live inside `feed.db`.

    Generating one silently is the right default only because the alternative
    — refusing to start — would mean the first `uvicorn` in dev fails for a
    reason nobody has explained yet. It is logged at WARNING so it is visible
    when it happens in production, where the env var should be set.
    """
    if cfg.token_pepper:
        return cfg.token_pepper

    sidecar = Path(cfg.db_path).with_suffix(".pepper")
    if sidecar.exists():
        return sidecar.read_text(encoding="utf-8").strip()

    pepper = secrets.token_urlsafe(48)
    sidecar.parent.mkdir(parents=True, exist_ok=True)
    # Create with 0600 from the start rather than write-then-chmod, so the
    # secret is never briefly world-readable.
    fd = os.open(str(sidecar), os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(pepper)
    logger.warning(
        "GATEFLAME_FEED_TOKEN_PEPPER unset; generated one at %s. "
        "Back this file up separately from the database — losing it invalidates every node token.",
        sidecar,
    )
    return pepper


def bearer_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    return token or None


class NodeAuth:
    """Callable dependency: the caller holds a live token for `node_id`.

    Resolution is by token hash across the whole token table, then a check
    that the resolved node matches the path. Doing it in that order means the
    same work happens for an unknown node id as for a known one.
    """

    def __init__(self, store: FeedStore, pepper: str):
        self.store = store
        self.pepper = pepper

    def __call__(self, request: Request, node_id: str) -> str:
        token = bearer_token(request)
        if token is None:
            raise UNAUTHORIZED
        owner = self.store.node_for_token_hash(hash_token(token, self.pepper))
        # `owner is None` (no such token) and `owner != node_id` (a real token
        # for a different appliance) are the same answer on purpose. A node
        # token must not be usable to probe which other node ids exist.
        if owner is None or owner != node_id:
            raise UNAUTHORIZED
        return owner


class AdminAuth:
    """Callable dependency: the caller holds the Ionity support token.

    A node token presented here fails, because it is not compared against the
    token table at all — there is exactly one value that passes and it is not
    in the database.
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def __call__(self, request: Request) -> str:
        if not self.cfg.admin_token:
            # Fail closed and say so. An admin API with no configured
            # credential must not answer; it also must not pretend the caller
            # got the password wrong, because the operator would then hunt the
            # wrong problem.
            raise HTTPException(status_code=503, detail={"error": "admin_api_not_configured"})
        token = bearer_token(request)
        if token is None or not hmac.compare_digest(token, self.cfg.admin_token):
            raise UNAUTHORIZED
        return "admin"


class AdminOrOwnNodeAuth:
    """Admin token, or that node's own token. Used for one-node history.

    Support reads any node; an appliance may read back only itself. Anything
    else — including a valid token belonging to a different appliance — is the
    same 401 as no credential at all.
    """

    def __init__(self, store: FeedStore, cfg: Config, pepper: str):
        self.node = NodeAuth(store, pepper)
        self.cfg = cfg

    def __call__(self, request: Request, node_id: str) -> str:
        token = bearer_token(request)
        if token is None:
            raise UNAUTHORIZED
        if self.cfg.admin_token and hmac.compare_digest(token, self.cfg.admin_token):
            return "admin"
        return self.node(request, node_id)
