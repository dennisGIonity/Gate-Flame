"""What the health feed does and does not send.

The feed carries a device identifier now - MAC and owner-chosen name, per
Shield-configured device - by an explicit product decision. That makes these
tests load-bearing in two directions at once:

  * the Shield rows must actually arrive, or the fleet console shows nothing;
  * everything the module still refuses to send must STAY refused, and that
    boundary is now one edit away from being widened by accident, because the
    module no longer has a blanket "no identifiers" rule to hide behind.

So the exclusion test is deliberately written against the SERIALISED payload
rather than the imports: the old protection was "those modules aren't imported
here", and half of that argument is gone.
"""
import json

import pytest

from gateflame import health_feed


class _FakeStore:
    def __init__(self, names=None, node_id="GF-TEST0001"):
        self._names = names or {}
        self._node_id = node_id

    def node_id(self):
        return self._node_id

    def device_names(self):
        return dict(self._names)


@pytest.fixture
def patched(monkeypatch):
    monkeypatch.setattr(
        health_feed.telemetry, "host_snapshot",
        lambda: {
            "uptimeSeconds": 1234, "cpuPercent": 9.5, "memUsedMB": 100,
            "memTotalMB": 1000, "diskUsedPercent": 12.0, "tempC": 40.0,
            "throttleFlags": "0x0",
        },
    )
    monkeypatch.setattr(health_feed.services, "list_modules", lambda: [
        {"id": "module_dns_filter", "status": "running", "gap": None},
    ])
    monkeypatch.setattr(health_feed.telemetry.pihole, "reachable", lambda: True)


def test_shield_rows_are_sent_with_the_owners_own_name(patched, monkeypatch):
    monkeypatch.setattr(health_feed.vpn, "list_device_status", lambda store: [
        {"mac": "aa:bb:cc:dd:ee:ff", "region": "JP", "enabled": True, "provider": "vpngate"},
    ])
    store = _FakeStore(names={"aa:bb:cc:dd:ee:ff": "Kyle's tablet"})

    p = health_feed.build_payload(store)

    assert p["shield"]["configured"] is True
    assert p["shield"]["enabledCount"] == 1
    d = p["shield"]["devices"][0]
    assert d["mac"] == "aa:bb:cc:dd:ee:ff"
    # The label must match what the phone and wall console show, or support and
    # customer end up describing two different devices to each other.
    assert d["label"] == "Kyle's tablet"
    assert d["region"] == "JP"
    assert d["enabled"] is True


def test_a_box_that_never_touched_shield_says_so_distinctly(patched, monkeypatch):
    monkeypatch.setattr(health_feed.vpn, "list_device_status", lambda store: [])
    p = health_feed.build_payload(_FakeStore())

    assert p["shield"]["configured"] is False
    assert p["shield"]["devices"] == []


def test_unreadable_shield_state_is_not_reported_as_empty(patched, monkeypatch):
    """"We could not read this" and "there is nothing here" must not arrive at
    the dashboard looking the same - that conflation is the exact bug that had
    Shield telling owners a working feature was never installed."""
    def boom(store):
        raise RuntimeError("table is gone")

    monkeypatch.setattr(health_feed.vpn, "list_device_status", boom)
    p = health_feed.build_payload(_FakeStore())

    assert p["shield"] is None
    # And the rest of the check-in must survive it - a reporting fault is not a
    # reason for the fleet to lose sight of the box entirely.
    assert p["host"]["cpuPercent"] == 9.5
    assert p["modules"]


def test_the_feed_still_refuses_domains_ips_and_query_logs(patched, monkeypatch):
    """The module used to promise it sent no identifiers at all, and that
    promise is now partly spent. What remains must not erode quietly."""
    monkeypatch.setattr(health_feed.vpn, "list_device_status", lambda store: [
        {"mac": "aa:bb:cc:dd:ee:ff", "region": "JP", "enabled": True, "provider": "vpngate"},
    ])
    blob = json.dumps(health_feed.build_payload(_FakeStore())).lower()

    for forbidden in ("domain", "query", "threat", "dpi", "hostname", "clientip", "192.168."):
        assert forbidden not in blob, f"the health feed leaked {forbidden!r}"


def test_shield_is_the_only_place_a_device_identifier_appears(patched, monkeypatch):
    """A MAC is allowed in shield.devices and nowhere else. If one shows up in
    host, modules or counters, something has been wired in sideways."""
    monkeypatch.setattr(health_feed.vpn, "list_device_status", lambda store: [
        {"mac": "aa:bb:cc:dd:ee:ff", "region": "JP", "enabled": True, "provider": "vpngate"},
    ])
    p = health_feed.build_payload(_FakeStore())
    without_shield = {k: v for k, v in p.items() if k != "shield"}

    assert "aa:bb:cc" not in json.dumps(without_shield).lower()
