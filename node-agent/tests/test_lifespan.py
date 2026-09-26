"""The app's startup and shutdown run from a lifespan, in the same order as before.

FastAPI deprecated @app.on_event; the replacement must not change what a boot
does, because every step here is load-bearing on a box that reboots weekly:

  1. datadir.ensure()                         the data root, before anything persists
  2. feed_loop.start()                        (gated by GATEFLAME_FEED_ENABLED)
  3. vpngate.ensure_fresh()                   (gated by GATEFLAME_VPNGATE_WARM)
  4. an until_reboot pause ENDS -> apply_async, otherwise reconcile_async
  5. pause_watch.start()                      timed pauses end on time
  6. system_history.start_sampler()           (gated by GATEFLAME_HISTORY_SAMPLER)

and shutdown stops the feed, the pause watch, the sampler, and hands the Pi-hole
session back.
"""

from __future__ import annotations

import dataclasses
import threading

from fastapi.testclient import TestClient

from gateflame import blocklists, datadir, health_feed, main, pihole, system_history, vpngate


def _record(monkeypatch, calls, *, reboot_pause: bool, sampler: bool = False, warm: bool = True):
    monkeypatch.setattr(main, "config", dataclasses.replace(
        main.config, history_sampler_enabled=sampler, vpngate_warm=warm))
    monkeypatch.setattr(datadir, "ensure", lambda: calls.append("ensure") or {})
    monkeypatch.setattr(main.feed_loop, "start", lambda: calls.append("feed.start"))
    monkeypatch.setattr(main.feed_loop, "stop", lambda: calls.append("feed.stop"))
    monkeypatch.setattr(vpngate, "ensure_fresh", lambda: calls.append("vpngate.warm"))
    monkeypatch.setattr(main.store, "clear_reboot_pause", lambda: reboot_pause)
    monkeypatch.setattr(blocklists, "apply_async", lambda store: calls.append("apply_async"))
    monkeypatch.setattr(blocklists, "reconcile_async", lambda store: calls.append("reconcile_async"))
    monkeypatch.setattr(main.pause_watch, "start", lambda: calls.append("pause_watch.start"))
    monkeypatch.setattr(main.pause_watch, "stop", lambda: calls.append("pause_watch.stop"))
    monkeypatch.setattr(system_history, "start_sampler",
                        lambda interval: calls.append(f"sampler.start({interval})") or object())
    monkeypatch.setattr(system_history, "stop_sampler", lambda: calls.append("sampler.stop"))
    monkeypatch.setattr(pihole, "logout", lambda: calls.append("pihole.logout"))


def test_the_app_uses_a_lifespan_not_on_event():
    assert main.app.router.lifespan_context is not None
    assert not main.app.router.on_startup and not main.app.router.on_shutdown


def test_startup_runs_every_step_in_order(monkeypatch):
    calls: list[str] = []
    _record(monkeypatch, calls, reboot_pause=False, sampler=True)
    with TestClient(main.app, client=("127.0.0.1", 51000)) as c:
        assert calls == [
            "ensure", "feed.start", "vpngate.warm", "reconcile_async",
            "pause_watch.start", f"sampler.start({main.config.history_sample_seconds})",
        ]
        assert c.get("/api/v1/system/status").status_code == 200
    assert calls[-4:] == ["feed.stop", "pause_watch.stop", "sampler.stop", "pihole.logout"]


def test_an_until_reboot_pause_ends_at_boot(monkeypatch):
    calls: list[str] = []
    _record(monkeypatch, calls, reboot_pause=True)
    with TestClient(main.app, client=("127.0.0.1", 51000)):
        pass
    assert "apply_async" in calls and "reconcile_async" not in calls


def test_background_work_is_gated(monkeypatch):
    calls: list[str] = []
    _record(monkeypatch, calls, reboot_pause=False, sampler=False, warm=False)
    with TestClient(main.app, client=("127.0.0.1", 51000)):
        pass
    assert "vpngate.warm" not in calls
    assert not any(c.startswith("sampler.start") for c in calls)


def test_no_background_threads_outlive_the_lifespan():
    """The real startup (flags off, as conftest sets them): nothing leaks."""
    before = {t.ident for t in threading.enumerate()}
    with TestClient(main.app, client=("127.0.0.1", 51000)):
        pass
    leaked = [t.name for t in threading.enumerate()
              if t.ident not in before and t.is_alive() and t.name.startswith("gateflame")]
    assert leaked == [], leaked


def test_the_kiosk_mount_still_works_with_a_lifespan(tmp_path):
    from fastapi import FastAPI

    bundle = tmp_path / "kiosk"
    (bundle / "assets").mkdir(parents=True)
    (bundle / "index.html").write_text('<script src="/assets/k.js"></script>')
    (bundle / "assets" / "k.js").write_text("1")
    app = FastAPI(lifespan=main.lifespan)
    assert main.mount_device_kiosk(app, str(bundle)) is True
    c = TestClient(app, client=("127.0.0.1", 51000))
    assert c.get("/device-kiosk/").status_code == 200
    assert c.get("/assets/k.js").status_code == 200


def test_the_feed_loop_can_start_again_after_a_stop(monkeypatch):
    """Every `with TestClient(app)` is a lifespan; the loop must survive several.

    Before: stop() set an Event nothing ever cleared, so a restarted loop's
    thread exited on its first check - silently, no check-ins at all.
    """
    monkeypatch.setattr(health_feed, "config", dataclasses.replace(
        health_feed.config, feed_enabled=True, feed_interval_seconds=3600))
    sent = threading.Event()
    monkeypatch.setattr(health_feed, "_send_once", lambda store: sent.set())
    loop = health_feed.HealthFeedLoop(main.store)
    loop.start()
    assert sent.wait(5)
    loop.stop()
    loop._thread.join(5)
    sent.clear()
    loop.start()
    assert sent.wait(5), "a restarted feed loop must actually run"
    loop.stop()
