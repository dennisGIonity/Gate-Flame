"""GET /api/v1/history/system - the on-box 60 s sampler and its SQLite store.

Invariants:
  * raw rows are kept 48 h, hourly averages 90 days;
  * rollup and prune both work on WHOLE HOURS - the boundary bug fleet/app.py
    `_rollup_and_prune` already had once (a mid-hour cutoff rolled up a partial
    hour and deleted the rest of it, biasing that bucket permanently);
  * 24h = 5-minute averages, 7d = hourly, 30d = 3-hourly (weighted by samples);
  * `since` is the first sample EVER and survives pruning;
  * an unwritable data root turns the sampler off and the route into a named gap,
    never an exception;
  * nothing samples during pytest unless a test starts it.
"""

from __future__ import annotations

import os
import threading

import pytest
from fastapi.testclient import TestClient

from gateflame import main, system_history
from gateflame.system_history import HOURLY_RETENTION_SECONDS, RAW_RETENTION_SECONDS, SystemHistory

H = 3600
T0 = 1_790_000_000 - 1_790_000_000 % H      # an hour boundary


@pytest.fixture
def store(tmp_path):
    s = SystemHistory(str(tmp_path / "history" / "system.db"))
    assert s.open()
    yield s
    s.close()


def fill_hour(s: SystemHistory, hour_start: int, cpu: float, every: int = 60):
    for t in range(hour_start, hour_start + H, every):
        s.record(t, cpu, 50.0, 45.0, 20.0)


# -------------------------------------------------------------------- 24h


def test_24h_is_five_minute_averages(store):
    now = T0 + 10 * H
    for i, t in enumerate(range(now - 600, now, 60)):     # 10 samples, two 5-min buckets
        store.record(t, float(i), 40.0, None, 10.0)
    pts = store.points("24h", now)
    assert [p["t"] for p in pts] == [now - 600, now - 300]
    assert pts[0]["cpu"] == 2.0 and pts[1]["cpu"] == 7.0     # mean of 0..4 and 5..9
    assert pts[0]["tempC"] is None, "an unreadable sensor is null, never 0"
    assert pts[0]["memPct"] == 40.0 and pts[0]["diskPct"] == 10.0


def test_24h_only_reaches_back_24_hours(store):
    now = T0 + 30 * H
    store.record(now - 25 * H, 99.0, 1, 1, 1)
    store.record(now - 60, 1.0, 1, 1, 1)
    assert [p["cpu"] for p in store.points("24h", now)] == [1.0]


# ------------------------------------------------------------ rollup/prune


def test_ended_hours_are_rolled_up_and_the_current_hour_is_not(store):
    fill_hour(store, T0, 10.0)
    store.record(T0 + H + 30, 90.0, 1, 1, 1)                  # the current, unfinished hour
    store.rollup_and_prune(T0 + H + 60)
    with store._tx() as conn:
        rows = conn.execute("SELECT hour, cpu, n FROM hourly ORDER BY hour").fetchall()
    assert rows == [(T0 // H, 10.0, 60)]


def test_the_48h_boundary_hour_is_never_averaged_from_half_its_rows(store):
    """NON-VACUITY for the fleet boundary bug.

    Run the rollup when now-48h falls in the MIDDLE of an hour, then again a
    minute later. With a mid-hour prune cutoff the first pass deletes the first
    half of that hour's raw rows, and the second pass recomputes the hour from
    the half that is left: the average moves. Whole-hour cutoffs keep it exact.
    """
    boundary_hour = T0
    for t in range(boundary_hour, boundary_hour + H, 60):
        # first half 0 %, second half 100 %: the true hourly mean is 50 %
        store.record(t, 0.0 if t < boundary_hour + H // 2 else 100.0, 1, 1, 1)
    now = boundary_hour + RAW_RETENTION_SECONDS + H // 2      # now-48h = mid boundary hour
    store.rollup_and_prune(now)
    store.rollup_and_prune(now + 60)
    with store._tx() as conn:
        (cpu, n) = conn.execute("SELECT cpu, n FROM hourly WHERE hour = ?", (boundary_hour // H,)).fetchone()
    assert (cpu, n) == (50.0, 60)


def test_raw_rows_go_after_48h_on_whole_hours_and_hourly_after_90_days(store):
    fill_hour(store, T0, 5.0)
    store.rollup_and_prune(T0 + H + 1)
    later = T0 + RAW_RETENTION_SECONDS + 2 * H
    store.rollup_and_prune(later)
    with store._tx() as conn:
        assert conn.execute("SELECT COUNT(*) FROM samples").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM hourly").fetchone()[0] == 1
    store.rollup_and_prune(T0 + HOURLY_RETENTION_SECONDS + 2 * H)
    with store._tx() as conn:
        assert conn.execute("SELECT COUNT(*) FROM hourly").fetchone()[0] == 0


def test_since_is_the_first_sample_ever_and_survives_pruning(store):
    store.record(T0 + 5, 1, 1, 1, 1)
    store.record(T0 + 65, 1, 1, 1, 1)
    store.rollup_and_prune(T0 + HOURLY_RETENTION_SECONDS + 10 * H)
    assert store.first_sample_at() == T0 + 5


# ------------------------------------------------------------- 7d and 30d


def test_7d_is_hourly_and_includes_the_hour_in_progress(store):
    now = T0 + 5 * H + 1800
    fill_hour(store, T0 + 3 * H, 20.0)
    fill_hour(store, T0 + 4 * H, 40.0)
    store.record(T0 + 5 * H + 60, 80.0, 1, 1, 1)             # in progress
    pts = store.points("7d", now)                            # reading triggers the rollup
    assert [(p["t"], p["cpu"]) for p in pts] == [
        (T0 + 3 * H, 20.0), (T0 + 4 * H, 40.0), (T0 + 5 * H, 80.0),
    ]


def test_30d_is_three_hourly_and_weighted_by_samples(store):
    start = T0 - T0 % (3 * H)
    fill_hour(store, start, 10.0, every=60)            # 60 samples at 10 %
    fill_hour(store, start + H, 40.0, every=600)       # 6 samples at 40 %
    now = start + 5 * H
    pts = store.points("30d", now)
    assert len(pts) == 1 and pts[0]["t"] == start
    # weighted: (60*10 + 6*40) / 66 = 12.7 ; an unweighted mean of means would say 25.0
    assert pts[0]["cpu"] == 12.7


def test_point_counts_stay_within_the_contract(store):
    now = T0 + 40 * 86_400
    with store._tx() as conn:
        conn.executemany("INSERT INTO hourly (hour, cpu, mem, temp, disk, n) VALUES (?, 1, 1, 1, 1, 60)",
                         [((now // H) - k,) for k in range(1, 35 * 24)])
    assert len(store.points("7d", now)) <= 169
    assert len(store.points("30d", now)) <= 241


# ---------------------------------------------------------- failure modes


def test_an_unwritable_root_is_a_gap_not_a_crash(tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("a file where the history folder should be")
    s = SystemHistory(str(blocker / "system.db"))
    assert s.open() is False
    assert "unavailable" in s.gap
    sampler = system_history.SystemSampler(s, interval=0.01)
    assert sampler.start() is False
    assert not sampler.running


def test_route_reports_the_gap_for_an_unusable_store(tmp_path, monkeypatch):
    blocker = tmp_path / "blocker"
    blocker.write_text("x")
    system_history.init(str(blocker / "system.db"))
    try:
        out = system_history.history("24h")
        assert out["points"] == [] and out["gap"] and out["since"] is None
    finally:
        system_history.init(None)


def test_route_says_when_the_sampler_is_not_running(tmp_path):
    system_history.init(str(tmp_path / "h" / "system.db"))
    try:
        out = system_history.history("24h")
        assert out["sampling"] is False
        assert "not running" in out["gap"]
    finally:
        system_history.init(None)


# ---------------------------------------------------------------- sampler


def test_a_tick_records_one_sample(store):
    readings = iter([(12.5, 41.0, 52.3, 18.2)])
    sampler = system_history.SystemSampler(store, reader=lambda: next(readings), clock=lambda: T0 + 30)
    sampler.tick()
    with store._tx() as conn:
        assert conn.execute("SELECT t, cpu, mem, temp, disk FROM samples").fetchall() == [
            (T0 + 30, 12.5, 41.0, 52.3, 18.2)
        ]


def test_the_sampler_thread_samples_and_stops_cleanly(store):
    seen = threading.Event()
    calls: list = []

    def reader():
        calls.append(1)
        seen.set()
        return (1.0, 2.0, 3.0, 4.0)

    sampler = system_history.SystemSampler(store, interval=1.0, reader=reader)
    sampler.interval = 0.02          # below the production floor, for the test only
    assert sampler.start()
    assert seen.wait(5)
    sampler.stop()
    assert not sampler.running
    n = len(calls)
    threading.Event().wait(0.1)
    assert len(calls) == n, "a stopped sampler must not keep sampling"


def test_no_sampler_runs_under_pytest_by_default():
    """conftest.py sets GATEFLAME_HISTORY_SAMPLER=false, and the lifespan honours it."""
    assert main.config.history_sampler_enabled is False
    with TestClient(main.app, client=("127.0.0.1", 51000)):
        assert not any(t.name == "gateflame-history" for t in threading.enumerate())
    assert system_history.sampling() is False


def test_route_contract_and_window_validation(tmp_path):
    system_history.init(str(tmp_path / "h" / "system.db"))
    try:
        c = TestClient(main.app, client=("127.0.0.1", 51000))
        body = c.get("/api/v1/history/system?window=7d").json()
        assert set(body) >= {"window", "stepSeconds", "resolution", "points", "since", "gap"}
        assert body["window"] == "7d" and body["stepSeconds"] == 3600
        assert c.get("/api/v1/history/system?window=90d").status_code == 400
        lan = TestClient(main.app, client=("192.168.1.50", 51000))
        assert lan.get("/api/v1/history/system").status_code == 401
    finally:
        system_history.init(None)


def test_the_default_store_lives_under_the_data_root(monkeypatch, tmp_path):
    monkeypatch.setenv("GATEFLAME_DATA_ROOT", str(tmp_path / ".DUMP"))
    assert system_history.db_path() == os.path.join(str(tmp_path / ".DUMP"), "history", "system.db").replace("\\", "/")
