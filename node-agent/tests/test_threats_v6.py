"""Pin the Pi-hole v6 threat log against the shape the real box returns.

The fixture below is a verbatim excerpt of `GET /api/queries?length=2` from the
live node (GF-72TYTITQ, 192.168.0.10, `pihole/pihole:latest`) on 2026-08-17 —
not a shape invented to match the parser. That matters: the bug this replaces
existed precisely because the parser was written against a remembered API and
never met a response.
"""

from __future__ import annotations

import dataclasses

import gateflame.threats as threats
from gateflame.config import config

# Verbatim from the live node, plus two blocked rows to exercise the filter.
LIVE_SAMPLE = {
    "queries": [
        {
            "id": 3025,
            "time": 1786968066.970423,
            "type": "A",
            "status": "CACHE",
            "dnssec": "UNKNOWN",
            "domain": "www.google.com",
            "upstream": None,
            "reply": {"type": "IP", "time": 2.0265579223632812e-05},
            "client": {"ip": "192.168.0.5", "name": None},
            "list_id": None,
            "ede": {"code": -1, "text": None},
            "cname": None,
        },
        {
            "id": 3024,
            "time": 1786968053.6739995,
            "type": "A",
            "status": "GRAVITY",
            "dnssec": "UNKNOWN",
            "domain": "doubleclick.net",
            "upstream": None,
            "reply": {"type": "CNAME", "time": 1.621246337890625e-05},
            "client": {"ip": "192.168.0.6", "name": "phone.lan"},
            "list_id": 4,
            "ede": {"code": -1, "text": None},
            "cname": None,
        },
        {
            "id": 3023,
            "time": 1786968050.1,
            "type": "AAAA",
            "status": "FORWARDED",
            "domain": "github.com",
            "client": {"ip": "192.168.0.7", "name": None},
        },
        {
            "id": 3022,
            "time": 1786968049.0,
            "type": "A",
            "status": "DENYLIST_CNAME",
            "domain": "ads.example.net",
            "client": {"ip": "192.168.0.6", "name": None},
        },
    ]
}


def _patch(monkeypatch, payload, url="http://127.0.0.1:8081"):
    """`Config` is a frozen dataclass, so swap the whole object, not a field.

    Replacing rather than mutating is also the honest test: production never
    mutates config either — it is read once from the environment at import.
    """
    monkeypatch.setattr(
        threats, "config", dataclasses.replace(config, pihole_api_url=url)
    )
    monkeypatch.setattr(threats.pihole, "api_get", lambda path: payload)


def test_returns_only_blocked_queries(monkeypatch):
    """A cached lookup of www.google.com is not a threat and must not appear."""
    _patch(monkeypatch, LIVE_SAMPLE)
    result = threats.recent(limit=10)

    domains = [e["domain"] for e in result["entries"]]
    assert domains == ["doubleclick.net", "ads.example.net"]
    assert "www.google.com" not in domains
    assert "github.com" not in domains


def test_maps_the_real_v6_field_names(monkeypatch):
    # The v5 parser read row[0]/row[2]/row[3]/row[4] and the old frontend read
    # `severity` and `sourceIp`. Neither exists. These are the real names.
    _patch(monkeypatch, LIVE_SAMPLE)
    entry = threats.recent(limit=10)["entries"][0]

    assert entry["timestamp"] == 1786968053.6739995
    assert entry["domain"] == "doubleclick.net"
    assert entry["clientIp"] == "192.168.0.6"
    assert entry["clientName"] == "phone.lan"
    assert entry["queryType"] == "A"
    assert entry["status"] == "GRAVITY"
    assert entry["action"] == "Blocked"
    assert entry["blocked"] is True


def test_counts_are_reported_so_the_ui_can_be_specific(monkeypatch):
    _patch(monkeypatch, LIVE_SAMPLE)
    result = threats.recent(limit=10)
    assert result["scanned"] == 4
    assert result["blockedInWindow"] == 2
    assert result["source"] == "pihole"
    assert "gap" not in result


def test_cname_and_future_block_statuses_count_as_blocked():
    """A fixed status list would silently reclassify new blocks as allowed."""
    for status in (
        "GRAVITY",
        "GRAVITY_CNAME",
        "DENYLIST",
        "DENYLIST_CNAME",
        "REGEX",
        "REGEX_CNAME",
        "EXTERNAL_BLOCKED_IP",
        "EXTERNAL_BLOCKED_NXRA",
        "EXTERNAL_BLOCKED_EDE15",
        "SPECIAL_DOMAIN",
    ):
        assert threats._is_blocked(status), status

    for status in ("CACHE", "FORWARDED", "CACHE_STALE", "RETRIED", "UNKNOWN", "", None):
        assert not threats._is_blocked(status), status


def test_limit_caps_entries_but_not_the_count(monkeypatch):
    """Truncating the list must not truncate the truth about how many there were."""
    _patch(monkeypatch, LIVE_SAMPLE)
    result = threats.recent(limit=1)
    assert len(result["entries"]) == 1
    assert result["blockedInWindow"] == 2


def test_unconfigured_names_the_gap_and_invents_nothing(monkeypatch):
    monkeypatch.setattr(
        threats, "config", dataclasses.replace(config, pihole_api_url=None)
    )
    result = threats.recent()
    assert result["entries"] == []
    assert result["source"] == "none"
    assert "no threat data source configured" in result["gap"]


def test_api_failure_is_a_named_gap_not_an_empty_success(monkeypatch):
    # The distinction that matters: "nothing was blocked" and "we could not ask"
    # must never render the same way.
    _patch(monkeypatch, None)
    result = threats.recent()
    assert result["entries"] == []
    assert "authenticated" in result["gap"]


def test_malformed_payload_does_not_raise(monkeypatch):
    _patch(monkeypatch, {"queries": "not-a-list"})
    assert threats.recent()["gap"] == "Pi-hole returned no query list"

    _patch(monkeypatch, {"queries": [None, 42, {"status": "GRAVITY", "domain": "x.test"}]})
    result = threats.recent()
    assert [e["domain"] for e in result["entries"]] == ["x.test"]
    assert result["entries"][0]["clientIp"] is None
