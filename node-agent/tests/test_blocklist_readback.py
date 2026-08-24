"""apply() must not report success for a write that did not land.

REGRESSION FIXTURE: GF-72TYTITQ, 2026-08-24.

The box had run since it was built with an empty adlist, empty gravity, and
131,068 unfiltered queries - while `pihole status` said blocking enabled, the
agent said DNS filtering "running", and /api/v1/filtering said "active".

The whole chain rested on four discarded characters:

    for url in wanted - have:
        _post("/api/lists", {...})        # <- return value thrown away

`_post` returns None on any non-2xx. A rejected add looked exactly like an
accepted one. The gravity rebuild that followed then SUCCEEDED, because
rebuilding an empty list works perfectly well, so `_last_error` was cleared and
apply() returned True having written nothing at all.

This is the project's own standing rule - never claim success without a
read-back - broken against our own writes rather than against a router.
"""

from __future__ import annotations

import pytest

from gateflame import blocklists

LIST_URL = "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"
SETTINGS = {"enabled": True, "threat_level": "low", "categories": []}

LOADED = {"domainsOnGravity": 151234}
EMPTY = {"domainsOnGravity": 0}


class Recorder:
    """Stands in for Pi-hole. Records writes; answers reads from `lists`."""

    def __init__(self, lists=None, accept_post=True, accept_delete=True,
                 gravity_ok=True, lists_after_write=None, stats=None):
        self.lists = list(lists or [])
        self.accept_post = accept_post
        self.accept_delete = accept_delete
        self.gravity_ok = gravity_ok
        # What a read-back sees, if it should differ from what was written.
        self.lists_after_write = lists_after_write
        self.stats = LOADED if stats is None else stats
        self.posted: list[str] = []
        self.paths: list[str] = []
        self.gravity_runs = 0
        self._written = False

    def current_lists(self):
        if self._written and self.lists_after_write is not None:
            return list(self.lists_after_write)
        return list(self.lists)

    def post(self, path, payload):
        if path == "/api/action/gravity":
            self.gravity_runs += 1
            return {} if self.gravity_ok else None
        self.paths.append(path)
        # Pi-hole v6 answers 400 unless `type` is in the QUERY STRING. Modelled
        # here rather than assumed, so the fixture fails the same way the real
        # container does.
        if "type=" not in path:
            return None
        self.posted.append(payload.get("address", ""))
        if not self.accept_post:
            return None
        self._written = True
        self.lists.append(payload["address"])
        return {"ok": True}

    def delete(self, path):
        return self.accept_delete

    def summary(self):
        return self.stats


@pytest.fixture
def pihole(monkeypatch):
    rec = Recorder()

    def install(r):
        monkeypatch.setattr(blocklists, "current_lists", r.current_lists)
        monkeypatch.setattr(blocklists, "_post", r.post)
        monkeypatch.setattr(blocklists, "_delete", r.delete)
        monkeypatch.setattr(blocklists, "summary", r.summary)
        monkeypatch.setattr(blocklists, "_last_error", None, raising=False)
        return r

    rec.install = install  # type: ignore[attr-defined]
    return install(rec)


def _install(monkeypatch, rec):
    monkeypatch.setattr(blocklists, "current_lists", rec.current_lists)
    monkeypatch.setattr(blocklists, "_post", rec.post)
    monkeypatch.setattr(blocklists, "_delete", rec.delete)
    monkeypatch.setattr(blocklists, "summary", rec.summary)
    monkeypatch.setattr(blocklists, "_last_error", None, raising=False)
    return rec


# ------------------------------------------------------------- the actual bug


def test_a_rejected_add_is_a_failure_not_a_success(monkeypatch):
    """THE 2026-08-24 BUG. Pi-hole says no; apply() used to say yes."""
    rec = _install(monkeypatch, Recorder(lists=[], accept_post=False))

    ok = blocklists.apply(SETTINGS)

    assert ok is False
    assert blocklists.last_error()
    assert "rejected" in blocklists.last_error()
    # And it must not have gone on to rebuild gravity over a list it failed to add.
    assert rec.gravity_runs == 0


def test_a_write_that_does_not_read_back_is_a_failure(monkeypatch):
    """Pi-hole accepted the request and does not actually have the list.

    A 200 means the request was accepted, not that the state changed. This is
    the same rule the router handshake already follows.
    """
    rec = _install(
        monkeypatch,
        Recorder(lists=[], accept_post=True, lists_after_write=[]),
    )

    ok = blocklists.apply(SETTINGS)

    assert ok is False
    assert "did not take" in blocklists.last_error()
    assert rec.gravity_runs == 0


def test_a_registered_list_that_downloads_nothing_is_a_failure(monkeypatch):
    """Gravity rebuilt cleanly over a list it could not fetch.

    Exactly the original fault one layer further in: everything "succeeded" and
    zero domains are blocked.
    """
    _install(monkeypatch, Recorder(lists=[], stats=EMPTY))

    ok = blocklists.apply(SETTINGS)

    assert ok is False
    assert "no domains" in blocklists.last_error()


def test_the_add_sends_type_in_the_query_string(monkeypatch):
    """Pi-hole v6 returns 400 unless `type` is a QUERY parameter.

        Invalid request: Specify type parameter (should be either "allow" or "block")

    Verified against the live container on 2026-08-24: body-only is 400,
    `?type=block` is 201. The delete path had always used the query form; only
    the add was wrong, and its discarded return value hid the 400 for eight days.

    Pinned because this is a remote contract with no compile-time check - an
    innocent-looking tidy-up of that f-string silently unprotects a household.
    """
    rec = _install(monkeypatch, Recorder(lists=[]))

    assert blocklists.apply(SETTINGS) is True
    assert rec.paths, "no list write was attempted at all"
    assert all("type=block" in p for p in rec.paths), rec.paths


# ------------------------------------------------------------- non-vacuity


def test_a_successful_apply_still_succeeds(monkeypatch):
    rec = _install(monkeypatch, Recorder(lists=[]))

    ok = blocklists.apply(SETTINGS)

    assert ok is True
    assert blocklists.last_error() is None
    assert rec.posted == [LIST_URL]
    assert rec.gravity_runs == 1


def test_pihole_unreachable_is_still_reported(monkeypatch):
    rec = _install(monkeypatch, Recorder())
    monkeypatch.setattr(blocklists, "current_lists", lambda: None)

    assert blocklists.apply(SETTINGS) is False
    assert blocklists.last_error() == "Pi-hole unreachable"


# ------------------------------------------------------------------ reconcile


def test_reconcile_repairs_an_empty_box(monkeypatch):
    """The state the live box sat in: no lists at all, nobody touching a toggle."""
    rec = _install(monkeypatch, Recorder(lists=[]))
    store = _Store()

    assert blocklists.reconcile(store) is True
    assert rec.posted == [LIST_URL], "reconcile must actually write the missing list"


def test_reconcile_repairs_a_registered_list_with_empty_gravity(monkeypatch):
    """Lists agree, gravity empty. Agreement is not protection."""
    rec = _install(monkeypatch, Recorder(lists=[LIST_URL], stats=EMPTY))
    store = _Store()

    blocklists.reconcile(store)

    assert rec.gravity_runs == 1, "an empty gravity must trigger a rebuild"


def test_reconcile_is_cheap_when_everything_already_agrees(monkeypatch):
    """A weekly reboot must not mean a full gravity download every time."""
    rec = _install(monkeypatch, Recorder(lists=[LIST_URL], stats=LOADED))
    store = _Store()

    assert blocklists.reconcile(store) is True
    assert rec.gravity_runs == 0
    assert rec.posted == []


def test_reconcile_does_nothing_to_a_paused_box(monkeypatch):
    """Paused means an empty list set ON PURPOSE, and must stay that way."""
    rec = _install(monkeypatch, Recorder(lists=[], stats=EMPTY))
    store = _Store(enabled=False)

    assert blocklists.reconcile(store) is True
    assert rec.posted == []
    assert rec.gravity_runs == 0


class _Store:
    def __init__(self, enabled: bool = True):
        self._settings = {**SETTINGS, "enabled": enabled}

    def get_filter_settings(self):
        return dict(self._settings)
