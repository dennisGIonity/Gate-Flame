"""On-box anomaly detection: deterministic, honest about attribution, no I/O in
the scorer.

Each detector gets a positive and a negative case, and each negative case is
one that a naive threshold would get wrong (a chatty-but-normal TV, a short
brand name, a first run with no baseline).
"""

from __future__ import annotations

import dataclasses

import pytest

from gateflame import anomaly, datadir
from gateflame.anomaly import Baseline, ClientBaseline


NOW = 1_800_000_000.0


def q(domain, ip="192.168.0.20", status="FORWARDED", t=None, reply=None):
    row = {"time": NOW - 10 if t is None else t, "domain": domain, "status": status,
           "client": {"ip": ip, "name": None}}
    if reply:
        row["reply"] = {"type": reply}
    return row


# ------------------------------------------------------------- label parsing


def test_registrable_label_handles_two_part_suffixes():
    assert anomaly.registrable_label("www.ionity.co.za") == "ionity"
    assert anomaly.registrable_label("cdn.example.com") == "example"
    assert anomaly.registrable_label("localhost") is None
    assert anomaly.registrable_label("bad domain.com") is None
    assert anomaly.registrable_label("") is None


# ------------------------------------------------------------------ DGA score


@pytest.mark.parametrize("label", ["google", "ionity", "microsoft", "netflix", "samsungcloud",
                                   "doubleclick", "cloudflare", "wikipedia", "takealot"])
def test_human_names_score_low(label):
    assert anomaly.dga_score(label) < anomaly.DGA_THRESHOLD, (label, anomaly.dga_score(label))


@pytest.mark.parametrize("label", ["xk3j9fqz2lqw", "qzxvbnmkjhgfdsw", "a8f7g6h5j4k3l2m1",
                                   "pxrtkvzqbwmn", "w9x8y7z6q5p4"])
def test_machine_generated_names_score_high(label):
    assert anomaly.dga_score(label) >= anomaly.DGA_THRESHOLD, (label, anomaly.dga_score(label))


def test_short_labels_are_never_flagged():
    for label in ["bbc", "ibm", "x", "go", "qz9"]:
        assert anomaly.dga_score(label) == 0.0


def test_dga_score_is_deterministic():
    assert anomaly.dga_score("xk3j9fqz2lqw") == anomaly.dga_score("xk3j9fqz2lqw")


# ------------------------------------------------------------- score_window


def test_first_run_flags_nothing_by_burst_and_records_baseline():
    queries = [q("example.com") for _ in range(400)]
    findings, bl, stats = anomaly.score_window(queries, Baseline(), NOW)
    assert not [f for f in findings if f["kind"] == "query_burst"]
    assert bl.clients["192.168.0.20"].samples == 1
    assert bl.clients["192.168.0.20"].rate_ema == 400.0
    assert stats["baselineRuns"] == 1


def test_burst_is_scored_against_the_clients_own_baseline():
    bl = Baseline()
    bl.clients["192.168.0.20"] = ClientBaseline(rate_ema=40.0, rate_mad=3.0, samples=10, last_seen=NOW - 300)
    bl.clients["192.168.0.30"] = ClientBaseline(rate_ema=900.0, rate_mad=60.0, samples=10, last_seen=NOW - 300)
    queries = [q("example.com", ip="192.168.0.20") for _ in range(400)]
    queries += [q("tv.example", ip="192.168.0.30") for _ in range(950)]  # chatty TV, normal for it
    findings, _, _ = anomaly.score_window(queries, bl, NOW)
    bursts = [f for f in findings if f["kind"] == "query_burst"]
    assert [f["clientIp"] for f in bursts] == ["192.168.0.20"]
    assert bursts[0]["evidence"]["queriesInWindow"] == 400
    assert bursts[0]["evidence"]["usualPerWindow"] == 40.0


def test_a_burst_does_not_poison_its_own_baseline_before_scoring():
    bl = Baseline()
    bl.clients["192.168.0.20"] = ClientBaseline(rate_ema=40.0, rate_mad=3.0, samples=10, last_seen=NOW - 300)
    queries = [q("example.com") for _ in range(400)]
    findings, bl2, _ = anomaly.score_window(queries, bl, NOW)
    assert any(f["kind"] == "query_burst" for f in findings)
    # EMA moved toward 400 but is nowhere near it: alpha 0.2.
    assert 100 < bl2.clients["192.168.0.20"].rate_ema < 130


def test_dga_domain_is_reported_with_evidence():
    queries = [q("xk3j9fqz2lqw.info", status="FORWARDED"), q("ionity.today")]
    findings, _, _ = anomaly.score_window(queries, Baseline(), NOW)
    dga = [f for f in findings if f["kind"] == "dga_like_domain"]
    assert len(dga) == 1
    assert dga[0]["domain"] == "xk3j9fqz2lqw.info"
    assert dga[0]["evidence"]["dgaScore"] >= anomaly.DGA_THRESHOLD
    assert "machine-generated" in dga[0]["summary"]
    assert "malware" not in dga[0]["summary"].lower()  # a reason to look, not a verdict


def test_nxdomain_storm_needs_both_volume_and_share():
    few = [q(f"try{i}.example", reply="NXDOMAIN") for i in range(10)]
    findings, _, _ = anomaly.score_window(few, Baseline(), NOW)
    assert not [f for f in findings if f["kind"] == "nxdomain_storm"]

    many = [q(f"try{i}.example", reply="NXDOMAIN") for i in range(40)] + [q("ok.example") for _ in range(20)]
    findings, _, _ = anomaly.score_window(many, Baseline(), NOW)
    storm = [f for f in findings if f["kind"] == "nxdomain_storm"]
    assert len(storm) == 1
    assert storm[0]["evidence"] == {"nxdomain": 40, "queries": 60, "share": 0.67}


def test_new_domain_spike_waits_for_a_warm_baseline():
    queries = [q(f"brand{i:03d}.example", ip="192.168.0.20") for i in range(40)]
    cold = Baseline()
    findings, _, _ = anomaly.score_window(queries, cold, NOW)
    assert not [f for f in findings if f["kind"] == "new_domain_spike"]

    warm = Baseline(runs=10)
    findings, _, _ = anomaly.score_window(queries, warm, NOW)
    spikes = [f for f in findings if f["kind"] == "new_domain_spike"]
    assert len(spikes) == 1
    assert spikes[0]["evidence"]["newSecondLevelDomains"] == 40


def test_queries_outside_the_window_are_ignored():
    old = [q("example.com", t=NOW - anomaly.WINDOW_SECONDS - 5) for _ in range(500)]
    _, _, stats = anomaly.score_window(old, Baseline(), NOW)
    assert stats["queriesInWindow"] == 0


def test_attribution_is_router_only_when_one_client_is_seen():
    """ADR-001: behind a forwarding router Pi-hole sees one address. The
    payload must say so rather than let the UI imply per-device insight."""
    _, _, stats = anomaly.score_window([q("a.example"), q("b.example")], Baseline(), NOW)
    assert stats["clientAttribution"] == "router-only"
    _, _, stats = anomaly.score_window([q("a.example", ip="10.0.0.1"), q("b.example", ip="10.0.0.2")], Baseline(), NOW)
    assert stats["clientAttribution"] == "per-device"


def test_baseline_round_trips_through_disk_and_prunes(tmp_path):
    p = str(tmp_path / "baseline.json")
    bl = Baseline()
    for i in range(anomaly.BASELINE_MAX_CLIENTS + 20):
        bl.clients[f"10.0.{i // 250}.{i % 250}"] = ClientBaseline(rate_ema=1, rate_mad=0, samples=1, last_seen=i)
    bl.prune()
    assert len(bl.clients) == anomaly.BASELINE_MAX_CLIENTS
    assert bl.save(p) is True
    again = Baseline.load(p)
    assert len(again.clients) == anomaly.BASELINE_MAX_CLIENTS
    assert Baseline.load(str(tmp_path / "missing.json")).runs == 0


# ---------------------------------------------------------------------- run


def test_run_without_pihole_reports_a_gap_not_an_all_clear(tmp_path, monkeypatch):
    monkeypatch.setenv("GATEFLAME_DATA_ROOT", str(tmp_path / ".DUMP"))
    datadir.ensure()
    monkeypatch.setattr(anomaly, "config", dataclasses.replace(anomaly.config, pihole_api_url=None))
    r = anomaly.run(NOW)
    assert r["gap"]
    assert r["findings"] == []
    assert r["stats"] is None
    assert anomaly.last()["gap"] == r["gap"]


def test_run_reads_pihole_scores_and_persists(tmp_path, monkeypatch):
    monkeypatch.setenv("GATEFLAME_DATA_ROOT", str(tmp_path / ".DUMP"))
    datadir.ensure()
    monkeypatch.setattr(anomaly, "config", dataclasses.replace(anomaly.config, pihole_api_url="http://127.0.0.1"))
    monkeypatch.setattr(anomaly.pihole, "api_get", lambda path: {"queries": [q("xk3j9fqz2lqw.info"), q("ionity.today")]})
    r = anomaly.run(NOW)
    assert r["gap"] is None
    assert any(f["kind"] == "dga_like_domain" for f in r["findings"])
    assert r["stats"]["baselinePersisted"] is True
    assert (tmp_path / ".DUMP" / "ml" / "baseline.json").is_file()
    assert (tmp_path / ".DUMP" / "history" / "anomaly.jsonl").is_file()
    assert "not verdicts" in r["notice"]
