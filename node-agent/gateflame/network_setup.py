"""Network setup from the box's own screen: join the household network, show the
box's address, and READ BACK whether the router took the one step ADR-001 asks of it.

    GET  /api/v1/network/status          read   wired, Wi-Fi, the box's address, internet
    GET  /api/v1/network/wifi/scan       kiosk  networks in range
    POST /api/v1/network/wifi/connect    kiosk  join one: {"ssid": ..., "password": ...}
    POST /api/v1/network/wifi/forget     kiosk  drop the Wi-Fi profile in use
    GET  /api/v1/network/router-check    read   does the router pass lookups to this box?

Its own APIRouter; main.py includes it with its own scope dependencies. Joining,
scanning and forgetting are `kiosk` scope - physical presence at the box, like
stopping a module. A paired phone may read where the box is and whether the router
forwards to it; it can never move the box onto another network.

NETWORKMANAGER, THROUGH nmcli -t
Raspberry Pi OS (Bookworm/Trixie) and Radxa OS both ship NetworkManager. The agent
runs as the unprivileged `gateflame` user, so NetworkManager asks polkit; the
installers put gateflame/polkit/50-gateflame-network.rules in /etc/polkit-1/rules.d,
granting exactly network-control, wifi.scan and settings.modify.system to that one
user. Without NetworkManager every route still answers: status reports what `ip`
can see, and the Wi-Fi fields carry the gap "NetworkManager is not available on
this box". Every call has a timeout; nothing here can hold a worker forever.

THE WI-FI PASSWORD
Passed to nmcli as ONE argv element of subprocess.run([...]) - never a shell
string. It is never logged, never echoed in a response, and scrubbed from nmcli's
own output before any of that output is used. A failed join deletes the profile
nmcli created for it, so a wrong password is not left behind to autoconnect. (While
nmcli runs, argv is readable in /proc by local users; on an appliance whose local
users are system accounts that window is the accepted cost. NetworkManager then
keeps the password in a root-only keyfile.)

THE BOX'S ADDRESS - WIRED FIRST
Same policy as gateflame_lan_ip() in dns-watchdog.sh and every installer: the first
global IPv4 on an UP interface named eth*/en*, else the `src` of the default route.
Decided 2026-10-03, after the lab Pi re-homed its resolver onto household Wi-Fi when
wlan0 won the default route. The address this screen tells the owner to type into
the router must be the address the resolver is bound to.

THE ROUTER CHECK - A READ-BACK, NOT A GUESS
ADR-001's one customer step is "set the router's DNS to this box". Whether the
router took it is proved, not inferred:

  1. one DNS query for a fresh name, <16 hex>.gf-router-check.invalid, goes to the
     router on the box's own network, UDP port 53, 3 s;
  2. Pi-hole on this box is asked (GET /api/queries?domain=<name>, parameters
     checked 2026-10-03 against the spec the lab box's Pi-hole serves at
     /api/docs/specs/queries.yaml) whether that exact name arrived, twice, 2 s apart.

  the name arrived                              -> forwardsToUs: true
  the router answered, Pi-hole never saw it     -> false
  router silent or refused, Pi-hole unreadable,
  no address or no router                       -> null, and `gap` names which

The nonce is known to nothing but this check, so its arrival can only mean the
router passed our query on. It normally arrives from the router's own address; a
router that redirects port 53 by NAT can make it arrive from another one, and it
still came through the router, so it counts. `.invalid` is reserved by RFC 6761 and
never resolves: Unbound's default local zones answer it on the box, so the name
does not travel on to the root servers, and a router that sends it to its ISP
instead teaches the ISP one random label.

One refinement of `false`: if the name did not arrive but Pi-hole has seen OTHER
lookups from that router in the last five minutes, the verdict is null with that
said in `gap` - the router sends this box some lookups (a second DNS server set on
the router, or a router that answers `.invalid` itself, as RFC 6761 allows), and one
missed test lookup does not justify telling the owner it sends none.

Blind spot, stated: a Pi-hole whose privacy level hides domains cannot confirm the
name. The Gate^Flame stack leaves it at the default, 0.

Rate limited: at most one test lookup per 10 s; the verdict is cached with
`checkedAt`. The route never waits more than ~2.5 s, so a polling phone with a 4 s
client timeout gets the last verdict while a fresh one runs.
"""

from __future__ import annotations

import errno
import ipaddress
import logging
import os
import re
import secrets
import shutil
import socket
import struct
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from . import pihole

logger = logging.getLogger("gateflame.network_setup")

# ---------------------------------------------------------------------------
# Words the screens render verbatim
# ---------------------------------------------------------------------------

NM_GAP = "NetworkManager is not available on this box"
NO_WIFI_GAP = "This box has no Wi-Fi adapter"
WIFI_OFF_GAP = (
    "The Wi-Fi adapter on this box is switched off or blocked "
    "(NetworkManager reports it as unavailable)"
)
IP_GAP = "The ip command is not available on this box, so its addresses cannot be read"
POLKIT_RULE_NAME = "50-gateflame-network.rules"
POLKIT_RULE_TARGET = "/etc/polkit-1/rules.d/" + POLKIT_RULE_NAME
POLKIT_GAP = (
    "NetworkManager refused the agent: the Wi-Fi permission installed with it "
    f"({POLKIT_RULE_TARGET}) is missing - re-run the installer"
)

# The rule ships INSIDE the package, so every path that installs the package - install.sh
# on a fresh box, tools/install-pi-release.sh on an upgrade - has the same file to copy.
POLKIT_RULE_SOURCE = Path(__file__).resolve().parent / "polkit" / POLKIT_RULE_NAME
POLKIT_ACTIONS = (
    "org.freedesktop.NetworkManager.network-control",
    "org.freedesktop.NetworkManager.wifi.scan",
    "org.freedesktop.NetworkManager.settings.modify.system",
)

# ---------------------------------------------------------------------------
# Knobs
# ---------------------------------------------------------------------------

WIRED_RE = re.compile(r"^(eth|en)")  # eth0, end0 (Radxa), enp1s0 - the LAN-IP policy's set
WIFI_RE = re.compile(r"^wl")         # wlan0, wlp2s0 - used only when NetworkManager is absent

CANARY_ZONE = "gf-router-check.invalid"
CANARY_TIMEOUT_S = 3.0
CANARY_POLLS = 2
CANARY_POLL_GAP_S = 2.0
RECENT_WINDOW_S = 300
RATE_LIMIT_S = 10.0
ROUTE_WAIT_S = 2.5

INTERNET_TARGET = ("1.1.1.1", 443)
INTERNET_TIMEOUT_S = 2.0
INTERNET_TTL_S = 15.0

NMCLI_TIMEOUT_S = 8
SCAN_TIMEOUT_S = 20
CONNECT_WAIT_S = 40          # nmcli --wait; the subprocess gets 10 s more
IP_TIMEOUT_S = 5
ADDRESS_WAIT_TRIES = 5       # after a join, seconds to wait for DHCP to hand out an address
MAX_NETWORKS = 40
WIFI_FIELDS = "ACTIVE,SSID,SIGNAL,SECURITY"
WIFI_PROFILE_TYPE = "802-11-wireless"

_NO_ROUTE_ERRNOS = frozenset(
    getattr(errno, name)
    for name in ("ENETUNREACH", "EHOSTUNREACH", "ENETDOWN", "EHOSTDOWN", "ETIMEDOUT", "ECONNREFUSED")
    if hasattr(errno, name)
)


# ---------------------------------------------------------------------------
# Small pure helpers (tested directly)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Ran:
    """One subprocess. `rc` is None when it did not run to completion."""

    rc: int | None
    out: str = ""
    err: str = ""
    timed_out: bool = False


def split_terse(line: str) -> list[str]:
    """One `nmcli -t` line into fields.

    In terse mode nmcli escapes ':' and '\\' inside a value with a backslash, so an
    SSID such as "Cafe: Free" arrives as `Cafe\\: Free` and must not be split there.
    """
    fields: list[str] = []
    cur: list[str] = []
    chars = iter(line)
    for ch in chars:
        if ch == "\\":
            cur.append(next(chars, ""))
        elif ch == ":":
            fields.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    fields.append("".join(cur))
    return fields


def scrub(text: str | None, secret: str | None) -> str:
    """`text` with every occurrence of `secret` removed. Used on anything nmcli says."""
    if not text:
        return ""
    if not secret:
        return text
    return text.replace(secret, "[hidden]")


def _int(value) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _first_line(text: str | None, limit: int = 200) -> str:
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.lower().startswith("error: "):
            line = line[7:]
        return line[:limit]
    return ""


def _err(code: str, detail: str) -> dict:
    return {"ok": False, "error": code, "detail": detail}


def parse_ipv4_addrs(out: str) -> list[tuple[str, str]]:
    """[(ifname, address)] from `ip -4 -o addr show ...`, in the order ip printed them."""
    found: list[tuple[str, str]] = []
    for line in (out or "").splitlines():
        tok = line.split()
        if len(tok) < 4 or "inet" not in tok:
            continue
        i = tok.index("inet")
        if i + 1 >= len(tok):
            continue
        name = tok[1].rstrip(":").split("@", 1)[0]
        addr = tok[i + 1].split("/", 1)[0]
        try:
            ipaddress.IPv4Address(addr)
        except ValueError:
            continue
        found.append((name, addr))
    return found


_LINK_RE = re.compile(r"^\d+:\s+([^:\s@]+)(?:@[^:\s]+)?:\s+<([^>]*)>")


def parse_links(out: str) -> dict[str, bool]:
    """{ifname: carrier} from `ip -o link show`. Carrier = LOWER_UP (a cable or an
    association), which is what "the wire is up" means to someone looking at it."""
    links: dict[str, bool] = {}
    for line in (out or "").splitlines():
        m = _LINK_RE.match(line.strip())
        if m:
            links[m.group(1)] = "LOWER_UP" in m.group(2).split(",")
    return links


def _token_after(out: str, word: str) -> str | None:
    tok = (out or "").split()
    for i, t in enumerate(tok[:-1]):
        if t == word:
            return tok[i + 1]
    return None


def parse_default_routes(out: str) -> list[tuple[str | None, str | None]]:
    """[(via, dev)] for every `default ...` line of `ip -4 route show default`."""
    routes: list[tuple[str | None, str | None]] = []
    for line in (out or "").splitlines():
        if not line.strip().startswith("default"):
            continue
        routes.append((_token_after(line, "via"), _token_after(line, "dev")))
    return routes


def parse_networks(out: str) -> list[dict]:
    """Rows of `nmcli -t -f ACTIVE,SSID,SIGNAL,SECURITY device wifi list` into the
    scan contract: one entry per SSID (its strongest access point), hidden networks
    left out (there is no name to show or to join), strongest first."""
    best: dict[str, dict] = {}
    for line in (out or "").splitlines():
        f = split_terse(line)
        if len(f) < 4:
            continue
        ssid = f[1]
        if not ssid or ssid == "--":
            continue
        signal = max(0, min(100, _int(f[2]) or 0))
        security = f[3].strip()
        entry = {"ssid": ssid, "signal": signal, "security": "open" if security in ("", "--") else security}
        current = best.get(ssid)
        if current is None or signal > current["signal"]:
            best[ssid] = entry
    return sorted(best.values(), key=lambda n: (-n["signal"], n["ssid"].lower()))[:MAX_NETWORKS]


_WRONG_PASSWORD = (
    "secrets were required",
    "no secrets",
    "802-11-wireless-security.psk",
    "invalid passphrase",
    "4-way handshake",
)
_NOT_AUTHORIZED = ("not authorized", "insufficient privileges", "permission denied")
_NOT_FOUND = ("no network with ssid",)


def classify_join_failure(ran: Ran, ssid: str) -> tuple[str, str]:
    """(error code, the sentence the screen shows) for a join nmcli did not complete.

    nmcli exit codes: 3 timeout, 4 activation failed, 8 NetworkManager not running,
    10 no such connection/device/access point. The text decides the rest.
    """
    text = f"{ran.err}\n{ran.out}".lower()
    if ran.timed_out or ran.rc == 3 or "timeout expired" in text:
        return "timeout", f"Joining “{ssid}” did not finish in time. Check that it is in range and try again."
    if any(m in text for m in _WRONG_PASSWORD):
        return "wrong_password", f"“{ssid}” did not accept that password."
    if any(m in text for m in _NOT_AUTHORIZED):
        return "not_authorized", POLKIT_GAP
    if ran.rc == 10 or any(m in text for m in _NOT_FOUND):
        return "not_found", f"No network called “{ssid}” is in range right now."
    if ran.rc == 8 or "networkmanager is not running" in text:
        return "no_network_manager", NM_GAP
    return "failed", f"Joining “{ssid}” failed."


def _router_silence_gap(outcome: str, gateway: str) -> str:
    tail = "so this box cannot tell whether it passes lookups here"
    if outcome == "timeout":
        return f"Your router ({gateway}) did not answer a DNS lookup within {CANARY_TIMEOUT_S:g} seconds, {tail}"
    if outcome == "closed":
        return f"Your router ({gateway}) does not accept DNS lookups (nothing answers on port 53), {tail}"
    if outcome == "refused":
        return f"Your router ({gateway}) refused the DNS lookup, {tail}"
    return f"The test lookup could not be sent to your router ({gateway}), {tail}"


# ---------------------------------------------------------------------------
# The two pieces that touch the network directly (replaced in tests)
# ---------------------------------------------------------------------------


def udp_query(server: str, name: str, timeout: float) -> str:
    """Send ONE DNS query for `name` (type A) to server:53.

    Returns 'answered' | 'refused' (RCODE 5) | 'closed' (ICMP port unreachable) |
    'timeout' | 'error'. Hand-rolled like upstream._resolve_through_box, for the same
    reason: the point is to ask THAT server, not whatever /etc/resolv.conf names. The
    socket is connected, so only a reply from the router itself is read.
    """
    qid = secrets.randbelow(0x10000)
    packet = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0)
    for label in name.strip(".").split("."):
        raw = label.encode("ascii")
        packet += bytes([len(raw)]) + raw
    packet += b"\x00" + struct.pack(">HH", 1, 1)
    deadline = time.monotonic() + timeout
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect((server, 53))
        sock.send(packet)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return "timeout"
            sock.settimeout(remaining)
            data = sock.recv(512)
            if len(data) < 12:
                continue
            rid, flags = struct.unpack(">HH", data[:4])
            if rid != qid or not flags & 0x8000:
                continue
            return "refused" if (flags & 0x000F) == 5 else "answered"
    except (TimeoutError, socket.timeout):
        return "timeout"
    except ConnectionRefusedError:
        return "closed"
    except OSError:
        return "error"
    finally:
        sock.close()


def tcp_probe(addr: tuple[str, int], timeout: float) -> bool | None:
    """True: a TCP connection opened. False: no route, timed out, refused. None: the
    probe itself could not be made, which says nothing about the internet."""
    try:
        with socket.create_connection(addr, timeout=timeout):
            return True
    except (TimeoutError, socket.timeout, ConnectionError):
        return False
    except OSError as exc:
        return False if exc.errno in _NO_ROUTE_ERRNOS else None
    except Exception:  # noqa: BLE001 - "could not look" must never read as "no internet"
        return None


def _start_thread(fn) -> None:
    threading.Thread(target=fn, name="gateflame-router-check", daemon=True).start()


def _c_locale_env() -> dict:
    # nmcli's messages are matched as text (classify_join_failure); ask for them in C.
    return {**os.environ, "LC_ALL": "C", "LANG": "C"}


# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------


class NetworkSetup:
    """Every seam is injectable and resolved at call time, so a test can replace
    `subprocess.run` (or pass `run=`), the UDP sender, the TCP probe, Pi-hole, the
    clocks, `sleep` and how the background check is started."""

    def __init__(self, *, run=None, which=None, udp=None, tcp=None, pihole_request=None,
                 sleep=None, clock=None, monotonic=None, spawn=None):
        self._run_fn = run
        self._which_fn = which
        self._udp_fn = udp
        self._tcp_fn = tcp
        self._pihole_fn = pihole_request
        self._sleep_fn = sleep
        self._clock_fn = clock
        self._mono_fn = monotonic
        self._spawn_fn = spawn
        self._wifi_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._internet_cache: tuple[bool | None, float] | None = None
        self._rc_last: dict | None = None
        self._rc_last_at = 0.0
        self._rc_inflight: threading.Event | None = None
        self._rc_logged: object = object()

    # ------------------------------------------------------------- seams

    def _run(self, argv: list[str], timeout: float) -> Ran:
        run = self._run_fn or subprocess.run
        try:
            proc = run(argv, capture_output=True, text=True, timeout=timeout, check=False,
                       env=_c_locale_env())
        except subprocess.TimeoutExpired:
            # The exception carries argv - for a join, the Wi-Fi password. It is dropped
            # HERE: never logged, never re-raised, never turned into a message.
            return Ran(None, timed_out=True)
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            return Ran(None, err=f"{os.path.basename(argv[0])} could not be run ({type(exc).__name__})")
        return Ran(proc.returncode, proc.stdout or "", proc.stderr or "")

    def _which(self, name: str) -> str | None:
        return (self._which_fn or shutil.which)(name)

    def _now(self) -> float:
        return (self._clock_fn or time.time)()

    def _mono(self) -> float:
        return (self._mono_fn or time.monotonic)()

    def _sleep(self, seconds: float) -> None:
        (self._sleep_fn or time.sleep)(seconds)

    def _pihole(self, method: str, path: str) -> pihole.Result:
        return (self._pihole_fn or pihole.request)(method, path)

    def _udp(self, server: str, name: str, timeout: float) -> str:
        return (self._udp_fn or udp_query)(server, name, timeout)

    def _tcp(self, addr: tuple[str, int], timeout: float) -> bool | None:
        return (self._tcp_fn or tcp_probe)(addr, timeout)

    def _spawn(self, fn) -> None:
        (self._spawn_fn or _start_thread)(fn)

    # --------------------------------------------------------------- ip

    def _ipv4_addrs(self) -> list[tuple[str, str]] | None:
        ran = self._run(["ip", "-4", "-o", "addr", "show", "scope", "global", "up"], IP_TIMEOUT_S)
        return parse_ipv4_addrs(ran.out) if ran.rc == 0 else None

    def _links(self) -> dict[str, bool] | None:
        ran = self._run(["ip", "-o", "link", "show"], IP_TIMEOUT_S)
        return parse_links(ran.out) if ran.rc == 0 else None

    def _route_src(self) -> str | None:
        ran = self._run(["ip", "-4", "route", "get", "1.1.1.1"], IP_TIMEOUT_S)
        return _token_after(ran.out, "src") if ran.rc == 0 else None

    def _default_routes(self) -> list[tuple[str | None, str | None]]:
        ran = self._run(["ip", "-4", "route", "show", "default"], IP_TIMEOUT_S)
        return parse_default_routes(ran.out) if ran.rc == 0 else []

    def box_address(self, addrs: list[tuple[str, str]] | None) -> str | None:
        """WIRED FIRST - gateflame_lan_ip() in Python. See the module docstring."""
        for name, addr in addrs or []:
            if WIRED_RE.match(name):
                return addr
        return self._route_src()

    def gateway_for(self, box: str | None, addrs: list[tuple[str, str]] | None) -> str | None:
        """The router on the network the box's address is on - not whichever default
        route won. On a dual-homed box the Wi-Fi network's router is not the one that
        could forward to the wired address."""
        if not box:
            return None
        box_if = next((name for name, addr in addrs or [] if addr == box), None)
        routes = self._default_routes()
        if box_if is None:
            # The address came from the route itself; that route's router is the one.
            return next((via for via, _dev in routes if via), None)
        return next((via for via, dev in routes if via and dev == box_if), None)

    def _address_on(self, device: str) -> str | None:
        ran = self._run(["ip", "-4", "-o", "addr", "show", "dev", device, "scope", "global"], IP_TIMEOUT_S)
        found = parse_ipv4_addrs(ran.out) if ran.rc == 0 else []
        return found[0][1] if found else None

    # ---------------------------------------------------------- nmcli

    def _nm(self) -> tuple[str | None, list[dict] | None, str | None]:
        """(nmcli path, devices, gap). devices is None when NetworkManager cannot be read."""
        nmcli = self._which("nmcli")
        if not nmcli:
            return None, None, NM_GAP
        ran = self._run([nmcli, "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"], NMCLI_TIMEOUT_S)
        if ran.rc != 0:
            text = f"{ran.err}\n{ran.out}".lower()
            if ran.timed_out:
                return nmcli, None, f"NetworkManager did not answer within {NMCLI_TIMEOUT_S} seconds"
            if ran.rc == 8 or "not running" in text or ran.rc is None:
                return nmcli, None, NM_GAP
            return nmcli, None, f"NetworkManager could not be read ({_first_line(ran.err) or f'nmcli exit {ran.rc}'})"
        devices = []
        for line in ran.out.splitlines():
            f = split_terse(line)
            if len(f) >= 3 and f[0]:
                devices.append({
                    "device": f[0],
                    "type": f[1],
                    "state": f[2],
                    "connection": (f[3] if len(f) > 3 else "") or None,
                })
        return nmcli, devices, None

    @staticmethod
    def _pick_wifi(devices: list[dict]) -> dict | None:
        wifi = [d for d in devices if d["type"] == "wifi"]
        for d in wifi:
            if d["state"].startswith("connected"):
                return d
        return wifi[0] if wifi else None

    @staticmethod
    def _wifi_list_argv(nmcli: str, device: str, rescan: str) -> list[str]:
        return [nmcli, "-t", "-f", WIFI_FIELDS, "device", "wifi", "list", "--rescan", rescan, "ifname", device]

    def _active_wifi(self, nmcli: str, device: str) -> tuple[str | None, int | None]:
        ran = self._run(self._wifi_list_argv(nmcli, device, "no"), NMCLI_TIMEOUT_S)
        if ran.rc != 0:
            return None, None
        for line in ran.out.splitlines():
            f = split_terse(line)
            if len(f) >= 4 and f[0] == "yes":
                return (f[1] or None), _int(f[2])
        return None, None

    def _wifi_profiles(self, nmcli: str) -> set[str] | None:
        ran = self._run([nmcli, "-t", "-f", "UUID,TYPE", "connection", "show"], NMCLI_TIMEOUT_S)
        if ran.rc != 0:
            return None
        uuids = set()
        for line in ran.out.splitlines():
            f = split_terse(line)
            if len(f) >= 2 and f[1] == WIFI_PROFILE_TYPE and f[0]:
                uuids.add(f[0])
        return uuids

    def _active_profile_on(self, nmcli: str, device: str) -> tuple[str | None, str | None]:
        ran = self._run([nmcli, "-t", "-f", "NAME,UUID,TYPE,DEVICE", "connection", "show", "--active"],
                        NMCLI_TIMEOUT_S)
        if ran.rc != 0:
            return None, None
        for line in ran.out.splitlines():
            f = split_terse(line)
            if len(f) >= 4 and f[3] == device and f[2] == WIFI_PROFILE_TYPE:
                return f[1] or None, f[0] or None
        return None, None

    # ---------------------------------------------------------- status

    def _internet(self) -> bool | None:
        now = self._mono()
        with self._state_lock:
            cached = self._internet_cache
        if cached is not None and now - cached[1] < INTERNET_TTL_S:
            return cached[0]
        value = self._tcp(INTERNET_TARGET, INTERNET_TIMEOUT_S)
        with self._state_lock:
            self._internet_cache = (value, now)
        return value

    def status(self) -> dict:
        gaps: list[str] = []
        addrs = self._ipv4_addrs()
        links = self._links()
        if addrs is None or links is None:
            gaps.append(IP_GAP)
        addr_list = addrs or []
        link_map = links or {}

        wired_names = [n for n in link_map if WIRED_RE.match(n)]
        wired_addr = next((a for n, a in addr_list if WIRED_RE.match(n)), None)
        wired = {
            "present": bool(wired_names) or wired_addr is not None,
            "up": any(link_map[n] for n in wired_names),
            "address": wired_addr,
        }

        wifi = {"present": False, "connected": False, "ssid": None, "address": None, "signal": None}
        nmcli, devices, nm_gap = self._nm()
        if devices is not None and nmcli:
            dev = self._pick_wifi(devices)
            if dev is not None:
                wifi["present"] = True
                wifi["connected"] = dev["state"].startswith("connected")
                wifi["address"] = next((a for n, a in addr_list if n == dev["device"]), None)
                if wifi["connected"]:
                    wifi["ssid"], wifi["signal"] = self._active_wifi(nmcli, dev["device"])
        else:
            gaps.append(nm_gap or NM_GAP)
            # Without NetworkManager, report only what `ip` can see. No SSID, no signal.
            wl_names = [n for n in link_map if WIFI_RE.match(n)]
            wifi["address"] = next((a for n, a in addr_list if WIFI_RE.match(n)), None)
            wifi["present"] = bool(wl_names) or wifi["address"] is not None
            wifi["connected"] = wifi["address"] is not None

        return {
            "wired": wired,
            "wifi": wifi,
            "boxAddress": self.box_address(addrs) if addrs is not None else None,
            "internet": self._internet(),
            "gap": "; ".join(gaps) or None,
        }

    # ------------------------------------------------------------ scan

    def scan(self) -> dict:
        nmcli, devices, gap = self._nm()
        if devices is None or not nmcli:
            return {"networks": [], "gap": gap or NM_GAP}
        dev = self._pick_wifi(devices)
        if dev is None:
            return {"networks": [], "gap": NO_WIFI_GAP}
        if dev["state"] == "unavailable":
            return {"networks": [], "gap": WIFI_OFF_GAP}

        ran = self._run(self._wifi_list_argv(nmcli, dev["device"], "yes"), SCAN_TIMEOUT_S)
        if ran.rc == 0:
            return {"networks": parse_networks(ran.out), "gap": None}

        # A fresh scan was refused or ran out of time. What NetworkManager saw last is
        # still worth showing - labelled as exactly that.
        why = self._nm_reason(ran, "it did not finish in time")
        cached = self._run(self._wifi_list_argv(nmcli, dev["device"], "no"), NMCLI_TIMEOUT_S)
        if cached.rc != 0:
            return {"networks": [], "gap": f"NetworkManager could not list Wi-Fi networks: {why}"}
        return {
            "networks": parse_networks(cached.out),
            "gap": f"NetworkManager would not run a fresh scan ({why}); these are the networks it saw last",
        }

    @staticmethod
    def _nm_reason(ran: Ran, timeout_words: str) -> str:
        if ran.timed_out:
            return timeout_words
        text = f"{ran.err}\n{ran.out}".lower()
        if any(m in text for m in _NOT_AUTHORIZED):
            return POLKIT_GAP
        return _first_line(ran.err) or _first_line(ran.out) or f"nmcli exit {ran.rc}"

    # --------------------------------------------------------- connect

    def connect(self, ssid, password) -> tuple[int, dict]:
        """(HTTP status, body). 200 joined | 400 bad input | 404 no Wi-Fi | 409 refused."""
        if not isinstance(ssid, str) or not ssid.strip() or len(ssid.encode("utf-8")) > 32:
            return 400, _err("bad_ssid", "Choose a network name of 1 to 32 characters.")
        if password is not None and not isinstance(password, str):
            return 400, _err("bad_password", "The password must be text.")
        if password == "":
            password = None
        if password is not None and (len(password) > 64 or any(c in password for c in "\x00\r\n")):
            return 400, _err("bad_password", "That is not a Wi-Fi password (at most 64 characters, one line).")

        nmcli, devices, gap = self._nm()
        if devices is None or not nmcli:
            return 404, _err("no_network_manager", gap or NM_GAP)
        dev = self._pick_wifi(devices)
        if dev is None:
            return 404, _err("no_wifi", NO_WIFI_GAP)
        if dev["state"] == "unavailable":
            return 409, _err("wifi_unavailable", WIFI_OFF_GAP)

        if not self._wifi_lock.acquire(blocking=False):
            return 409, _err("busy", "Another Wi-Fi change is already in progress on this box.")
        try:
            before = self._wifi_profiles(nmcli)
            argv = [nmcli, "--wait", str(CONNECT_WAIT_S), "device", "wifi", "connect", ssid]
            if password is not None:
                argv += ["password", password]  # ONE argv element. Never a shell string.
            argv += ["ifname", dev["device"]]
            ran = self._run(argv, CONNECT_WAIT_S + 10)
            del argv

            if ran.rc == 0:
                address = self._wait_for_address(dev["device"])
                logger.info("wifi: joined %r on %s (address %s)", ssid, dev["device"], address)
                return 200, {"ok": True, "address": address}

            code, sentence = classify_join_failure(ran, ssid)
            said = scrub(_first_line(ran.err) or _first_line(ran.out), password)
            detail = scrub(f"{sentence} (NetworkManager: {said})" if said else sentence, password)
            removed = self._remove_new_profiles(nmcli, before)
            logger.warning("wifi: joining %r failed: %s%s", ssid, code,
                           f" (removed {removed} unfinished profile(s))" if removed else "")
            return 409, {"ok": False, "error": code, "detail": detail}
        finally:
            self._wifi_lock.release()

    def _wait_for_address(self, device: str) -> str | None:
        for attempt in range(ADDRESS_WAIT_TRIES):
            if attempt:
                self._sleep(1.0)
            address = self._address_on(device)
            if address:
                return address
        return None

    def _remove_new_profiles(self, nmcli: str, before: set[str] | None) -> int:
        """Delete the profile(s) a failed join created, so a wrong password is not left
        saved to autoconnect. Profiles that existed before the attempt are never touched."""
        if before is None:
            return 0
        after = self._wifi_profiles(nmcli)
        removed = 0
        for uuid in sorted((after or set()) - before):
            if self._run([nmcli, "connection", "delete", "uuid", uuid], NMCLI_TIMEOUT_S).rc == 0:
                removed += 1
        return removed

    # ---------------------------------------------------------- forget

    def forget(self) -> tuple[int, dict]:
        """Delete the Wi-Fi profile in use on the Wi-Fi adapter. Others are kept."""
        nmcli, devices, gap = self._nm()
        if devices is None or not nmcli:
            return 404, _err("no_network_manager", gap or NM_GAP)
        dev = self._pick_wifi(devices)
        if dev is None:
            return 404, _err("no_wifi", NO_WIFI_GAP)
        if not self._wifi_lock.acquire(blocking=False):
            return 409, _err("busy", "Another Wi-Fi change is already in progress on this box.")
        try:
            uuid, name = self._active_profile_on(nmcli, dev["device"])
            if uuid is None:
                return 200, {"ok": True, "forgotten": None}
            ran = self._run([nmcli, "connection", "delete", "uuid", uuid], NMCLI_TIMEOUT_S)
            if ran.rc != 0:
                why = self._nm_reason(ran, "it did not finish in time")
                return 409, _err("forget_failed", f"NetworkManager would not forget “{name}”: {why}")
            logger.info("wifi: forgot %r", name)
            return 200, {"ok": True, "forgotten": name}
        finally:
            self._wifi_lock.release()

    # ---------------------------------------------------- router check

    def router_check(self) -> dict:
        """The cached verdict if it is under 10 s old; otherwise start one check (only
        one runs at a time) and wait up to ROUTE_WAIT_S for it."""
        with self._state_lock:
            if self._rc_last is not None and self._mono() - self._rc_last_at < RATE_LIMIT_S:
                return dict(self._rc_last)
            event = self._rc_inflight
            start = event is None
            if start:
                event = self._rc_inflight = threading.Event()
        if start:
            self._spawn(lambda: self._run_check(event))
        event.wait(ROUTE_WAIT_S)
        with self._state_lock:
            if self._rc_last is not None:
                return dict(self._rc_last)
        return self._pending()

    def _run_check(self, event: threading.Event) -> None:
        try:
            result = self._check_once()
        except Exception:  # noqa: BLE001 - a bug must still release the waiters and say so
            logger.exception("router check failed")
            result = {"gateway": None, "boxAddress": None, "forwardsToUs": None, "method": None,
                      "checkedAt": int(self._now()),
                      "gap": "The router check failed inside the agent; its journal has the reason"}
        with self._state_lock:
            self._rc_last = result
            self._rc_last_at = self._mono()
            self._rc_inflight = None
            changed = result.get("forwardsToUs") != self._rc_logged
            self._rc_logged = result.get("forwardsToUs")
        event.set()
        if changed:
            logger.info("router check: gateway=%s forwardsToUs=%s gap=%s",
                        result.get("gateway"), result.get("forwardsToUs"), result.get("gap"))

    def _pending(self) -> dict:
        addrs = self._ipv4_addrs()
        box = self.box_address(addrs) if addrs is not None else None
        return {
            "gateway": self.gateway_for(box, addrs),
            "boxAddress": box,
            "forwardsToUs": None,
            "method": None,
            "checkedAt": None,
            "gap": "The first router check is still running on this box; it will answer in a few seconds",
        }

    def _check_once(self) -> dict:
        addrs = self._ipv4_addrs()
        box = self.box_address(addrs) if addrs is not None else None
        gateway = self.gateway_for(box, addrs)
        result = {"gateway": gateway, "boxAddress": box, "forwardsToUs": None, "method": None,
                  "checkedAt": None, "gap": None}

        def done(**changes) -> dict:
            result.update(changes)
            result["checkedAt"] = int(self._now())
            return result

        if addrs is None:
            return done(gap=IP_GAP)
        if not box:
            return done(gap="This box has no network address yet, so there is no router to check")
        if not gateway:
            return done(gap="The network this box is on has no router (no default gateway), so there is no router to check")
        if gateway == box:
            return done(gap="This box is its own gateway, so there is no separate router to check")

        name = f"{secrets.token_hex(8)}.{CANARY_ZONE}"
        sent_at = self._now()
        outcome = self._udp(gateway, name, CANARY_TIMEOUT_S)
        seen, failure = self._canary_seen(name, sent_at)

        if seen is True:
            return done(forwardsToUs=True, method="canary")
        if seen is None:
            # "Could not look" - never the same sentence as "looked, nothing there".
            return done(method="canary", gap=pihole.gap_for(failure, "whether your router's lookups reach this box"))
        if outcome == "answered":
            if self._recent_from(gateway):
                return done(method="canary", gap=(
                    f"Your router ({gateway}) has sent lookups to this box in the last 5 minutes, but it "
                    "answered this test lookup without passing it here - it may be sending only some of "
                    "its lookups to this box"))
            return done(forwardsToUs=False, method="canary")
        return done(method="canary", gap=_router_silence_gap(outcome, gateway))

    def _canary_seen(self, name: str, sent_at: float) -> tuple[bool | None, str | None]:
        """(True, None) arrived | (False, None) Pi-hole answered, not there |
        (None, failure) Pi-hole could not be asked."""
        path = f"/api/queries?domain={quote(name, safe='')}&from={int(sent_at) - 5}&length=10"
        for attempt in range(CANARY_POLLS):
            if attempt:
                self._sleep(CANARY_POLL_GAP_S)
            r = self._pihole("GET", path)
            if not r.ok:
                return None, r.failure
            queries = r.data.get("queries") if isinstance(r.data, dict) else None
            if not isinstance(queries, list):
                return None, pihole.FAIL_BAD_BODY
            for q in queries:
                if isinstance(q, dict) and str(q.get("domain") or "").lower().rstrip(".") == name:
                    return True, None
        return False, None

    def _recent_from(self, gateway: str) -> bool:
        path = (f"/api/queries?client_ip={quote(gateway, safe='')}"
                f"&from={int(self._now()) - RECENT_WINDOW_S}&length=1")
        r = self._pihole("GET", path)
        queries = r.data.get("queries") if r.ok and isinstance(r.data, dict) else None
        return isinstance(queries, list) and len(queries) > 0


# The instance the routes use. Looked up per request (current()), so a test can swap it.
instance = NetworkSetup()


def current() -> NetworkSetup:
    return instance


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def build_router(*, read_scope, kiosk_only) -> APIRouter:
    """The five routes, guarded by main.py's own ScopeChecker instances."""
    router = APIRouter(prefix="/api/v1/network", tags=["network"])

    @router.get("/status")
    def network_status(_=Depends(read_scope)):
        return current().status()

    @router.get("/wifi/scan")
    def wifi_scan(_=Depends(kiosk_only)):
        return current().scan()

    @router.post("/wifi/connect")
    async def wifi_connect(request: Request, _=Depends(kiosk_only)):
        # Parsed by hand, not by a pydantic model: a validation error echoes the
        # offending input back, and the input here may be a password.
        try:
            body = await request.json()
        except ValueError:
            body = None
        if not isinstance(body, dict):
            return JSONResponse(status_code=400, content=_err(
                "bad_request", 'Send JSON: {"ssid": "<network name>", "password": "<password>"}.'))
        status, payload = await run_in_threadpool(current().connect, body.get("ssid"), body.get("password"))
        return JSONResponse(status_code=status, content=payload)

    @router.post("/wifi/forget")
    def wifi_forget(_=Depends(kiosk_only)):
        status, payload = current().forget()
        return JSONResponse(status_code=status, content=payload)

    @router.get("/router-check")
    def router_check(_=Depends(read_scope)):
        return current().router_check()

    return router
