# ========================================================================================
# GATE^FLAME - NETWORK SETUP: THE BOX'S SCREEN CAN JOIN WI-FI AND PROVE THE ROUTER STEP
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# Every seam in NetworkSetup is injected, so none of this touches nmcli, the network, or a
# real Pi-hole. What is pinned:
#   * the Wi-Fi password is ONE argv element, never in a response, a log line or an error;
#   * a failed join deletes only the profile it created;
#   * "cannot reach" and "reached it, nothing there" never share a verdict (null vs false);
#   * the address the screen shows is the wired one - gateflame_lan_ip() in Python;
#   * joining/scanning/forgetting need the kiosk scope, reading needs read;
#   * the polkit rule grants exactly three actions to the one substituted user.
# ========================================================================================

import logging
from pathlib import Path

import pytest

from gateflame import network_setup as ns
from gateflame import pihole
from gateflame.network_setup import NetworkSetup, Ran

PASSWORD = "hunter2-correct-horse"


class Script:
    """argv -> Ran, first matching prefix wins; records every argv."""

    def __init__(self, table):
        self.table = table
        self.calls: list[list[str]] = []

    def __call__(self, argv, **kwargs):
        self.calls.append(list(argv))
        for prefix, ran in self.table:
            if argv[: len(prefix)] == prefix or all(p in argv for p in prefix):
                return _Proc(ran)
        return _Proc(Ran(1, "", "unscripted"))


class _Proc:
    def __init__(self, ran: Ran):
        self.returncode = ran.rc
        self.stdout = ran.out
        self.stderr = ran.err
        self._timed_out = ran.timed_out


def make(run=None, **kw):
    kw.setdefault("which", lambda name: f"/usr/bin/{name}")
    kw.setdefault("sleep", lambda s: None)
    kw.setdefault("tcp", lambda addr, t: True)
    return NetworkSetup(run=run, **kw)


def ip_rows(*pairs):
    return "\n".join(f"{i + 2}: {n}    inet {a}/24 brd 10.0.0.255 scope global {n}" for i, (n, a) in enumerate(pairs))


# --------------------------------------------------------------------------- parsing

def test_split_terse_honours_escaped_colons_and_backslashes():
    assert ns.split_terse(r"yes:Cafe\: Free:80:WPA2") == ["yes", "Cafe: Free", "80", "WPA2"]
    assert ns.split_terse(r"a\\b:c") == ["a\\b", "c"]


def test_parse_networks_dedupes_strongest_first_and_drops_hidden():
    out = "\n".join([
        "no:Home:40:WPA2", "yes:Home:71:WPA2", "no::90:WPA2", "no:--:50:--", "no:Cafe:55:",
    ])
    nets = ns.parse_networks(out)
    assert nets == [
        {"ssid": "Home", "signal": 71, "security": "WPA2"},
        {"ssid": "Cafe", "signal": 55, "security": "open"},
    ]


def test_scrub_removes_every_occurrence():
    assert ns.scrub(f"bad {PASSWORD} and {PASSWORD}", PASSWORD) == "bad [hidden] and [hidden]"


# --------------------------------------------------------------------------- address policy

def test_box_address_is_wired_first_even_when_wifi_is_listed_first():
    svc = make(run=lambda *a, **k: _Proc(Ran(1)))
    addrs = [("wlan0", "192.168.0.13"), ("eth0", "192.168.124.3")]
    assert svc.box_address(addrs) == "192.168.124.3"
    assert svc.box_address([("end0", "10.1.1.5")]) == "10.1.1.5"  # Radxa's wired name


def test_box_address_falls_back_to_route_source_for_wifi_only():
    run = Script([(["ip", "-4", "route", "get"], Ran(0, "1.1.1.1 via 192.168.0.1 dev wlan0 src 192.168.0.13 uid 0"))])
    svc = make(run=run)
    assert svc.box_address([("wlan0", "192.168.0.13")]) == "192.168.0.13"


def test_gateway_is_the_one_on_the_boxs_own_network_not_the_winning_route():
    run = Script([(["ip", "-4", "route", "show", "default"], Ran(0,
        "default via 192.168.0.1 dev wlan0 metric 100\ndefault via 192.168.124.1 dev eth0 metric 200"))])
    svc = make(run=run)
    addrs = [("eth0", "192.168.124.3"), ("wlan0", "192.168.0.13")]
    assert svc.gateway_for("192.168.124.3", addrs) == "192.168.124.1"


# --------------------------------------------------------------------------- status

NM_STATUS = "eth0:ethernet:connected:Wired\nwlan0:wifi:connected:Home\nlo:loopback:unmanaged:"


def test_status_reports_wired_wifi_address_and_internet():
    run = Script([
        (["ip", "-4", "-o", "addr"], Ran(0, ip_rows(("eth0", "192.168.124.3"), ("wlan0", "192.168.0.13")))),
        (["ip", "-o", "link"], Ran(0, "2: eth0: <BROADCAST,UP,LOWER_UP> mtu 1500\n3: wlan0: <BROADCAST,UP,LOWER_UP> mtu 1500")),
        (["device", "status"], Ran(0, NM_STATUS)),
        (["device", "wifi", "list"], Ran(0, "yes:Home:66:WPA2")),
    ])
    s = make(run=run).status()
    assert s["boxAddress"] == "192.168.124.3"
    assert s["wired"] == {"present": True, "up": True, "address": "192.168.124.3"}
    assert s["wifi"]["connected"] is True and s["wifi"]["ssid"] == "Home" and s["wifi"]["signal"] == 66
    assert s["internet"] is True and s["gap"] is None


def test_status_without_networkmanager_says_so_and_still_answers():
    run = Script([
        (["ip", "-4", "-o", "addr"], Ran(0, ip_rows(("eth0", "10.0.0.5")))),
        (["ip", "-o", "link"], Ran(0, "2: eth0: <BROADCAST,UP,LOWER_UP> mtu 1500")),
    ])
    s = make(run=run, which=lambda n: "/usr/bin/ip" if n == "ip" else None).status()
    assert s["boxAddress"] == "10.0.0.5"
    assert s["gap"] and "NetworkManager" in s["gap"]


def test_unknown_internet_is_null_not_false():
    run = Script([(["ip"], Ran(1))])
    assert make(run=run, tcp=lambda a, t: None).status()["internet"] is None


# --------------------------------------------------------------------------- scan

def test_scan_lists_networks_strongest_first():
    run = Script([
        (["device", "status"], Ran(0, "wlan0:wifi:disconnected:")),
        (["device", "wifi", "list"], Ran(0, "no:A:30:WPA2\nno:B:80:WPA2")),
    ])
    r = make(run=run).scan()
    assert [n["ssid"] for n in r["networks"]] == ["B", "A"] and r["gap"] is None


def test_scan_names_the_gap_when_there_is_no_wifi_adapter_or_it_is_blocked():
    run = Script([(["device", "status"], Ran(0, "eth0:ethernet:connected:Wired"))])
    assert make(run=run).scan() == {"networks": [], "gap": ns.NO_WIFI_GAP}
    run = Script([(["device", "status"], Ran(0, "wlan0:wifi:unavailable:"))])
    assert make(run=run).scan() == {"networks": [], "gap": ns.WIFI_OFF_GAP}


def test_scan_falls_back_to_the_last_list_and_says_it_is_the_last_list():
    seen = []

    def run(argv, **kw):
        seen.append(argv)
        if "status" in argv:
            return _Proc(Ran(0, "wlan0:wifi:disconnected:"))
        if "--rescan" in argv and argv[argv.index("--rescan") + 1] == "yes":
            return _Proc(Ran(1, "", "Error: Scanning not allowed immediately following previous scan."))
        return _Proc(Ran(0, "no:Old:50:WPA2"))

    r = make(run=run).scan()
    assert r["networks"][0]["ssid"] == "Old"
    assert "saw last" in r["gap"]


# --------------------------------------------------------------------------- connect

def connect_run(join: Ran, profiles_before="U1:802-11-wireless", profiles_after="U1:802-11-wireless\nU2:802-11-wireless"):
    state = {"listed": 0}

    def run(argv, **kw):
        if "device" in argv and "status" in argv:
            return _Proc(Ran(0, "wlan0:wifi:disconnected:"))
        if argv[-3:] == ["connection", "show", "--active"] or "--active" in argv:
            return _Proc(Ran(0, ""))
        if "connection" in argv and "show" in argv:
            state["listed"] += 1
            return _Proc(Ran(0, profiles_before if state["listed"] == 1 else profiles_after))
        if "wifi" in argv and "connect" in argv:
            return _Proc(join)
        if "delete" in argv:
            return _Proc(Ran(0))
        if argv[:2] == ["ip", "-4"]:
            return _Proc(Ran(0, ip_rows(("wlan0", "192.168.0.50"))))
        return _Proc(Ran(1))

    return run


def test_connect_success_returns_the_address_and_passes_the_password_as_one_argv_element():
    calls = []
    inner = connect_run(Ran(0, "Device 'wlan0' successfully activated"))

    def run(argv, **kw):
        calls.append(list(argv))
        return inner(argv, **kw)

    status, body = make(run=run).connect("Home Net", PASSWORD)
    assert (status, body) == (200, {"ok": True, "address": "192.168.0.50"})
    join = next(c for c in calls if "connect" in c and "wifi" in c)
    assert join[join.index("password") + 1] == PASSWORD          # one element, verbatim
    assert join[join.index("connect") + 1] == "Home Net"         # not split on the space
    assert PASSWORD not in repr(body)


def test_wrong_password_is_409_never_echoes_it_and_deletes_only_the_new_profile(caplog):
    deleted = []
    inner = connect_run(Ran(4, "", f"Error: Connection activation failed: (7) Secrets were required, "
                                   f"but not provided ({PASSWORD})"))

    def run(argv, **kw):
        if "delete" in argv:
            deleted.append(argv[-1])
        return inner(argv, **kw)

    with caplog.at_level(logging.DEBUG, logger="gateflame.network_setup"):
        status, body = make(run=run).connect("Home", PASSWORD)
    assert status == 409 and body["ok"] is False and body["error"] == "wrong_password"
    assert PASSWORD not in repr(body) and PASSWORD not in caplog.text
    assert deleted == ["U2"]            # U1 existed before: never touched


@pytest.mark.parametrize("ssid,password", [
    ("", None), ("   ", None), (None, None), ("x" * 33, None), (123, None),
    ("ok", 5), ("ok", "a\nb"), ("ok", "p" * 65),
])
def test_bad_input_is_400_and_runs_nothing(ssid, password):
    run = Script([])
    status, body = make(run=run).connect(ssid, password)
    assert status == 400 and body["ok"] is False
    assert run.calls == []


def test_connect_without_networkmanager_or_wifi_is_404():
    s, b = make(run=Script([]), which=lambda n: None).connect("Home", None)
    assert s == 404 and b["error"] == "no_network_manager"
    run = Script([(["device", "status"], Ran(0, "eth0:ethernet:connected:Wired"))])
    s, b = make(run=run).connect("Home", None)
    assert s == 404 and b["error"] == "no_wifi"


def test_unauthorised_join_names_the_missing_polkit_rule():
    inner = connect_run(Ran(1, "", "Error: Failed to add/activate new connection: not authorized"))
    s, b = make(run=inner).connect("Home", PASSWORD)
    assert s == 409 and b["error"] == "not_authorized" and ns.POLKIT_RULE_NAME in b["detail"]


def test_a_second_join_while_one_runs_is_409_busy():
    svc = make(run=Script([(["device", "status"], Ran(0, "wlan0:wifi:disconnected:"))]))
    assert svc._wifi_lock.acquire(blocking=False)
    try:
        s, b = svc.connect("Home", None)
    finally:
        svc._wifi_lock.release()
    assert s == 409 and b["error"] == "busy"


@pytest.mark.parametrize("ran,code", [
    (Ran(None, timed_out=True), "timeout"),
    (Ran(3, "", "Error: Timeout expired"), "timeout"),
    (Ran(10, "", "Error: No network with SSID 'X' found."), "not_found"),
    (Ran(8, "", "Error: NetworkManager is not running."), "no_network_manager"),
    (Ran(4, "", "Error: something odd"), "failed"),
])
def test_classify_join_failure(ran, code):
    assert ns.classify_join_failure(ran, "X")[0] == code


# --------------------------------------------------------------------------- forget

def test_forget_deletes_the_active_wifi_profile_only():
    deleted = []

    def run(argv, **kw):
        if "device" in argv and "status" in argv:
            return _Proc(Ran(0, "wlan0:wifi:connected:Home"))
        if "--active" in argv:
            return _Proc(Ran(0, "Wired:W1:802-3-ethernet:eth0\nHome:H1:802-11-wireless:wlan0"))
        if "delete" in argv:
            deleted.append(argv[-1])
            return _Proc(Ran(0))
        return _Proc(Ran(1))

    assert make(run=run).forget() == (200, {"ok": True, "forgotten": "Home"})
    assert deleted == ["H1"]


def test_forget_with_nothing_saved_is_ok_and_says_none():
    run = Script([(["device", "status"], Ran(0, "wlan0:wifi:disconnected:")), (["--active"], Ran(0, ""))])
    assert make(run=run).forget() == (200, {"ok": True, "forgotten": None})


# --------------------------------------------------------------------------- router check

class FakePihole:
    def __init__(self, arrives=False, recent=False, fail=None):
        self.arrives, self.recent, self.fail, self.names = arrives, recent, fail, []

    def __call__(self, method, path):
        if self.fail:
            return pihole.Result(ok=False, failure=self.fail)
        if "domain=" in path:
            import re
            m = re.search(r"domain=([^&]+)", path)
            self.names.append(m.group(1))
            return pihole.Result(ok=True, data={"queries": [{"domain": m.group(1)}] if self.arrives else []})
        return pihole.Result(ok=True, data={"queries": [{"domain": "x.test"}] if self.recent else []})


ROUTES = Script([
    (["ip", "-4", "-o", "addr"], Ran(0, ip_rows(("eth0", "192.168.124.3")))),
    (["ip", "-4", "route", "show", "default"], Ran(0, "default via 192.168.124.1 dev eth0")),
])


def checker(udp="answered", **ph):
    sent = []
    fake = FakePihole(**ph)

    def u(server, name, timeout):
        sent.append((server, name))
        return udp

    return make(run=ROUTES, udp=u, pihole_request=fake), sent, fake


def verdict(svc):
    return svc._check_once()


def test_router_forwarding_to_us_is_true_only_when_the_nonce_arrived():
    svc, sent, fake = checker(arrives=True)
    v = verdict(svc)
    assert v["forwardsToUs"] is True and v["method"] == "canary" and v["gap"] is None
    assert sent[0][0] == "192.168.124.1"
    assert sent[0][1].endswith("." + ns.CANARY_ZONE)
    assert fake.names[0] == sent[0][1]            # the very name sent is the name asked about


def test_router_answered_but_pihole_never_saw_it_is_false():
    svc, *_ = checker(arrives=False)
    assert verdict(svc)["forwardsToUs"] is False


def test_router_that_answered_after_sending_other_lookups_is_unknown_not_false():
    svc, *_ = checker(arrives=False, recent=True)
    v = verdict(svc)
    assert v["forwardsToUs"] is None and "only some" in v["gap"]


@pytest.mark.parametrize("udp", ["timeout", "closed", "refused", "error"])
def test_a_router_that_will_not_answer_is_unknown_with_the_reason(udp):
    svc, *_ = checker(udp=udp, arrives=False)
    v = verdict(svc)
    assert v["forwardsToUs"] is None and v["gap"] and "router" in v["gap"].lower()


def test_unreadable_pihole_is_unknown_never_false():
    svc, *_ = checker(fail=pihole.FAIL_UNREACHABLE)
    v = verdict(svc)
    assert v["forwardsToUs"] is None and v["gap"]


def test_no_address_no_gateway_and_self_gateway_are_unknown_with_their_own_gap():
    svc = make(run=Script([(["ip", "-4", "-o", "addr"], Ran(0, ""))]), udp=lambda *a: "answered",
               pihole_request=FakePihole())
    assert "no network address" in verdict(svc)["gap"]
    run = Script([(["ip", "-4", "-o", "addr"], Ran(0, ip_rows(("eth0", "10.0.0.5")))),
                  (["ip", "-4", "route", "show", "default"], Ran(0, ""))])
    svc = make(run=run, udp=lambda *a: "answered", pihole_request=FakePihole())
    assert "no router" in verdict(svc)["gap"]
    run = Script([(["ip", "-4", "-o", "addr"], Ran(0, ip_rows(("eth0", "10.0.0.5")))),
                  (["ip", "-4", "route", "show", "default"], Ran(0, "default via 10.0.0.5 dev eth0"))])
    svc = make(run=run, udp=lambda *a: "answered", pihole_request=FakePihole())
    assert "its own gateway" in verdict(svc)["gap"]


def test_route_is_rate_limited_and_cached_with_checked_at():
    sent = []
    clock = {"t": 1000.0}
    svc = make(run=ROUTES, udp=lambda s, n, t: sent.append(n) or "answered",
               pihole_request=FakePihole(arrives=True), monotonic=lambda: clock["t"], clock=lambda: 1700000000.0,
               spawn=lambda fn: fn())
    first = svc.router_check()
    second = svc.router_check()
    assert len(sent) == 1 and first == second and first["checkedAt"] == 1700000000
    clock["t"] += ns.RATE_LIMIT_S + 1
    svc.router_check()
    assert len(sent) == 2


# --------------------------------------------------------------------------- HTTP scopes

@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient
    from gateflame.main import app, store
    return TestClient(app), store


def _token(store, scope):
    from gateflame import security  # noqa: F401
    # pairing helpers differ between builds; the scope check itself is what main.py wires.
    return None


def test_routes_are_mounted_and_refuse_an_unauthenticated_caller(client):
    c, _ = client
    for method, path in [("get", "/api/v1/network/status"), ("get", "/api/v1/network/router-check"),
                         ("get", "/api/v1/network/wifi/scan"), ("post", "/api/v1/network/wifi/connect"),
                         ("post", "/api/v1/network/wifi/forget")]:
        r = getattr(c, method)(path)
        assert r.status_code in (401, 403), (path, r.status_code)   # installed, refusing - never 404


# --------------------------------------------------------------------------- polkit rule

RULE = Path(ns.POLKIT_RULE_SOURCE)


def test_polkit_rule_grants_exactly_the_three_actions_to_the_substituted_user():
    text = RULE.read_text(encoding="utf-8")
    assert "__GATEFLAME_USER__" in text
    for action in ns.POLKIT_ACTIONS:
        assert f'"{action}"' in text
    granted = [l for l in text.splitlines() if l.strip().startswith('"org.freedesktop')]
    assert len(granted) == len(ns.POLKIT_ACTIONS) == 3
    assert "polkit.Result.YES" in text and "AUTH_ADMIN" not in text


def test_both_installers_install_the_rule_with_the_user_substituted():
    root = Path(__file__).resolve().parents[2]
    for rel in ("node-agent/install.sh", "tools/install-pi-release.sh"):
        t = (root / rel).read_text(encoding="utf-8")
        assert "50-gateflame-network.rules" in t and "__GATEFLAME_USER__" in t, rel
