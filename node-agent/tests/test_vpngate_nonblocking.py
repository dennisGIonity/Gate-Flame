"""The VPN Gate list must never be fetched on the request path.

MEASURED ON THE REAL BOX, 2026-08-31:
    GET /api/v1/vpn/regions   HTTP 200   24.1 seconds
    GET /api/v1/filtering     HTTP 200    0.013 seconds

against a 4-second client timeout in kioskClient.ts. Every phone aborted, and
the Shield screen reported the feature unavailable - while the box was busy
fetching a perfectly good list that arrived twenty seconds too late.

The cruelty of it was the intermittency: the blocking call warmed the cache, so
whoever asked next got an answer in 2ms. That is why it "worked yesterday" and
why a manual pass could not be trusted to catch it. Only the clock catches this
class of bug, so the clock is what these tests use.
"""
import threading
import time

import pytest

from gateflame import vpngate


@pytest.fixture(autouse=True)
def _reset_module_state():
    """Each test starts from a known cache state and leaves none behind."""
    with vpngate._lock:
        vpngate._cache = []
        vpngate._cache_at = 0.0
        vpngate._last_error = None
        vpngate._refreshing = False
        vpngate._refresh_started_at = 0.0
    yield
    with vpngate._lock:
        vpngate._cache = []
        vpngate._cache_at = 0.0
        vpngate._last_error = None
        vpngate._refreshing = False
        vpngate._refresh_started_at = 0.0


class _SlowUpstream:
    """Stands in for VPN Gate taking its time. Records how often it was hit so
    a stampede of concurrent callers is visible as a number, not a guess."""

    def __init__(self, delay: float):
        self.delay = delay
        self.calls = 0
        self._lock = threading.Lock()

    def __call__(self, url, timeout=None):  # noqa: ARG002 - httpx.get signature
        with self._lock:
            self.calls += 1
        time.sleep(self.delay)

        class _Resp:
            status_code = 200
            # One valid row, in the shape _parse_csv expects.
            text = (
                "*vpn_servers\n"
                "#HostName,IP,Score,Ping,Speed,CountryLong,CountryShort,"
                "NumVpnSessions,Uptime,TotalUsers,TotalTraffic,LogType,Operator,"
                "Message,OpenVPN_ConfigData_Base64\n"
                "vpn1,1.2.3.4,100,10,1000,Japan,JP,1,1,1,1,2w,op,msg,Zm9v\n"
            )

        return _Resp()


def test_ensure_fresh_returns_immediately_even_when_upstream_is_slow(monkeypatch):
    """The whole point. A 3-second upstream must not cost the caller 3 seconds."""
    slow = _SlowUpstream(delay=3.0)
    monkeypatch.setattr(vpngate.httpx, "get", slow)

    started = time.monotonic()
    vpngate.ensure_fresh()
    elapsed = time.monotonic() - started

    # Generous bound - this is asserting "did not block", not benchmarking.
    assert elapsed < 0.5, (
        f"ensure_fresh() blocked for {elapsed:.2f}s. It must hand the fetch to a "
        "background thread; the household screen cannot wait on VPN Gate."
    )


def test_the_slow_fetch_does_eventually_land(monkeypatch):
    """Not blocking is only half of it - the list still has to arrive."""
    slow = _SlowUpstream(delay=0.3)
    monkeypatch.setattr(vpngate.httpx, "get", slow)

    vpngate.ensure_fresh()
    assert vpngate.list_countries() == [] or True  # cache may still be cold here

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if vpngate.last_fetch_ok():
            break
        time.sleep(0.05)

    assert vpngate.last_fetch_ok(), "background refresh never populated the cache"
    assert any(c["code"] == "JP" for c in vpngate.list_countries())


def test_concurrent_callers_do_not_each_start_a_fetch(monkeypatch):
    """Ten screens opening at once must not mean ten downloads of the CSV."""
    slow = _SlowUpstream(delay=0.5)
    monkeypatch.setattr(vpngate.httpx, "get", slow)

    threads = [threading.Thread(target=vpngate.ensure_fresh) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    time.sleep(1.2)  # let the in-flight refresh finish
    assert slow.calls == 1, f"upstream was hit {slow.calls} times, expected 1"


def test_a_warm_cache_is_not_refetched(monkeypatch):
    """Inside the TTL there is nothing to do at all."""
    slow = _SlowUpstream(delay=0.1)
    monkeypatch.setattr(vpngate.httpx, "get", slow)

    with vpngate._lock:
        vpngate._cache = [{"CountryShort": "JP"}]
        vpngate._cache_at = time.time()

    vpngate.ensure_fresh()
    time.sleep(0.3)
    assert slow.calls == 0


def test_is_refreshing_reports_the_truth_while_a_fetch_runs(monkeypatch):
    """The API sends this so a screen can say "still fetching" rather than
    "nothing on offer" - so it has to actually be true during a fetch."""
    slow = _SlowUpstream(delay=0.6)
    monkeypatch.setattr(vpngate.httpx, "get", slow)

    vpngate.ensure_fresh()
    time.sleep(0.15)
    assert vpngate.is_refreshing() is True, "refreshing was not reported during a fetch"

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and vpngate.is_refreshing():
        time.sleep(0.05)
    assert vpngate.is_refreshing() is False, "refreshing never cleared"


def test_the_read_timeout_is_generous_enough_for_the_real_download():
    """VPN Gate serves 1.3 MB at about 41 KB/s from this house - 32 seconds,
    measured. A 12-second flat timeout could not finish that download, which is
    why the region list mostly never arrived and, when it did, looked like luck.

    Connect stays short so a DEAD host still fails fast; only the READ is
    patient, and it costs nobody anything now that it runs off the request path.
    """
    t = vpngate._TIMEOUT
    assert t.read is not None and t.read >= 60.0, (
        f"read timeout {t.read}s is too tight for a ~32s download; the list "
        "will keep failing to arrive"
    )
    assert t.connect is not None and t.connect <= 15.0, (
        f"connect timeout {t.connect}s is too slack; a dead host should fail fast"
    )


def test_a_wedged_refresh_does_not_block_every_future_one(monkeypatch):
    """A flag that only ever gets set is a deadlock.

    If a fetch wedges - a half-open socket, a host that accepts and then never
    sends - _refreshing would stay True for the life of the process, every
    later refresh would no-op, and the list would never update again. The
    screen would sit on "fetching regions" forever, which is its own lie.
    """
    # Simulate a refresh claimed long ago that never finished.
    with vpngate._lock:
        vpngate._refreshing = True
        vpngate._refresh_started_at = time.time() - (vpngate._REFRESH_ABANDON_AFTER + 60)
        vpngate._cache_at = 0.0

    fast = _SlowUpstream(delay=0.05)
    monkeypatch.setattr(vpngate.httpx, "get", fast)

    vpngate.ensure_fresh()
    time.sleep(0.6)

    assert fast.calls == 1, (
        "a refresh abandoned long ago still blocked a new one - the flag latched"
    )


def test_a_recent_refresh_is_still_respected(monkeypatch):
    """The escape hatch above must not defeat the stampede guard it sits in."""
    with vpngate._lock:
        vpngate._refreshing = True
        vpngate._refresh_started_at = time.time()  # in flight right now
        vpngate._cache_at = 0.0

    fast = _SlowUpstream(delay=0.05)
    monkeypatch.setattr(vpngate.httpx, "get", fast)

    vpngate.ensure_fresh()
    time.sleep(0.3)

    assert fast.calls == 0, "started a second fetch while one was legitimately running"


def test_a_failing_upstream_keeps_the_previous_list(monkeypatch):
    """A network hiccup must not blank a list that was working a minute ago -
    that would turn a transient fault into a screen saying the feature is gone."""
    import httpx as _httpx

    with vpngate._lock:
        vpngate._cache = [{"CountryShort": "JP", "Score": "1", "HostName": "h", "IP": "1.2.3.4"}]
        vpngate._cache_at = 0.0  # stale, so a refresh is due

    def boom(url, timeout=None):  # noqa: ARG001
        raise _httpx.ConnectError("no route to host")

    monkeypatch.setattr(vpngate.httpx, "get", boom)

    vpngate.ensure_fresh()
    time.sleep(0.4)

    with vpngate._lock:
        assert vpngate._cache, "a failed refresh wiped the cached list"
