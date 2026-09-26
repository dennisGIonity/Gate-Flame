"""Pi-hole reads are cached briefly, sessions are shared and given back, and every
failure has its own name.

WHAT THIS PINS (node 1.1.0, WORKSTREAM 1 task 3)

  * The kiosk polls /telemetry/summary every 4 s and /filtering every 5 s; the
    phone and IoniBot poll on top. Each poll used to be its own Pi-hole round
    trip, and /telemetry/summary made TWO (summary() then reachable() asked the
    identical question again). Now: one read per TTL, shared by everyone.
  * The cache must never hide a change the agent itself made:
    invalidate_cache() after every write, and a load that started before an
    invalidation is not stored.
  * Pi-hole allows 16 API sessions by default. The agent re-authenticated every
    ~29 minutes without logging out, and every timer job abandoned its session:
    enough to exhaust the seats and lock the agent out with a 429 that then read
    as "Pi-hole not answering". Sessions are now reused until a 401, a replaced
    one is logged out, and ten threads hitting a restarted Pi-hole make ONE new
    session, not ten.
"""

from __future__ import annotations

import threading

import httpx
import pytest

from gateflame import blocklists, pihole, telemetry
from gateflame.ttlcache import TTLCache


class Clock:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


# ------------------------------------------------------------------ caching


def test_summary_is_read_once_per_ttl(fake_pihole):
    first = pihole.summary()
    second = pihole.summary()
    assert first == second
    assert first["domainsOnGravity"] == 151_234
    assert fake_pihole.summary_calls == 1, "a second poll inside the TTL must not reach Pi-hole"


def test_summary_carries_the_gravity_build_stamp(fake_pihole):
    assert pihole.summary()["gravityLastUpdate"] == fake_pihole.gravity_stamp


def test_telemetry_asks_pihole_once_not_twice(fake_pihole, monkeypatch):
    """The old telemetry_summary() called summary() AND reachable() - two identical reads."""
    monkeypatch.setattr(telemetry, "host_snapshot", lambda: {"uptimeSeconds": 1})
    out = telemetry.telemetry_summary()
    assert out["piholeReachable"] is True
    assert out["totalQueriesToday"] == 1000
    assert fake_pihole.summary_calls == 1


def test_invalidate_makes_the_next_read_fresh(fake_pihole):
    pihole.summary()
    fake_pihole.domains = 3_082_238
    assert pihole.summary()["domainsOnGravity"] == 151_234   # still cached
    pihole.invalidate_cache()
    assert pihole.summary()["domainsOnGravity"] == 3_082_238
    assert fake_pihole.summary_calls == 2


def test_the_cache_expires(fake_pihole, monkeypatch):
    clock = Clock()
    monkeypatch.setattr(pihole, "_cache", TTLCache(clock=clock))
    pihole.summary()
    clock.t += pihole._SUMMARY_TTL + 0.1
    pihole.summary()
    assert fake_pihole.summary_calls == 2


def test_concurrent_pollers_share_one_read(fake_pihole):
    """Kiosk + phone + IoniBot arriving together on a cold cache: one request."""
    fake_pihole.summary_delay = 0.2
    results: list = []
    threads = [threading.Thread(target=lambda: results.append(pihole.summary())) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(5)
    assert len(results) == 8 and all(r and r["domainsOnGravity"] == 151_234 for r in results)
    assert fake_pihole.summary_calls == 1


def test_a_load_that_started_before_an_invalidation_is_not_kept():
    """The race that would let the cache hide a write the agent just made."""
    cache = TTLCache()
    gate = threading.Event()
    loaded = threading.Event()

    def slow_loader():
        loaded.set()
        gate.wait(5)
        return "pre-write value"

    t = threading.Thread(target=lambda: cache.get("k", slow_loader, 60))
    t.start()
    loaded.wait(5)
    cache.invalidate()          # a write lands while the read is in flight
    gate.set()
    t.join(5)
    assert cache.peek("k") is None, "a value read before the write must not be served after it"
    assert cache.get("k", lambda: "post-write value", 60) == "post-write value"


def test_writes_invalidate_the_cache(fake_pihole):
    """apply() - any outcome - leaves the next read fresh."""
    pihole.summary()
    blocklists.apply({"enabled": False, "threat_level": "low", "categories": []})
    before = fake_pihole.summary_calls
    pihole.summary()
    assert fake_pihole.summary_calls == before + 1


# ----------------------------------------------------------------- sessions


def test_one_session_serves_many_requests(fake_pihole):
    for _ in range(5):
        pihole.invalidate_cache()
        assert pihole.summary() is not None
    assert fake_pihole.auth_calls == 1


def test_a_dropped_session_is_replaced_once_and_silently(fake_pihole):
    assert pihole.summary() is not None
    fake_pihole.restart()                     # FTL restarted: every SID is now invalid
    pihole.invalidate_cache()
    assert pihole.summary() is not None, "one silent re-auth must hide a server-side restart"
    assert fake_pihole.auth_calls == 2


def test_concurrent_401s_create_one_session_not_one_each(fake_pihole):
    """Ten pollers hitting a restarted Pi-hole must not each take a seat."""
    assert pihole.api_get("/api/lists") is not None
    fake_pihole.restart()
    errors: list = []

    def call():
        if pihole.api_get("/api/lists") is None:
            errors.append("failed")

    threads = [threading.Thread(target=call) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(5)
    assert not errors
    # 1 original + at most a couple of re-auths under a genuine race - never ten.
    assert fake_pihole.auth_calls <= 3, f"{fake_pihole.auth_calls} logins for one agent"
    assert len(fake_pihole.sessions) <= 2


def test_a_lapsed_session_is_logged_out_when_replaced(fake_pihole, monkeypatch):
    pihole.api_get("/api/lists")
    old = pihole._sid
    monkeypatch.setattr(pihole, "_sid_expires", 0.0)   # our record lapsed (long idle)
    pihole.api_get("/api/lists")
    assert pihole._sid != old
    assert old in fake_pihole.deleted_sessions, "the replaced session must give its seat back"


def test_logout_gives_the_seat_back(fake_pihole):
    pihole.api_get("/api/lists")
    sid = pihole._sid
    pihole.logout()
    assert sid in fake_pihole.deleted_sessions
    assert pihole._sid is None
    assert sid not in fake_pihole.sessions


def test_blocklist_writes_survive_a_dropped_session(fake_pihole):
    """The old blocklists._post had no 401 handling: a session Pi-hole had
    dropped made every list write read as 'Pi-hole rejected <url>'."""
    pihole.api_get("/api/lists")
    fake_pihole.restart()
    assert blocklists._post("/api/lists?type=block", {"address": "https://example.org/l.txt"}) is not None


# ------------------------------------------------------------ named failures


def test_out_of_seats_is_named_and_backs_off(fake_pihole):
    fake_pihole.max_sessions = 0
    r = pihole.request("GET", "/api/stats/summary")
    assert r.failure == pihole.FAIL_NO_SEATS
    assert "API seat" in pihole.gap_for(r.failure, "x")
    pihole.request("GET", "/api/stats/summary")
    assert fake_pihole.auth_calls == 1, "a refused login must not be retried on every poll"


def test_wrong_password_is_named(fake_pihole, monkeypatch):
    fake_pihole.password = "something-else"
    r = pihole.request("GET", "/api/stats/summary")
    assert r.failure == pihole.FAIL_AUTH_REFUSED
    assert "refused this box's password" in pihole.gap_for(r.failure, "x")


def test_no_password_configured_is_named_without_hammering_auth(fake_pihole, monkeypatch):
    import dataclasses

    monkeypatch.setattr(pihole, "config", dataclasses.replace(pihole.config, pihole_password=None))
    r = pihole.request("GET", "/api/stats/summary")
    assert r.failure == pihole.FAIL_NO_PASSWORD
    assert "GATEFLAME_PIHOLE_PASSWORD" in pihole.gap_for(r.failure, "x")
    assert fake_pihole.auth_calls == 0


def test_not_configured_is_named(monkeypatch):
    import dataclasses

    monkeypatch.setattr(pihole, "config", dataclasses.replace(pihole.config, pihole_api_url=None))
    r = pihole.request("GET", "/api/stats/summary")
    assert r.failure == pihole.FAIL_UNCONFIGURED
    assert "not configured" in pihole.gap_for(r.failure, "x")


def test_unreachable_is_named(fake_pihole):
    fake_pihole.raise_on = "/api"
    r = pihole.request("GET", "/api/stats/summary")
    assert r.failure == pihole.FAIL_UNREACHABLE
    assert "did not answer" in pihole.gap_for(r.failure, "x")


def test_telemetry_gap_says_which_failure(fake_pihole, monkeypatch):
    """'Not configured' and 'did not answer' need opposite actions (CLAUDE.md)."""
    import dataclasses

    monkeypatch.setattr(telemetry, "host_snapshot", lambda: {"uptimeSeconds": 1})
    fake_pihole.raise_on = "/api"
    assert "did not answer" in telemetry.telemetry_summary()["gap"]
    monkeypatch.setattr(pihole, "config", dataclasses.replace(pihole.config, pihole_api_url=None))
    pihole.invalidate_cache()
    assert "not configured" in telemetry.telemetry_summary()["gap"]


@pytest.mark.parametrize("status", [500, 503])
def test_http_errors_are_named_with_pihole_message(fake_pihole, status):
    fake_pihole.fail_with = status
    r = pihole.request("GET", "/api/stats/summary")
    assert r.failure == pihole.FAIL_HTTP and r.status == status
    assert "forced failure" in (r.detail or "")


def test_request_uses_the_documented_header(fake_pihole):
    """X-FTL-SID - not a bare `sid` header (BUG-18)."""
    seen: list = []

    def spy(request: httpx.Request) -> httpx.Response:
        seen.append(dict(request.headers))
        return fake_pihole.handler(request)

    pihole._transport = httpx.MockTransport(spy)
    assert pihole.api_get("/api/lists") is not None
    assert any("x-ftl-sid" in h for h in seen)
    assert not any("sid" in h for h in seen)
