# ========================================================================================
# GATE^FLAME FLEET - HISTORY MUST NOT LOSE ITS MOST RECENT WEEK
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# Two rollup defects from the 2026-09-21 audit:
#
#   * node_history(window=30d|90d) read samples_hourly only. Hourly rows exist only
#     for samples OLDER than the raw window, so the newest seven days - the week an
#     operator is actually diagnosing - were simply absent from long charts.
#   * _rollup_and_prune used a moving mid-hour cutoff: the straddling hour was
#     inserted as a partial average, ON CONFLICT DO NOTHING then refused the rest,
#     and the DELETE removed the source rows. Every boundary bucket was biased.
#
# Runs against a throwaway sqlite file; no network, no auth server.
# ========================================================================================

import base64
import os
import sqlite3
import time

import pytest

os.environ.setdefault("GATEFLAME_FLEET_ADMIN_PASSWORD", "test-pw")


@pytest.fixture()
def fleet(tmp_path, monkeypatch):
    import app  # noqa: WPS433 - the module under test reads env at import

    monkeypatch.setattr(app, "DB_PATH", str(tmp_path / "fleet.db"))
    monkeypatch.setattr(app, "ADMIN_PASSWORD", "test-pw")
    app.init_db()
    return app


def _auth():
    return "Basic " + base64.b64encode(b"admin:test-pw").decode()


def _insert_sample(app, node, at, cpu):
    with app.db() as conn:
        conn.execute(
            "INSERT INTO samples (node_id, at, cpu, mem_used, mem_total, disk, temp, pihole_ok) "
            "VALUES (?, ?, ?, 50, 100, 10, 40, 1)",
            (node, at, cpu),
        )


def test_30d_history_includes_the_raw_week(fleet):
    now = time.time()
    node = "GF-TEST"
    # One hourly row 20 days ago (rolled-up era) and one raw sample 1 hour ago.
    with fleet.db() as conn:
        conn.execute(
            "INSERT INTO samples_hourly (node_id, hour, cpu, mem_pct, disk, temp, pihole_ok_pct, sample_count) "
            "VALUES (?, ?, 10, 50, 10, 40, 100, 12)",
            (node, int((now - 20 * 86400) // 3600)),
        )
    _insert_sample(fleet, node, now - 3600, cpu=90)

    resp = fleet.node_history(node, window="30d", authorization=_auth())
    import json
    body = json.loads(resp.body)
    assert body["resolution"] == "hourly averages"
    ts = [p["t"] for p in body["points"]]
    assert any(t < now - 19 * 86400 for t in ts), "old hourly point missing"
    assert any(t > now - 2 * 86400 for t in ts), "the most recent week was dropped from the 30d chart"
    # And the recent point carries the raw sample's value, averaged per hour.
    recent = [p for p in body["points"] if p["t"] > now - 2 * 86400]
    assert recent[-1]["cpu"] == 90


def test_rollup_only_folds_whole_hours_and_keeps_partial_hour_raw(fleet):
    node = "GF-TEST"
    now = time.time()
    cutoff_hour = int((now - fleet.RAW_RETENTION_DAYS * 86400) // 3600)
    # Two samples in the hour just BELOW the cutoff hour (must be rolled up, both),
    # two in the cutoff hour itself (must stay raw - the hour is not over yet from
    # the rollup's point of view).
    below = cutoff_hour * 3600 - 1800
    _insert_sample(fleet, node, below - 600, cpu=10)
    _insert_sample(fleet, node, below + 600, cpu=30)
    within = cutoff_hour * 3600 + 600
    _insert_sample(fleet, node, within, cpu=70)
    _insert_sample(fleet, node, within + 600, cpu=90)

    fleet._rollup_and_prune()

    with fleet.db() as conn:
        hourly = conn.execute(
            "SELECT hour, cpu, sample_count FROM samples_hourly WHERE node_id=? ORDER BY hour", (node,)
        ).fetchall()
        raw = conn.execute("SELECT at, cpu FROM samples WHERE node_id=? ORDER BY at", (node,)).fetchall()

    assert [(r["hour"], r["cpu"], r["sample_count"]) for r in hourly] == [(cutoff_hour - 1, 20.0, 2)]
    assert [r["cpu"] for r in raw] == [70, 90], "the partial hour must not be pruned before it is complete"


def test_rollup_is_idempotent_across_runs(fleet):
    """Running twice must not change what a bucket says."""
    node = "GF-TEST"
    now = time.time()
    cutoff_hour = int((now - fleet.RAW_RETENTION_DAYS * 86400) // 3600)
    base = (cutoff_hour - 2) * 3600
    for i, cpu in enumerate((10, 20, 30)):
        _insert_sample(fleet, node, base + i * 900, cpu=cpu)
    fleet._rollup_and_prune()
    fleet._rollup_and_prune()
    with fleet.db() as conn:
        rows = conn.execute("SELECT cpu, sample_count FROM samples_hourly WHERE node_id=?", (node,)).fetchall()
    assert [(r["cpu"], r["sample_count"]) for r in rows] == [(20.0, 3)]
