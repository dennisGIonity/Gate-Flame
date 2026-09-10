"""DNS upstream selection: read-back is the result.

The Pi-hole API is stubbed at the `pihole.api_get` / `pihole.api_patch` seam
so every path through apply() is exercised without a Pi-hole, including the
ones that matter most: "saved" without read-back agreement, and a new upstream
that does not resolve (must roll back).
"""

from __future__ import annotations

import pytest

from gateflame import datadir, upstream


class FakePihole:
    """Records PATCHes and serves read-backs from an internal upstream list."""

    def __init__(self, current, *, reachable=True, accept_patch=True, honour_patch=True):
        self.current = list(current) if current is not None else None
        self.reachable = reachable
        self.accept_patch = accept_patch
        self.honour_patch = honour_patch
        self.patches: list[dict] = []

    def api_get(self, path):
        if not self.reachable or self.current is None:
            return None
        assert path == f"/api/config/{upstream.UPSTREAM_KEY}"
        return {"config": {"dns": {"upstreams": list(self.current)}}}

    def api_patch(self, path, payload):
        self.patches.append(payload)
        if not self.accept_patch:
            return None
        if self.honour_patch:
            self.current = list(payload["config"]["dns"]["upstreams"])
        return {"config": {"dns": {"upstreams": list(self.current)}}}


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setenv("GATEFLAME_DATA_ROOT", str(tmp_path / ".DUMP"))
    datadir.ensure()


@pytest.fixture
def wire(monkeypatch, root):
    def _wire(fake, resolves=True):
        monkeypatch.setattr(upstream.pihole, "api_get", fake.api_get)
        monkeypatch.setattr(upstream.pihole, "api_patch", fake.api_patch)
        monkeypatch.setattr(upstream, "_resolve_through_box", lambda name, timeout=4.0: resolves)
        monkeypatch.setattr(upstream.time, "sleep", lambda s: None)
        return fake
    return _wire


# ---------------------------------------------------------------- catalogue


def test_default_mode_is_recursive_and_points_at_unbound():
    assert upstream.DEFAULT_MODE == "recursive"
    assert upstream.MODES["recursive"].upstreams == (upstream.UNBOUND_UPSTREAM,)


def test_cloudflare_modes_use_the_documented_addresses():
    assert upstream.MODES["cloudflare"].upstreams == ("1.1.1.1#53", "1.0.0.1#53")
    assert upstream.MODES["cloudflare-malware"].upstreams == ("1.1.1.2#53", "1.0.0.2#53")
    assert upstream.MODES["cloudflare-family"].upstreams == ("1.1.1.3#53", "1.0.0.3#53")


def test_no_mode_claims_encryption_because_none_is():
    """Pi-hole forwards over plain 53. A mode saying encrypted=True would be a
    lie the UI would repeat."""
    assert all(m.encrypted is False for m in upstream.MODES.values())


def test_match_is_order_insensitive_and_strict():
    assert upstream.match(["1.0.0.1#53", "1.1.1.1#53"]) == "cloudflare"
    assert upstream.match(["1.1.1.1#53"]) is None          # half a mode is not a mode
    assert upstream.match(["8.8.8.8#53"]) is None
    assert upstream.match(None) is None
    assert upstream.match([]) is None


# ------------------------------------------------------------------ describe


def test_describe_derives_mode_from_live_pihole(wire):
    wire(FakePihole(["1.1.1.2#53", "1.0.0.2#53"]))
    d = upstream.describe()
    assert d["reachable"] is True
    assert d["mode"] == "cloudflare-malware"
    assert d["operator"] == "Cloudflare"
    assert d["encrypted"] is False


def test_describe_reports_a_hand_edit_as_custom(wire):
    wire(FakePihole(["8.8.8.8#53"]))
    d = upstream.describe()
    assert d["mode"] == "custom"
    assert d["upstreams"] == ["8.8.8.8#53"]


def test_describe_when_pihole_unreachable_is_none_not_recursive(wire):
    """Undetermined is not a mode. Reporting 'recursive' here would tell the
    owner their lookups stay home while nothing is known."""
    wire(FakePihole(None, reachable=False))
    d = upstream.describe()
    assert d["reachable"] is False
    assert d["mode"] is None
    assert d["upstreams"] is None


def test_describe_carries_the_third_party_notice(wire):
    wire(FakePihole([upstream.UNBOUND_UPSTREAM]))
    assert "third party" in upstream.describe()["notice"]


# --------------------------------------------------------------------- apply


def test_apply_unknown_mode_raises():
    with pytest.raises(ValueError):
        upstream.apply("google")


def test_apply_happy_path_patches_reads_back_and_proves_resolution(wire):
    fake = wire(FakePihole([upstream.UNBOUND_UPSTREAM]), resolves=True)
    r = upstream.apply("cloudflare", applied_by="kiosk")
    assert r["applied"]["ok"] is True
    assert r["applied"]["readBack"] == ["1.1.1.1#53", "1.0.0.1#53"]
    assert r["applied"]["resolves"] is True
    assert r["mode"] == "cloudflare"
    assert len(fake.patches) == 1


def test_apply_when_pihole_unreachable_changes_nothing(wire):
    fake = wire(FakePihole(None, reachable=False))
    r = upstream.apply("cloudflare")
    assert r["applied"]["ok"] is False
    assert "not reachable" in r["applied"]["error"]
    assert fake.patches == []


def test_apply_refused_patch_is_reported(wire):
    fake = wire(FakePihole([upstream.UNBOUND_UPSTREAM], accept_patch=False))
    r = upstream.apply("cloudflare")
    assert r["applied"]["ok"] is False
    assert "refused" in r["applied"]["error"]
    assert fake.current == [upstream.UNBOUND_UPSTREAM]


def test_saved_but_readback_disagrees_is_a_failure(wire):
    """The router lesson: 'saved' is not a result. Only the read-back is."""
    wire(FakePihole([upstream.UNBOUND_UPSTREAM], honour_patch=False))
    r = upstream.apply("cloudflare")
    assert r["applied"]["ok"] is False
    assert "read-back" in r["applied"]["error"]
    assert r["mode"] == "recursive"


def test_new_upstream_that_does_not_resolve_is_rolled_back(wire):
    fake = wire(FakePihole([upstream.UNBOUND_UPSTREAM]), resolves=False)
    r = upstream.apply("cloudflare-family")
    assert r["applied"]["ok"] is False
    assert "reverted" in r["applied"]["error"]
    # Two PATCHes: the change, then the rollback to what was there before.
    assert len(fake.patches) == 2
    assert fake.current == [upstream.UNBOUND_UPSTREAM]
    assert r["mode"] == "recursive"


def test_apply_writes_an_audit_line(wire, tmp_path):
    wire(FakePihole([upstream.UNBOUND_UPSTREAM]))
    upstream.apply("cloudflare", applied_by="kiosk")
    log = tmp_path / ".DUMP" / "logs" / "upstream.log"
    assert log.is_file()
    line = log.read_text().strip().splitlines()[-1]
    assert '"requested": "cloudflare"' in line
    assert '"appliedBy": "kiosk"' in line
