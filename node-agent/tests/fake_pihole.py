"""A fake Pi-hole v6 API for httpx.MockTransport - shapes taken from the FTL v6.7.1
OpenAPI spec and source, not from what the agent happens to expect.

  POST   /api/auth              {"session": {"valid", "sid", "validity"}}; 429 when out of seats
  DELETE /api/auth              204, frees the seat
  GET    /api/stats/summary     needs X-FTL-SID; gravity.last_update is the build stamp
  GET    /api/lists             {"lists": [{"address", "type", ...}]}
  POST   /api/lists?type=block  201
  DELETE /api/lists/{enc}?type=block  204 (address percent-encoded, as the web UI sends it)
  POST   /api/action/gravity    200 text/plain, the gravity script's output (NOT JSON)
  GET    /api/history           {"history": [{"timestamp", "total", "cached", "blocked", "forwarded"}]}
  GET    /api/history/database  same, from/until, 600 s slot starts, empty slots absent

Used by several test modules; import it as `from fake_pihole import FakePihole`.
"""

from __future__ import annotations

import itertools
import json
import threading
import time
from urllib.parse import parse_qs, unquote, urlparse

import httpx


class FakePihole:
    def __init__(self, password: str = "pw", max_sessions: int = 16):
        self.password = password
        self.max_sessions = max_sessions
        self.sessions: set[str] = set()
        self.deleted_sessions: list[str] = []
        self._ids = itertools.count(1)
        self.lock = threading.Lock()
        self.calls: list[tuple[str, str]] = []
        self.auth_calls = 0
        self.summary_calls = 0
        self.summary_delay = 0.0
        self.domains = 151_234
        self.gravity_stamp = 1_790_000_000
        self.lists: list[dict] = []
        self.gravity_runs = 0
        self.gravity_bumps_stamp = True
        self.history_payload: dict = {"history": []}
        self.database_payload: dict = {"history": []}
        self.database_queries: list[dict] = []
        self.fail_with: int | None = None     # force this HTTP status on every non-auth call
        self.raise_on: str | None = None      # raise httpx.ConnectError for paths starting with this

    # ------------------------------------------------------------- controls

    def restart(self) -> None:
        """FTL restarted: every session is gone."""
        with self.lock:
            self.sessions.clear()

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    # -------------------------------------------------------------- handler

    def _json(self, status: int, body) -> httpx.Response:
        return httpx.Response(status, content=json.dumps(body).encode(),
                              headers={"Content-Type": "application/json"})

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = urlparse(str(request.url))
        path = url.path
        method = request.method
        with self.lock:
            self.calls.append((method, str(request.url)))

        if self.raise_on and path.startswith(self.raise_on):
            raise httpx.ConnectError("connection refused", request=request)

        if path == "/api/auth":
            if method == "POST":
                with self.lock:
                    self.auth_calls += 1
                    body = json.loads(request.content or b"{}")
                    if body.get("password") != self.password:
                        return self._json(401, {"session": {"valid": False, "sid": None, "validity": -1}})
                    if len(self.sessions) >= self.max_sessions:
                        return self._json(429, {"error": {"key": "api_seats_exceeded",
                                                          "message": "API seats exceeded"}})
                    sid = f"sid{next(self._ids)}"
                    self.sessions.add(sid)
                return self._json(200, {"session": {"valid": True, "sid": sid, "validity": 1800}})
            if method == "DELETE":
                sid = request.headers.get("X-FTL-SID")
                with self.lock:
                    if sid in self.sessions:
                        self.sessions.discard(sid)
                        self.deleted_sessions.append(sid)
                        return httpx.Response(204)
                return self._json(401, {"error": {"key": "unauthorized"}})

        # Everything else needs a live session.
        sid = request.headers.get("X-FTL-SID")
        with self.lock:
            if sid not in self.sessions:
                return self._json(401, {"error": {"key": "unauthorized", "message": "Unauthorized"}})
        if self.fail_with is not None:
            return self._json(self.fail_with, {"error": {"key": "internal", "message": "forced failure"}})

        if path == "/api/stats/summary":
            with self.lock:
                self.summary_calls += 1
            if self.summary_delay:
                time.sleep(self.summary_delay)
            return self._json(200, {
                "queries": {"total": 1000, "blocked": 40, "percent_blocked": 4.0},
                "clients": {"active": 3, "total": 5},
                "gravity": {"domains_being_blocked": self.domains, "last_update": self.gravity_stamp},
            })

        if path == "/api/lists" and method == "GET":
            return self._json(200, {"lists": list(self.lists)})
        if path == "/api/lists" and method == "POST":
            q = parse_qs(url.query)
            if q.get("type") != ["block"]:
                return self._json(400, {"error": {"message": "Specify type parameter"}})
            body = json.loads(request.content or b"{}")
            self.lists.append({"address": body["address"], "type": "block", "enabled": True})
            return self._json(201, {"lists": self.lists, "processed": {"success": [{"item": body["address"]}], "errors": []}})
        if path.startswith("/api/lists/") and method == "DELETE":
            raw = request.url.raw_path.decode().split("?", 1)[0][len("/api/lists/"):]
            address = unquote(raw)
            before = len(self.lists)
            self.lists = [entry for entry in self.lists if entry["address"] != address]
            return httpx.Response(204) if len(self.lists) < before else self._json(404, {"took": 0})

        if path == "/api/action/gravity" and method == "POST":
            self.gravity_runs += 1
            if self.gravity_bumps_stamp:
                self.gravity_stamp += 60
            text = ("  [i] Neutrino emissions detected...\n"
                    "  [✓] Swapping databases\n"
                    f"  [i] Number of gravity domains: {self.domains}\n")
            return httpx.Response(200, content=text.encode(), headers={"Content-Type": "text/plain"})

        if path == "/api/history":
            return self._json(200, self.history_payload)
        if path == "/api/history/database":
            q = parse_qs(url.query)
            self.database_queries.append({k: v[0] for k, v in q.items()})
            if "from" not in q or "until" not in q:
                return self._json(400, {"error": {"message": "You need to specify both \"from\" and \"until\""}})
            return self._json(200, self.database_payload)

        return self._json(404, {"error": {"key": "not_found"}})
