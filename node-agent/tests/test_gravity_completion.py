"""A gravity rebuild is judged by Pi-hole's own completion signal, not by a guess.

PIN-2026-09-21 §4 #3: "`blocklists._gravity_finished` requires the domain COUNT
to change - a same-lists re-apply reads as `degraded`."

The root cause was one layer deeper than the PIN said. FTL answers
POST /api/action/gravity with the gravity script's output as text/plain
(FTL v6.7.1 specs/action.yaml; src/api/action.c). The agent parsed that body as
JSON, so EVERY rebuild it ever triggered came back None and fell through to the
count-changed backstop - which by construction cannot tell "finished, same
size" from "never ran". A re-apply of the same lists always ended degraded.

The fix uses `gravity.last_update` from /api/stats/summary: FTL's copy of the
gravity database's own `updated` stamp, re-read once a second by FTL's database
thread (src/database/gravity-db.c: gravity_updated()). It moves on every build
FTL has loaded, whatever the count does.
"""

from __future__ import annotations

import threading
import time

import httpx
import pytest

from gateflame import blocklists, pihole, threat_level

SETTINGS = {"enabled": True, "threat_level": "low", "categories": []}
WANTED = threat_level.lists_for("low")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(blocklists, "_last_error", None, raising=False)
    monkeypatch.setattr(blocklists, "_GRAVITY_CONFIRM_INTERVAL", 0.01)
    monkeypatch.setattr(blocklists, "_GRAVITY_VERIFY_INTERVAL", 0.01)
    yield


def _loaded(fake):
    fake.lists = [{"address": u, "type": "block", "enabled": True} for u in WANTED]


# ------------------------------------------------------ the real wire shape


def test_the_gravity_post_is_judged_on_status_not_on_json(fake_pihole):
    """THE ROOT CAUSE. A 200 with a text/plain body is a completed run.

    Reintroduce the old behaviour (parse the body as JSON: expect="json") and
    this returns REFUSED - the same "never JSON, so never success" that made
    every rebuild look failed on the live box.
    """
    assert blocklists._gravity_post(60.0) == blocklists.GRAVITY_COMPLETED
    assert fake_pihole.gravity_runs == 1


def test_the_gravity_post_asks_for_the_connection_to_close(fake_pihole):
    """FTL writes a second response onto the socket after the chunked body."""
    seen: list = []

    def spy(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/action/gravity":
            seen.append(request.headers.get("connection"))
        return fake_pihole.handler(request)

    pihole._transport = httpx.MockTransport(spy)
    blocklists._gravity_post(60.0)
    assert seen == ["close"]


def test_a_dropped_connection_is_dropped_not_refused(fake_pihole):
    fake_pihole.raise_on = "/api/action/gravity"
    assert blocklists._gravity_post(60.0) == blocklists.GRAVITY_DROPPED


def test_an_http_error_is_refused(fake_pihole, monkeypatch):
    def refuse(request):
        if request.url.path == "/api/action/gravity":
            return httpx.Response(403, json={"error": {"message": "forbidden"}})
        return fake_pihole.handler(request)

    pihole._transport = httpx.MockTransport(refuse)
    assert blocklists._gravity_post(60.0) == blocklists.GRAVITY_REFUSED


# ----------------------------------------------- same lists, same count: PIN §4 #3


def test_a_same_lists_reapply_is_a_success(fake_pihole):
    """Lists unchanged, domain count unchanged, stamp moves: that is a success.

    With the count-only check this was `degraded` after ten minutes, every time.
    """
    _loaded(fake_pihole)
    count_before = fake_pihole.domains
    assert blocklists.apply(SETTINGS) is True, blocklists.last_error()
    assert blocklists.last_error() is None
    assert fake_pihole.domains == count_before
    assert fake_pihole.gravity_runs == 1


def test_a_completed_run_that_never_loads_a_new_database_is_a_failure(fake_pihole, monkeypatch):
    """NON-VACUITY: a completed POST is not taken on its word when a stamp exists.

    gravity.sh can end (HTTP 200, output streamed) having failed to build a
    database - FTL's status line was sent before the script ran.
    """
    monkeypatch.setattr(blocklists, "_GRAVITY_CONFIRM_SECONDS", 0.2)
    _loaded(fake_pihole)
    fake_pihole.gravity_bumps_stamp = False
    assert blocklists.apply(SETTINGS) is False
    assert "never loaded a new gravity database" in blocklists.last_error()


def test_a_dropped_post_then_a_new_stamp_is_a_success(fake_pihole, monkeypatch):
    """The 2026-09-06 shape, same lists: the HTTP side gives up, Pi-hole finishes."""
    _loaded(fake_pihole)
    fake_pihole.gravity_bumps_stamp = False
    fake_pihole.raise_on = "/api/action/gravity"
    monkeypatch.setattr(blocklists, "_GRAVITY_VERIFY_SECONDS", 2.0)

    def finish_later():
        time.sleep(0.2)
        fake_pihole.gravity_stamp += 120      # the rebuild completes after the drop

    threading.Thread(target=finish_later).start()
    assert blocklists.apply(SETTINGS) is True, blocklists.last_error()


def test_a_dropped_post_and_no_new_stamp_is_still_a_failure(fake_pihole, monkeypatch):
    _loaded(fake_pihole)
    fake_pihole.gravity_bumps_stamp = False
    fake_pihole.raise_on = "/api/action/gravity"
    monkeypatch.setattr(blocklists, "_GRAVITY_VERIFY_SECONDS", 0.2)
    assert blocklists.apply(SETTINGS) is False
    assert "did not finish" in blocklists.last_error()


def test_a_refused_rebuild_fails_fast(fake_pihole, monkeypatch):
    """A 4xx/5xx is an answer. It must not sit in `applying` for ten minutes."""
    def refuse(request):
        if request.url.path == "/api/action/gravity":
            return httpx.Response(500, json={"error": {"message": "boom"}})
        return fake_pihole.handler(request)

    pihole._transport = httpx.MockTransport(refuse)
    _loaded(fake_pihole)
    started = time.monotonic()
    assert blocklists.apply(SETTINGS) is False
    assert time.monotonic() - started < 5
    assert "refused the gravity rebuild" in blocklists.last_error()


def test_stamp_verdicts():
    """The pure decision, every branch."""
    v = blocklists._stamp_verdict
    assert v((100, 5), (160, 5), None) is True            # moved past the pre-POST stamp
    assert v((100, 5), (100, 5), None) is False           # known, did not move
    assert v((100, 5), (100, 5), 90.0) is False           # a known 'before' wins over the start time
    assert v(None, (1000, 5), 999.5) is True              # no 'before': stamped after the POST
    assert v(None, (900, 5), 999.5) is False              # stamped before we asked
    assert v((100, 5), (None, 9), 50.0) is None           # this FTL gives no stamp
    assert v((100, 5), (0, 9), 50.0) is None              # 0 = unknown, per the spec


# ------------------------------------------------------------ list hygiene


def test_allow_lists_are_not_ours_to_delete(fake_pihole):
    """An owner's allow-list must not be deleted with ?type=block - that 404
    failed every apply and made reconcile re-run on every boot, forever."""
    _loaded(fake_pihole)
    fake_pihole.lists.append({"address": "https://example.org/allow.txt", "type": "allow", "enabled": True})
    assert "https://example.org/allow.txt" not in blocklists.current_lists()
    assert blocklists.apply(SETTINGS) is True, blocklists.last_error()
    assert any(e["address"] == "https://example.org/allow.txt" for e in fake_pihole.lists)


def test_a_list_is_deleted_by_its_encoded_address(fake_pihole):
    """The address goes in the path percent-encoded, as Pi-hole's own UI sends it."""
    extra = "https://example.org/some/list.txt?format=hosts"
    _loaded(fake_pihole)
    fake_pihole.lists.append({"address": extra, "type": "block", "enabled": True})
    deletes: list[str] = []

    def spy(request):
        if request.method == "DELETE" and request.url.path.startswith("/api/lists/"):
            deletes.append(request.url.raw_path.decode())
        return fake_pihole.handler(request)

    pihole._transport = httpx.MockTransport(spy)
    assert blocklists.apply(SETTINGS) is True, blocklists.last_error()
    assert deletes and "https%3A%2F%2Fexample.org%2Fsome%2Flist.txt%3Fformat%3Dhosts" in deletes[0]
    assert deletes[0].endswith("?type=block")
    assert not any(e["address"] == extra for e in fake_pihole.lists)


# ---------------------------------------------------- toggles during a rebuild


class _Store:
    def __init__(self, settings):
        self.settings = dict(settings)

    def get_filter_settings(self):
        return dict(self.settings)


def test_a_change_during_a_rebuild_is_applied_not_dropped(monkeypatch):
    """Pause, then resume while the pause's rebuild is still running.

    apply_async used to DROP the second request, so the box finished on the
    first one's settings (no lists) while the settings said enabled, reported
    degraded, and never re-applied. Now the running worker applies once more
    with the latest settings.
    """
    import dataclasses

    monkeypatch.setattr(blocklists, "config", dataclasses.replace(blocklists.config, pihole_api_url="http://x"))
    monkeypatch.setattr(blocklists, "_applying", False)
    monkeypatch.setattr(blocklists, "_rerun", False)
    applied: list[bool] = []
    release = threading.Event()
    first_started = threading.Event()

    def fake_apply(settings):
        applied.append(settings["enabled"])
        if len(applied) == 1:
            first_started.set()
            release.wait(5)
        return True

    monkeypatch.setattr(blocklists, "apply", fake_apply)
    store = _Store({**SETTINGS, "enabled": False})
    blocklists.apply_async(store)            # the pause
    assert first_started.wait(5)
    store.settings["enabled"] = True         # the resume, mid-rebuild
    blocklists.apply_async(store)
    blocklists.apply_async(store)            # a third tap coalesces into the same re-run
    release.set()
    deadline = time.monotonic() + 5
    while blocklists.is_applying() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert applied == [False, True], applied
    assert blocklists.is_applying() is False
