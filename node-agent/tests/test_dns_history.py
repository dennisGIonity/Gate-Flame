"""GET /api/v1/dns/history - Pi-hole's own history, reshaped, cached, never a 500.

Field names and semantics checked against FTL v6.7.1 (api-docs.tar.gz and
src/api/history.c, src/api/stats_database.c, src/overTime.c):

  /api/history           10-minute slots, timestamp = slot CENTRE (start + 300)
  /api/history/database  fixed 600 s slots, timestamp = slot START, empty slots ABSENT
"""

from __future__ import annotations

import dataclasses
import time

import pytest
from fastapi.testclient import TestClient

from gateflame import dns_history, main, pihole
from gateflame.ttlcache import TTLCache


def _slot(start: int, total: int, blocked: int = 0, cached: int = 0, forwarded: int = 0, centre=False):
    return {"timestamp": start + (300.0 if centre else 0), "total": total, "blocked": blocked,
            "cached": cached, "forwarded": forwarded}


@pytest.fixture
def client():
    return TestClient(main.app, client=("127.0.0.1", 51000))   # loopback = kiosk scope


# ------------------------------------------------------------------ 24 hours


def test_24h_passes_pihole_slots_through_as_slot_starts(fake_pihole):
    now = int(time.time())
    base = now - now % 600 - 3600
    fake_pihole.history_payload = {"history": [
        _slot(base, 120, 14, 40, 66, centre=True),
        _slot(base + 600, 80, 8, 30, 42, centre=True),
    ]}
    out = dns_history.history("24h")
    assert out["window"] == "24h" and out["stepSeconds"] == 600
    assert out["resolution"] == "10 minute totals" and out["source"] == "pihole"
    assert out["gap"] is None
    assert out["points"] == [
        {"t": base, "total": 120, "blocked": 14, "cached": 40, "forwarded": 66},
        {"t": base + 600, "total": 80, "blocked": 8, "cached": 30, "forwarded": 42},
    ]


def test_24h_drops_slots_older_than_the_window(fake_pihole):
    now = int(time.time())
    fake_pihole.history_payload = {"history": [
        _slot(now - 3 * 86_400, 5), _slot(now - now % 600, 7),
    ]}
    points = dns_history.history("24h")["points"]
    assert [p["total"] for p in points] == [7]


# ------------------------------------------------------------ 7 and 30 days


def test_7d_rebuckets_into_hourly_totals_and_stays_sparse(fake_pihole):
    now = int(time.time())
    hour = now - now % 3600 - 5 * 3600
    fake_pihole.database_payload = {"history": [
        _slot(hour, 10, 1, 2, 7), _slot(hour + 600, 20, 2, 3, 15), _slot(hour + 3000, 5, 0, 1, 4),
        # nothing at all in hour+1 (the box was off) - then hour+2
        _slot(hour + 7200, 9, 9, 0, 0),
    ]}
    out = dns_history.history("7d")
    assert out["stepSeconds"] == 3600 and out["resolution"] == "1 hour totals"
    assert out["points"] == [
        {"t": hour, "total": 35, "blocked": 3, "cached": 6, "forwarded": 26},
        {"t": hour + 7200, "total": 9, "blocked": 9, "cached": 0, "forwarded": 0},
    ], "an hour with nothing stored must be ABSENT, not a zero"
    q = fake_pihole.database_queries[-1]
    assert int(q["until"]) - int(q["from"]) == 7 * 86_400


def test_30d_uses_six_hour_buckets_and_at_most_121_points(fake_pihole):
    now = int(time.time())
    start = now - 30 * 86_400
    fake_pihole.database_payload = {"history": [
        _slot(t, 1) for t in range(start - start % 600, now, 600)
    ]}
    out = dns_history.history("30d")
    assert out["stepSeconds"] == 21_600
    assert len(out["points"]) <= 121
    assert all(p["t"] % 21_600 == 0 for p in out["points"])
    assert sum(p["total"] for p in out["points"]) == len(fake_pihole.database_payload["history"])


def test_rebucket_keeps_unknown_as_unknown():
    slots = [{"t": 0, "total": 3, "blocked": None, "cached": 1, "forwarded": None},
             {"t": 600, "total": 2, "blocked": None, "cached": None, "forwarded": 1}]
    (b,) = dns_history.rebucket(slots, 3600)
    assert b == {"t": 0, "total": 5, "blocked": None, "cached": 1, "forwarded": 1}


# -------------------------------------------------------------- named gaps


def test_unconfigured_is_a_named_gap_not_an_empty_chart(monkeypatch):
    monkeypatch.setattr(pihole, "config", dataclasses.replace(pihole.config, pihole_api_url=None))
    monkeypatch.setattr(dns_history, "_cache", TTLCache())
    out = dns_history.history("24h")
    assert out["points"] == []
    assert "not configured" in out["gap"]


def test_unreachable_is_its_own_gap(fake_pihole):
    fake_pihole.raise_on = "/api"
    out = dns_history.history("7d")
    assert out["points"] == [] and "did not answer" in out["gap"]


def test_refused_password_is_its_own_gap(fake_pihole):
    fake_pihole.password = "other"
    out = dns_history.history("24h")
    assert out["points"] == [] and "refused this box's password" in out["gap"]


def test_a_payload_that_is_not_history_is_a_gap(fake_pihole):
    fake_pihole.history_payload = {"history": "not a list"}
    out = dns_history.history("24h")
    assert out["points"] == [] and "does not understand" in out["gap"]


# ------------------------------------------------------------------ caching


def test_24h_is_cached_for_a_minute_and_long_windows_for_ten(fake_pihole, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(dns_history, "_cache", TTLCache(clock=lambda: now[0]))
    dns_history.history("24h")
    dns_history.history("7d")
    calls = len(fake_pihole.calls)
    now[0] += 59
    dns_history.history("24h")
    dns_history.history("7d")
    assert len(fake_pihole.calls) == calls, "inside both TTLs: no new Pi-hole reads"
    now[0] += 2                     # 61 s: 24h is stale, 7d is not
    dns_history.history("24h")
    dns_history.history("7d")
    assert sum(1 for m, u in fake_pihole.calls[calls:] if "/api/history" in u and "database" not in u) == 1
    assert not any("database" in u for m, u in fake_pihole.calls[calls:])


def test_a_failure_is_retried_after_ten_seconds_not_ten_minutes(fake_pihole, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(dns_history, "_cache", TTLCache(clock=lambda: now[0]))
    fake_pihole.raise_on = "/api/history"
    assert dns_history.history("30d")["gap"]
    fake_pihole.raise_on = None
    now[0] += 11
    assert dns_history.history("30d")["gap"] is None


# -------------------------------------------------------------------- route


def test_route_contract(fake_pihole, client):
    r = client.get("/api/v1/dns/history?window=24h")
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"window", "stepSeconds", "resolution", "source", "points", "gap"}


def test_route_default_window_is_24h(fake_pihole, client):
    assert client.get("/api/v1/dns/history").json()["window"] == "24h"


def test_route_rejects_an_unknown_window(client):
    r = client.get("/api/v1/dns/history?window=1y")
    assert r.status_code == 400
    assert set(r.json()["detail"]["allowed"]) == {"24h", "7d", "30d"}


def test_route_never_500s(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(dns_history, "_cache", TTLCache())
    monkeypatch.setattr(dns_history.pihole, "request", boom)
    r = client.get("/api/v1/dns/history?window=7d")
    assert r.status_code == 200
    assert r.json()["points"] == [] and r.json()["gap"]


def test_route_needs_read_scope():
    lan = TestClient(main.app, client=("192.168.1.50", 51000))
    assert lan.get("/api/v1/dns/history").status_code == 401
