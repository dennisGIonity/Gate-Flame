"""Gate^Flame feed receiver — FastAPI app.

The server side of `node-agent/gateflame/health_feed.py`. That module posts to
`https://feeds.ionity.today/api/v1/nodes/{nodeId}/health` every 15 minutes and
nothing existed to receive it; this is that endpoint, plus a small read API for
Ionity support.

Run with:

    uvicorn gateflame_feed.main:app --host 0.0.0.0 --port 8081

Design notes worth reading before editing:

- The §4.1 health-only promise is enforced twice, independently:
  `schema.py` (closed allowlist, `extra="forbid"`) and `storage.py` (no column
  and no blob that could hold forbidden data). Neither is a comment.
- Nothing in this file logs a request body, and the validation-error handler
  strips echoed input values — see `_validation_handler`. An endpoint that
  refuses to store client IPs but prints them into its own log has not
  actually kept the promise.
- `sentAt` is node-controlled and is therefore load-bearing for nothing.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import Config, config
from .schema import ACCEPTED_FIELDS, HealthReport, parse_sent_at
from .security import AdminAuth, AdminOrOwnNodeAuth, NodeAuth, load_or_create_pepper
from .storage import FeedStore, report_hash

logger = logging.getLogger("gateflame_feed")

# The agent's contracted interval (§4.3 rule 5). Used only to classify a node
# as online / stale / offline on the support console.
FEED_INTERVAL_SECONDS = 900
ONLINE_WITHIN = FEED_INTERVAL_SECONDS * 3  # 45 min — tolerates two missed posts
STALE_WITHIN = 6 * 3600


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _connectivity(last_seen: float | None, now: float) -> str:
    if last_seen is None:
        return "never_seen"
    age = now - last_seen
    if age <= ONLINE_WITHIN:
        return "online"
    if age <= STALE_WITHIN:
        return "stale"
    return "offline"


def create_app(cfg: Config | None = None, store: FeedStore | None = None) -> FastAPI:
    cfg = cfg or config
    store = store or FeedStore(cfg.db_path)
    pepper = load_or_create_pepper(cfg)

    app = FastAPI(title="Gate^Flame feed receiver", version=cfg.version)
    app.state.cfg = cfg
    app.state.store = store
    app.state.pepper = pepper

    node_auth = NodeAuth(store, pepper)
    admin_auth = AdminAuth(cfg)
    admin_or_own = AdminOrOwnNodeAuth(store, cfg, pepper)

    # ---- guards ----------------------------------------------------------

    @app.middleware("http")
    async def _cap_body_size(request: Request, call_next):
        """§4.3 rule 5 promises ≤ 8 KB per POST. Enforce the number.

        A declared Content-Length is required on writes so an oversize body can
        be refused before it is read into memory; without that, "capped" means
        "we allocate it first and complain afterwards", which is not a cap at
        all when the sender is the thing you are defending against.
        """
        if request.method in ("POST", "PUT", "PATCH"):
            raw_length = request.headers.get("content-length")
            if raw_length is None:
                return JSONResponse(status_code=411, content={"error": "length_required"})
            try:
                length = int(raw_length)
            except ValueError:
                return JSONResponse(status_code=400, content={"error": "bad_content_length"})
            if length > cfg.max_body_bytes:
                return JSONResponse(
                    status_code=413,
                    content={"error": "payload_too_large", "maxBytes": cfg.max_body_bytes},
                )
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError):
        """422 with the *names* of the offending fields and nothing else.

        FastAPI's default handler includes an `input` key echoing the rejected
        value. For this service that would mean a payload carrying `domains`
        or `clientIps` gets those values reflected in the response body — and
        into whatever proxy or access log sits in front of the receiver. The
        promise in §4.1 is about not handling that data, not merely about not
        writing it to our own table, so the values are dropped here and never
        logged.

        What is returned is enough for the agent's operator to fix it: the
        path to the field and the reason. `extra_forbidden` is the one that
        matters — it means the agent sent a field this service has not agreed
        to receive, which is a §4.1 review question, not a bug to route around.
        """
        rejected = [
            {
                "field": ".".join(str(p) for p in err.get("loc", ()) if p != "body"),
                "reason": err.get("type", "invalid"),
            }
            for err in exc.errors()
        ]
        forbidden_extras = [r["field"] for r in rejected if r["reason"] == "extra_forbidden"]
        if forbidden_extras:
            # Field *names* only. Names are schema, not customer data.
            logger.warning(
                "rejected report: fields not in the §4.1 allowlist: %s", ", ".join(forbidden_extras)
            )
        return JSONResponse(
            status_code=422,
            content={
                "error": "schema_rejected",
                "detail": "payload does not match the health-only contract (PAIRING-AND-TELEMETRY.md §4.1)",
                "rejected": rejected,
            },
        )

    # ---- ingest ----------------------------------------------------------

    @app.post("/api/v1/nodes/{node_id}/health", status_code=202)
    def post_health(
        node_id: str,
        report: HealthReport,
        _owner: str = Depends(node_auth),
    ):
        # Auth (the dependency) is resolved before the body is validated, so an
        # unauthenticated caller gets 401 and learns nothing about the schema.
        if report.nodeId != node_id:
            # A token is bound to one node, so this is either a client bug or
            # an attempt to file health under someone else's id. Neither should
            # be stored under either id.
            raise HTTPException(
                status_code=422,
                detail={"error": "node_id_mismatch"},
            )

        now = time.time()
        sent_ts = parse_sent_at(report.sentAt).timestamp()
        skew = sent_ts - now

        # ---- clock skew -------------------------------------------------
        #
        # `sentAt` arrives from the appliance and is attacker-controllable in
        # principle. The design here is "distrust, don't reject":
        #
        #  * Nothing that matters is derived from it. Ordering, `lastSeen`,
        #    the online/stale/offline classification and retention pruning all
        #    key on the server's `received_at`. A node claiming 2099 cannot
        #    make its rows immortal or park itself permanently at the top of
        #    the support console; one claiming 1970 cannot have its rows
        #    pruned the instant they land.
        #  * A Pi has no battery-backed RTC. A unit that boots without
        #    network time genuinely believes it is 1970 (or whatever the last
        #    fake-hwclock write said) until NTP lands. That unit is *exactly*
        #    the one support needs to see, so a skewed report is stored, with
        #    the measured skew, flagged `clockSuspect`, and the skew is
        #    returned to the agent so it shows up in the node's own log.
        #  * The accept window is asymmetric, because the causes are. Behind:
        #    anything from the Unix epoch onward is a clock with a name.
        #    Before the epoch: no UNIX clock produces that, however wrong.
        #    Ahead by a decade: not skew, fabrication.
        if sent_ts < 0 or skew > cfg.clock_reject_future_seconds:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "implausible_timestamp",
                    "maxFutureSkewSeconds": cfg.clock_reject_future_seconds,
                },
            )
        clock_suspect = abs(skew) > cfg.clock_suspect_seconds

        # ---- replay ------------------------------------------------------
        #
        # `_send_once` returns False on any transport error, including a
        # response lost on the way back, so the loop re-posts a byte-identical
        # report. Dedupe by content hash (see storage.report_hash) makes that
        # a no-op instead of a duplicate row: history cannot be corrupted by a
        # retry, and `reportCount` stays honest.
        #
        # Checked *before* the rate limiter on purpose — a replay costs one
        # indexed lookup and must not consume the node's budget, or a node
        # whose responses are being dropped would rate-limit itself out of
        # reporting the next genuinely new report.
        digest = report_hash(report)
        if store.has_report(node_id, digest):
            return {
                "status": "duplicate",
                "nodeId": node_id,
                "clockSkewSeconds": round(skew, 3),
            }

        # ---- rate limit --------------------------------------------------
        #
        # One broken node in a retry loop with a changing `sentAt` (so the
        # dedupe above does not catch it) is the disk-fill case. Per node,
        # not per IP: a fleet behind one carrier-grade NAT must not share a
        # budget, and a node's identity here is its token, not its address.
        decision = store.check_rate_limit(
            node_id, cfg.min_interval_seconds, cfg.max_reports_per_hour, now=now
        )
        if not decision.allowed:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limited",
                    "reason": decision.reason,
                    "retryAfterSeconds": decision.retry_after_seconds,
                },
                headers={"Retry-After": str(int(decision.retry_after_seconds) + 1)},
            )

        report_id = store.record_report(
            report,
            digest=digest,
            received_at=now,
            sent_at=sent_ts,
            clock_skew_seconds=skew,
            clock_suspect=clock_suspect,
        )
        if report_id is None:
            # Lost a race with a concurrent identical POST; the other writer
            # stored it. Same answer as the dedupe path above.
            return {"status": "duplicate", "nodeId": node_id, "clockSkewSeconds": round(skew, 3)}

        store.maybe_prune(cfg.retention_days, cfg.max_rows_per_node)

        return {
            "status": "stored",
            "nodeId": node_id,
            "receivedAt": _iso(now),
            "clockSkewSeconds": round(skew, 3),
            "clockSuspect": clock_suspect,
            "retentionDays": cfg.retention_days,
        }

    # ---- support read API ------------------------------------------------

    @app.get("/api/v1/admin/nodes")
    def list_nodes(_admin: str = Depends(admin_auth)):
        now = time.time()
        nodes = []
        for row in store.list_nodes():
            nodes.append(
                {
                    "nodeId": row["nodeId"],
                    "agentVersion": row["agentVersion"],
                    "firstSeen": _iso(row["firstSeen"]),
                    "lastSeen": _iso(row["lastSeen"]),
                    "lastSeenAgeSeconds": (
                        None if row["lastSeen"] is None else round(now - row["lastSeen"], 1)
                    ),
                    "status": _connectivity(row["lastSeen"], now),
                    "reportCount": row["reportCount"],
                    "degradedModules": row["degradedModules"],
                }
            )
        return {"nodes": nodes, "count": len(nodes)}

    @app.get("/api/v1/admin/nodes/{node_id}/history")
    def node_history(
        node_id: str,
        limit: int = Query(default=50, ge=1, le=500),
        _who: str = Depends(admin_or_own),
    ):
        history = store.node_history(node_id, limit)
        return {
            "nodeId": node_id,
            "count": len(history),
            "retentionDays": cfg.retention_days,
            "reports": [
                {
                    **r,
                    "receivedAt": _iso(r["receivedAt"]),
                    "sentAt": _iso(r["sentAt"]),
                }
                for r in history
            ],
        }

    @app.delete("/api/v1/admin/nodes/{node_id}")
    def delete_node(node_id: str, _admin: str = Depends(admin_auth)):
        deleted = store.delete_node(node_id)
        return {"nodeId": node_id, "deletedReports": deleted}

    # ---- public ----------------------------------------------------------

    @app.get("/api/v1/contract")
    def contract():
        """The exact accepted field list, unauthenticated.

        §4.3 rule 3 requires the customer be able to see what leaves the
        device without asking. The kiosk's "what we send" screen can render
        this, and a customer or auditor can curl it. It returns field names
        only — no data of any kind, from any node.
        """
        return {
            "spec": "docs/PAIRING-AND-TELEMETRY.md §4",
            "policy": "health fields only; no domains, client IPs, MACs, hostnames, threat logs or DPI output",
            "extraFieldsPolicy": "rejected with 422 — never silently dropped",
            "acceptedFields": ACCEPTED_FIELDS,
            "maxBodyBytes": cfg.max_body_bytes,
            "retentionDays": cfg.retention_days,
        }

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "service": "gateflame-feed-receiver", "version": cfg.version}

    return app


def __getattr__(name: str):
    """Lazily build the process-wide `app` for `uvicorn gateflame_feed.main:app`.

    Built on first attribute access rather than at import so that importing
    this module — which a test, a CLI subcommand or a doc tool does — never
    has the side effect of creating `/var/lib/gateflame-feed/` and a database
    nobody asked for. Tests call `create_app()` with their own Config.
    """
    if name == "app":
        global _app
        try:
            return _app
        except NameError:
            _app = create_app()
            return _app
    raise AttributeError(name)
