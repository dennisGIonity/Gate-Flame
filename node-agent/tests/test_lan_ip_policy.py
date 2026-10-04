# ========================================================================================
# GATE^FLAME - LAN ADDRESS POLICY: THE RESOLVER BINDS THE WIRED INTERFACE FIRST
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# WHAT THESE PIN
#
# 2026-10-03: the lab Pi rebooted, household Wi-Fi auto-connected, and wlan0 won the
# default route. Every script that derives "this box's LAN address" did it from
# `ip route get 1.1.1.1 ... src`, so the watchdog's renumber self-heal rewrote
# dns-stack/.env to the WIRELESS address (192.168.0.12), recreated the stack there,
# and then read "healthy" - while 192.168.124.3:53, the address the lab router forwards
# to, answered nothing. install-pi-release.sh would have done the same on deploy.
#
# The policy is now: a wired interface's global IPv4 first (eth*, en* - including the
# Radxa/Rockchip `end0`), the default route's `src` only when no wired interface holds
# one, bridges and veths never. The same function text lives in every script that
# writes or announces the address, because those scripts ship as separate files; this
# test runs each copy against a fake `ip` and refuses to let the copies drift.
# ========================================================================================

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent  # E:\.claude\Ionity\Gateflame
NODE_AGENT = ROOT / "node-agent"

# Every file that must carry the policy. Adding a script that derives the address
# without adding it here is caught by test_no_script_derives_the_address_route_first.
EXPECTED_CARRIERS = {
    NODE_AGENT / "dns-watchdog.sh",
    NODE_AGENT / "install-dns-stack.sh",
    NODE_AGENT / "install-all.sh",
    NODE_AGENT / "install-kiosk.sh",
    NODE_AGENT / "gateflame-netcheck.sh",
    NODE_AGENT / "deploy-on-pi.sh",
    ROOT / "tools" / "install-pi-release.sh",
}

FUNC_RE = re.compile(r"^gateflame_lan_ip\(\) \{\n(?:.*\n)*?\}\n", re.MULTILINE)


def _find_bash():
    for candidate in (
        os.environ.get("GATEFLAME_TEST_BASH"),
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
        "/bin/bash",
        "/usr/bin/bash",
        shutil.which("bash"),
    ):
        if not candidate or not Path(candidate).exists():
            continue
        try:
            probe = subprocess.run([candidate, "-c", "echo GATEFLAME_BASH_OK"],
                                   capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            continue
        if "GATEFLAME_BASH_OK" in probe.stdout:
            return candidate
    return None


BASH = _find_bash()
pytestmark = pytest.mark.skipif(BASH is None, reason="a working bash is required")


def _copies(path: Path) -> list[str]:
    """Every definition of gateflame_lan_ip in a file (deploy-on-pi.sh has two: one at
    top level and one inside the mdns-alias wrapper it writes to /usr/local/bin)."""
    return FUNC_RE.findall(path.read_text(encoding="utf-8").replace("\r\n", "\n"))


def _run(func_text: str, addr_lines: str, route_line: str) -> str:
    """Run one copy of the function with a fake `ip` that answers the two queries the
    policy makes. A bash function shadows the real binary for the whole script."""
    # The canned output travels in the environment, not in the script text: a repr()'d
    # string inside bash single quotes would hand bash literal backslash-n, not newlines.
    script = f"""
      ip() {{
        case "$*" in
          *addr*)  printf '%s' "$GF_FAKE_ADDR" ;;
          *route*) printf '%s\\n' "$GF_FAKE_ROUTE" ;;
        esac
      }}
      {func_text}
      gateflame_lan_ip
    """
    env = {**os.environ, "GF_FAKE_ADDR": addr_lines, "GF_FAKE_ROUTE": route_line}
    proc = subprocess.run([BASH, "-c", script], capture_output=True, text=True, timeout=60, env=env)
    assert proc.returncode == 0, proc.stderr
    return proc.stdout.strip()


ETH_AND_WLAN = (
    "2: eth0    inet 192.168.124.3/24 brd 192.168.124.255 scope global dynamic noprefixroute eth0\\       valid_lft 86000sec preferred_lft 86000sec\n"
    "3: wlan0    inet 192.168.0.12/24 brd 192.168.0.255 scope global dynamic noprefixroute wlan0\\       valid_lft 86000sec preferred_lft 86000sec\n"
    "4: br-5789775f9b35    inet 172.28.0.1/16 brd 172.28.255.255 scope global br-5789775f9b35\\       valid_lft forever preferred_lft forever\n"
    "5: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever preferred_lft forever\n"
)
ROUTE_VIA_WLAN = "1.1.1.1 via 192.168.0.1 dev wlan0 src 192.168.0.12 uid 1000"


def _every_copy():
    found = {}
    for path in EXPECTED_CARRIERS:
        copies = _copies(path)
        assert copies, f"{path.name} no longer defines gateflame_lan_ip()"
        found[path] = copies
    return found


def test_every_carrier_defines_the_function_identically():
    found = _every_copy()
    bodies = {text for copies in found.values() for text in copies}
    assert len(bodies) == 1, (
        "gateflame_lan_ip() has drifted between files; the copies must stay byte-identical:\n"
        + "\n---\n".join(sorted(bodies))
    )


@pytest.mark.parametrize("path", sorted(EXPECTED_CARRIERS, key=lambda p: p.name), ids=lambda p: p.name)
def test_wired_address_wins_over_a_wireless_default_route(path):
    # The 2026-10-03 state exactly: both interfaces up, wlan0 holds the default route.
    for copy in _copies(path):
        assert _run(copy, ETH_AND_WLAN, ROUTE_VIA_WLAN) == "192.168.124.3", path.name


def test_wireless_only_box_falls_back_to_the_route_source():
    copy = _copies(NODE_AGENT / "dns-watchdog.sh")[0]
    wlan_only = "3: wlan0    inet 192.168.0.12/24 brd 192.168.0.255 scope global dynamic wlan0\\       valid_lft 86000sec preferred_lft 86000sec\n"
    assert _run(copy, wlan_only, ROUTE_VIA_WLAN) == "192.168.0.12"


def test_radxa_wired_name_end0_counts_as_wired():
    """Rockchip/Allwinner Debian names the wired port end0 (Cubie A7A, Standard T3)."""
    copy = _copies(NODE_AGENT / "dns-watchdog.sh")[0]
    end0 = (
        "2: end0    inet 192.168.1.40/24 brd 192.168.1.255 scope global dynamic end0\\       valid_lft 86000sec preferred_lft 86000sec\n"
        "3: wlan0    inet 192.168.1.41/24 brd 192.168.1.255 scope global dynamic wlan0\\       valid_lft 86000sec preferred_lft 86000sec\n"
    )
    assert _run(copy, end0, "1.1.1.1 via 192.168.1.1 dev wlan0 src 192.168.1.41 uid 0") == "192.168.1.40"


def test_bridges_are_never_chosen_and_no_route_means_no_answer():
    """Docker's bridges carry global-scope addresses. Writing 172.17.0.1 into .env would
    bind the household's resolver to a bridge nobody on the LAN can reach."""
    copy = _copies(NODE_AGENT / "dns-watchdog.sh")[0]
    bridges_only = (
        "4: br-5789775f9b35    inet 172.28.0.1/16 brd 172.28.255.255 scope global br-5789775f9b35\\       valid_lft forever preferred_lft forever\n"
        "5: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever preferred_lft forever\n"
    )
    assert _run(copy, bridges_only, "") == ""


def test_no_script_derives_the_address_route_first():
    """A new script that goes back to `route get ... src` as its first choice reintroduces
    the bug. Any shipped shell script that asks the route for `src` must also carry the
    policy function."""
    offenders = []
    for path in sorted(list(NODE_AGENT.glob("*.sh")) + [ROOT / "tools" / "install-pi-release.sh"]):
        text = path.read_text(encoding="utf-8", errors="replace")
        if "route get 1.1.1.1" in text and not FUNC_RE.search(text.replace("\r\n", "\n")):
            offenders.append(path.name)
    assert offenders == [], f"derive the LAN address through gateflame_lan_ip(): {offenders}"
