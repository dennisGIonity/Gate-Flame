"""BUG-31: module actions answer at a status code that tells the truth, and
"restart the filter" restarts it - believed only on a read-back.

What went wrong: Ionibot's "Restart it" POSTed /services/dns/start. There is no
module "dns", so the agent answered HTTP 200 {"ok": false, "error":
"unknown_module"}; Ionibot checked only the status and told the customer the
filter had restarted. And even with the right id there was nothing to call -
module_dns_filter never had a start hook.

What this pins:
  - an action that did not happen is never a 200: unknown module 404, refused
    409, a restart that did not come back 502;
  - a failure keeps its keys AND carries FastAPI's `detail` envelope, which is
    where the console's transport (kioskClient.nodeRequest) reads the sentence;
  - a restart is a success only when a DIFFERENT FTL process answers. Pi-hole
    saying "success" is not enough, and neither is the old process answering.
"""

from __future__ import annotations

import dataclasses
from urllib.parse import urlparse

import httpx
import pytest
from fake_pihole import FakePihole
from fastapi.testclient import TestClient

from gateflame import pihole, services
from gateflame.main import app, store

RESTART = "/api/v1/services/module_dns_filter/restart"


def kiosk() -> TestClient:
    # No `with`: entering the client runs the lifespan, whose reconcile thread
    # would talk to the fake Pi-hole in the middle of these tests.
    return TestClient(app, client=("127.0.0.1", 12345))


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    services._enabled.clear()
    # Pinned rather than read from the environment, so the advisory text and
    # the virtual-time arithmetic below are the same on every machine.
    monkeypatch.setattr(services, "RESTART_WAIT_SECONDS", 15.0)
    monkeypatch.setattr(services, "RESTART_POLL_SECONDS", 0.5)
    yield
    services._enabled.clear()


# ---------------------------------------------------------------- fakes


class Clock:
    """Virtual time for the read-back loop. It moves only when the loop sleeps
    (or a fake answer is made to take time), so a 15-second wait runs in
    microseconds and the arithmetic is exact."""

    def __init__(self) -> None:
        self.now = 1_000.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += max(seconds, 0.0)


class RestartingPihole(FakePihole):
    """FakePihole plus the two endpoints a restart needs, on the shared Clock.

      POST /api/action/restartdns  200 {"status": "success", "took"}; 403
                                   "forbidden" when allow_destructive is off
      GET  /api/info/ftl           {"ftl": {"pid", "uptime" (ms), ...}}

    Shapes from the spec the lab box's own FTL serves (action.yaml, info.yaml)
    and FTL src/api/action.c. A restart behaves like FTL's: the answer goes out
    FIRST, then the process is away for `down_seconds` (nothing answers, auth
    included), then a new image answers with the SAME pid - FTL execvp()s
    itself - and an uptime counted from its own start.
    """

    def __init__(self, clock: Clock) -> None:
        super().__init__()
        self.clock = clock
        self.pid = 4242
        self.started_at = clock.now - 3600.0   # up for an hour before the test
        self.down_until: float | None = None
        self.down_seconds = 2.0                # how long a restart keeps it away
        self.performs_restart = True           # False: says "success", does nothing
        self.cut_connection = False            # restarts, but the answer never arrives
        self.allow_destructive = True
        self.report_uptime = True
        self.ftl_latency = 0.0                 # virtual seconds an /info/ftl answer takes
        self.restart_requests = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = urlparse(str(request.url)).path
        if self.down_until is not None:
            if self.clock.now < self.down_until:
                with self.lock:
                    self.calls.append((request.method, str(request.url)))
                raise httpx.ConnectError("connection refused", request=request)
            self.down_until = None

        if path not in ("/api/info/ftl", "/api/action/restartdns"):
            return super().handler(request)

        with self.lock:
            self.calls.append((request.method, str(request.url)))
        if self.raise_on and path.startswith(self.raise_on):
            raise httpx.ConnectError("connection refused", request=request)
        with self.lock:
            if request.headers.get("X-FTL-SID") not in self.sessions:
                return self._json(401, {"error": {"key": "unauthorized", "message": "Unauthorized"}})

        if path == "/api/info/ftl" and request.method == "GET":
            self.clock.now += self.ftl_latency
            ftl: dict = {"pid": self.pid, "privacy_level": 0, "allow_destructive": self.allow_destructive}
            if self.report_uptime:
                ftl["uptime"] = (self.clock.now - self.started_at) * 1000.0
            return self._json(200, {"ftl": ftl, "took": 0.001})

        if path == "/api/action/restartdns" and request.method == "POST":
            self.restart_requests += 1
            if not self.allow_destructive:
                return self._json(403, {
                    "error": {
                        "key": "forbidden",
                        "message": "Restarting DNS is not allowed",
                        "hint": "Check setting webserver.api.allow_destructive",
                    },
                    "took": 0.001,
                })
            if self.performs_restart:
                self.down_until = self.clock.now + self.down_seconds
                self.started_at = self.down_until   # the new image's clock starts when it is back
                self.restart()                      # every session is gone
            if self.cut_connection:
                raise httpx.ConnectError("connection reset by peer", request=request)
            return self._json(200, {"status": "success", "took": 0.001})

        return self._json(404, {"error": {"key": "not_found"}})

    def paths(self) -> list[str]:
        return [urlparse(url).path for _method, url in self.calls]


@pytest.fixture
def clock(monkeypatch) -> Clock:
    c = Clock()
    monkeypatch.setattr(services, "_clock", c.monotonic)
    monkeypatch.setattr(services, "_sleep", c.sleep)
    return c


@pytest.fixture
def ftl(fake_pihole, clock, monkeypatch) -> RestartingPihole:
    """conftest's fake_pihole wiring (config, fresh sessions and caches), with a
    fake that can restart."""
    fake = RestartingPihole(clock)
    monkeypatch.setattr(pihole, "_transport", fake.transport())
    return fake


# ------------------------------------------------------- start / stop codes


def test_an_unknown_module_is_404_on_every_action():
    c = kiosk()
    for action in ("start", "stop", "restart"):
        r = c.post(f"/api/v1/services/no_such_module/{action}")
        assert r.status_code == 404, action
        body = r.json()
        assert body["ok"] is False
        assert body["error"] == "unknown_module"
        assert body["detail"]["error"] == "unknown_module"
        assert body["detail"]["advisory"] == services.UNKNOWN_MODULE_ADVISORY


def test_ionibots_old_restart_call_is_no_longer_a_200():
    """The exact request Ionibot made until BUG-31, which came back 200."""
    r = kiosk().post("/api/v1/services/dns/start")
    assert r.status_code == 404
    assert r.json()["error"] == "unknown_module"


def test_a_start_whose_requirement_is_unmet_is_409_with_the_gap(monkeypatch):
    monkeypatch.setitem(services.MODULE_DEFS["module_telemetry"], "check", lambda: (False, "gap"))
    r = kiosk().post("/api/v1/services/module_telemetry/start")
    assert r.status_code == 409
    assert r.json() == {
        "ok": False,
        "error": "capability_unavailable",
        "advisory": "gap",
        # FastAPI's envelope: kioskClient.nodeRequest shows detail.advisory.
        "detail": {"error": "capability_unavailable", "advisory": "gap"},
    }


def test_a_start_hook_that_fails_is_409(monkeypatch):
    def boom():
        raise RuntimeError("nft vanished")

    monkeypatch.setitem(services.MODULE_DEFS["module_wan_audit"], "check", lambda: (True, None))
    monkeypatch.setitem(services.MODULE_DEFS["module_wan_audit"], "on_start", boom)
    r = kiosk().post("/api/v1/services/module_wan_audit/start")
    assert r.status_code == 409
    assert r.json()["error"] == "start_failed"
    assert "nft vanished" in r.json()["advisory"]
    assert services._enabled.get("module_wan_audit") is not True


def test_a_start_that_happened_is_still_a_plain_200():
    r = kiosk().post("/api/v1/services/module_telemetry/start")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "status": "running"}


def test_stopping_a_passive_module_is_refused_not_faked():
    """It used to answer {ok: true, status: "stopped"} and change nothing."""
    r = kiosk().post("/api/v1/services/module_telemetry/stop")
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "stop_unsupported"
    assert "nothing was stopped" in body["advisory"]
    # The refusal is the truth: it is still running.
    assert services.module_status("module_telemetry")["status"] == "running"


def test_a_stop_that_happened_is_still_200():
    r = kiosk().post("/api/v1/services/module_wan_audit/stop")
    assert r.status_code == 200
    assert r.json()["status"] == "stopped"


def test_no_failure_maps_to_200():
    errors = ["unknown_module", "capability_unavailable", "start_failed", "stop_failed",
              "stop_unsupported", "restart_unsupported", "restart_in_progress",
              "restart_failed", None]
    for error in errors:
        assert services.ToggleResult(ok=False, error=error).http_status != 200, error
    assert services.ToggleResult(ok=False, error="unknown_module").http_status == 404
    assert services.ToggleResult(ok=False, error="start_failed").http_status == 409
    assert services.ToggleResult(ok=False, error="stop_failed").http_status == 409
    assert services.ToggleResult(ok=False, error="restart_failed").http_status == 502
    assert services.ToggleResult(ok=True, status="running").http_status == 200


# ------------------------------------------------------------------ restart


def test_restart_succeeds_only_once_a_new_ftl_process_answers(ftl):
    r = kiosk().post(RESTART)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["status"] == "running"
    assert body["readBack"] == "Pi-hole answering again after restart"
    assert "detail" not in body
    assert ftl.restart_requests == 1
    # It waited through the outage instead of believing the first answer.
    assert body["restartSeconds"] >= ftl.down_seconds
    # FTL was read before the request and read back after it.
    paths = ftl.paths()
    asked = paths.index("/api/action/restartdns")
    assert "/api/info/ftl" in paths[:asked]
    assert "/api/info/ftl" in paths[asked + 1:]


def test_pihole_saying_success_is_not_a_restart(ftl):
    ftl.performs_restart = False
    r = kiosk().post(RESTART)
    assert r.status_code == 502
    body = r.json()
    assert body["ok"] is False
    assert body["error"] == "restart_failed"
    assert "still running as the same process" in body["advisory"]


def test_a_slow_answer_from_the_same_process_is_not_read_as_a_restart(ftl):
    """Each answer takes 3 s. Timed from the wrong ends of the two reads, the
    old process would look 3+ s younger than expected - a restart that never
    happened, reported as one."""
    ftl.performs_restart = False
    ftl.ftl_latency = 3.0
    r = kiosk().post(RESTART)
    assert r.status_code == 502
    assert "same process" in r.json()["advisory"]


def test_a_restart_that_never_comes_back_is_502(ftl):
    ftl.down_seconds = float("inf")
    r = kiosk().post(RESTART)
    assert r.status_code == 502
    body = r.json()
    assert body["error"] == "restart_failed"
    assert body["advisory"] == (
        "Pi-hole had not answered again 15 seconds after the restart - "
        "it may still be starting, so check again in a minute"
    )
    assert body["detail"] == {"error": "restart_failed", "advisory": body["advisory"]}


def test_a_cut_connection_on_the_request_still_gets_a_read_back(ftl):
    """The restarting process can drop the very connection that asked for it.
    That is not a refusal - the read-back decides."""
    ftl.cut_connection = True
    r = kiosk().post(RESTART)
    assert r.status_code == 200, r.text
    assert r.json()["readBack"] == "Pi-hole answering again after restart"


def test_pihole_down_before_the_restart_is_409_and_nothing_is_asked(ftl):
    ftl.raise_on = "/api"   # nothing answers, the login included
    r = kiosk().post(RESTART)
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "capability_unavailable"
    assert body["advisory"] == "Pi-hole did not answer, so the filter cannot be restarted right now"
    assert ftl.restart_requests == 0


def test_no_pihole_configured_is_409_and_says_so(ftl, monkeypatch):
    monkeypatch.setattr(pihole, "config", dataclasses.replace(pihole.config, pihole_api_url=None))
    r = kiosk().post(RESTART)
    assert r.status_code == 409
    assert "not configured on this box" in r.json()["advisory"]
    assert ftl.restart_requests == 0


def test_pihole_refusing_the_restart_is_409_and_final(ftl):
    ftl.allow_destructive = False
    r = kiosk().post(RESTART)
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "capability_unavailable"
    assert body["advisory"] == (
        "Pi-hole answered with an error (HTTP 403: Restarting DNS is not allowed), "
        "so the filter cannot be restarted"
    )
    # Final: no read-back loop sat out the window after a refusal.
    assert ftl.paths().count("/api/info/ftl") == 1


def test_only_the_dns_filter_has_a_restart():
    r = kiosk().post("/api/v1/services/module_telemetry/restart")
    assert r.status_code == 409
    assert r.json()["error"] == "restart_unsupported"


def test_a_second_restart_while_one_is_running_is_refused(ftl):
    assert services._restart_lock.acquire(blocking=False)
    try:
        r = kiosk().post(RESTART)
    finally:
        services._restart_lock.release()
    assert r.status_code == 409
    assert r.json()["error"] == "restart_in_progress"
    assert ftl.restart_requests == 0


def test_restart_is_control_scope_so_a_paired_phone_may_ask(ftl):
    _device_id, token = store.register_device("BUG-31 phone", ["read", "control"])
    phone = TestClient(app, client=("192.168.9.131", 12345))
    r = phone.post(RESTART, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    stranger = TestClient(app, client=("192.168.9.132", 12345))
    assert stranger.post(RESTART).status_code == 401


def test_an_ftl_without_uptime_is_confirmed_by_going_away_and_coming_back(ftl):
    ftl.report_uptime = False
    r = kiosk().post(RESTART)
    assert r.status_code == 200, r.text


def test_an_ftl_without_uptime_that_never_went_away_is_not_confirmed(ftl):
    ftl.report_uptime = False
    ftl.performs_restart = False
    r = kiosk().post(RESTART)
    assert r.status_code == 502
    assert "could not confirm" in r.json()["advisory"]


def test_restarted_judges_by_pid_then_uptime():
    before = {"pid": 10, "uptimeMs": 3_600_000.0}
    # A new pid is a new process.
    assert services._restarted(before, {"pid": 11, "uptimeMs": 3_700_000.0}, 5.0, False)
    # FTL's execvp: same pid, young clock.
    assert services._restarted(before, {"pid": 10, "uptimeMs": 1_500.0}, 5.0, False)
    # The same process, five seconds older.
    assert not services._restarted(before, {"pid": 10, "uptimeMs": 3_605_000.0}, 5.0, False)
    # A blip in between does not overrule the uptime.
    assert not services._restarted(before, {"pid": 10, "uptimeMs": 3_605_000.0}, 5.0, True)
