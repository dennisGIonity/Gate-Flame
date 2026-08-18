# ========================================================================================
# GATE^FLAME - THE BOX FIXES THE NETWORK, THE CUSTOMER DOES NOT
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# A household lost mobile connectivity for days because its router advertised
# IPv6 with no route to the internet. The correct product response is not a
# support article telling the customer to reconfigure their router - it is the
# box quietly correcting it and reporting afterwards.
#
# These tests pin the three properties that make that safe to do unattended:
#
#   1. It fires on exactly the broken shape, and on nothing else.
#   2. It REVERTS itself the moment the network is healthy, so a temporary
#      mitigation never becomes a permanent degradation of working IPv6.
#   3. It is idempotent - a 60-second timer must not restart the DNS stack over
#      and over on a network that is simply in that state.
# ========================================================================================

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

WATCHDOG = Path(__file__).resolve().parent.parent / "dns-watchdog.sh"


def _find_bash():
    candidates = [
        os.environ.get("GATEFLAME_TEST_BASH"),
        r"C:\Program Files\Git\bin\bash.exe",
        "/bin/bash",
        "/usr/bin/bash",
        shutil.which("bash"),
    ]
    for candidate in candidates:
        if not candidate or not Path(candidate).exists():
            continue
        try:
            probe = subprocess.run(
                [candidate, "-c", "echo OK"], capture_output=True, text=True, timeout=20
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if "OK" in probe.stdout:
            return candidate
    return None


BASH = _find_bash()
pytestmark = pytest.mark.skipif(BASH is None, reason="needs a working bash")


def run_autoheal(tmp_path, *, has_v6: bool, has_route: bool, env_contents: str = ""):
    """Exercise autoheal_ipv6 with the network shape stubbed.

    `ip` and `compose` are replaced so the decision is tested, not the LAN. The
    stub `compose` records that it was called, which is how idempotence is
    asserted - a self-heal that restarts the stack every 60 seconds would be a
    worse fault than the one it is fixing.
    """
    stack = tmp_path / "dns-stack"
    stack.mkdir()
    (stack / ".env").write_text(env_contents, encoding="utf-8")
    marker = tmp_path / "compose-called"

    v6_addr = "    inet6 fd00::10/64 scope global" if has_v6 else ""
    v6_route = "default via fe80::1 dev eth0" if has_route else ""

    script = f"""
      export GATEFLAME_WATCHDOG_LIB=1
      export GATEFLAME_DNS_STACK={stack.as_posix()!r}
      export GATEFLAME_LAN_IP='192.168.0.10'
      source {WATCHDOG.as_posix()!r}

      ip() {{
        case "$*" in
          *"-6 addr"*)  printf '%s\\n' {v6_addr!r} ;;
          *"-6 route"*) printf '%s\\n' {v6_route!r} ;;
          *) printf '' ;;
        esac
      }}
      compose() {{ echo "called" >> {marker.as_posix()!r}; }}
      log() {{ echo "$*"; }}

      autoheal_ipv6
    """
    proc = subprocess.run([BASH, "-c", script], capture_output=True, text=True, timeout=60)
    return {
        "out": proc.stdout + proc.stderr,
        "env": (stack / ".env").read_text(encoding="utf-8"),
        "restarts": marker.read_text(encoding="utf-8").count("called") if marker.exists() else 0,
    }


def test_it_fires_on_the_fault_that_was_actually_in_the_field(tmp_path):
    """IPv6 advertised, no route out. Phones drop. The box fixes it alone."""
    r = run_autoheal(tmp_path, has_v6=True, has_route=False, env_contents="PIHOLE_PASSWORD=x\n")
    assert "filter-AAAA" in r["env"]
    assert r["restarts"] == 1
    assert "SELF-HEAL APPLIED" in r["out"]


def test_it_does_nothing_when_ipv6_actually_works(tmp_path):
    """Degrading a working protocol would be sabotage, not safety."""
    r = run_autoheal(tmp_path, has_v6=True, has_route=True, env_contents="PIHOLE_PASSWORD=x\n")
    assert "filter-AAAA" not in r["env"]
    assert r["restarts"] == 0


def test_it_does_nothing_when_there_is_no_ipv6_at_all(tmp_path):
    r = run_autoheal(tmp_path, has_v6=False, has_route=False, env_contents="PIHOLE_PASSWORD=x\n")
    assert "filter-AAAA" not in r["env"]
    assert r["restarts"] == 0


def test_it_reverts_itself_when_the_network_grows_working_ipv6(tmp_path):
    """THE PROPERTY THAT MAKES THIS SAFE TO SHIP.

    A mitigation for someone else's broken network must never outlive the fault.
    If the customer's ISP switches IPv6 on properly next month, the box has to
    hand IPv6 back without anyone remembering that we took it away.
    """
    r = run_autoheal(
        tmp_path, has_v6=True, has_route=True,
        env_contents="PIHOLE_PASSWORD=x\nGATEFLAME_DNSMASQ_LINES=filter-AAAA\n",
    )
    assert "filter-AAAA" not in r["env"]
    assert r["restarts"] == 1
    assert "REVERTING" in r["out"]


def test_it_is_idempotent_so_a_60_second_timer_cannot_thrash_the_stack(tmp_path):
    """Already applied and still broken: recognise it and do nothing.

    Without this the watchdog would recreate the DNS containers every minute,
    which is a far worse outage than the one being repaired.
    """
    r = run_autoheal(
        tmp_path, has_v6=True, has_route=False,
        env_contents="PIHOLE_PASSWORD=x\nGATEFLAME_DNSMASQ_LINES=filter-AAAA\n",
    )
    assert r["restarts"] == 0
    assert "SELF-HEAL APPLIED" not in r["out"]


def test_it_does_not_destroy_other_settings_in_the_env_file(tmp_path):
    """The .env also holds the Pi-hole admin password and the LAN address."""
    r = run_autoheal(
        tmp_path, has_v6=True, has_route=False,
        env_contents="PIHOLE_PASSWORD=secret123\nGATEFLAME_LAN_IP=192.168.0.10\n",
    )
    assert "PIHOLE_PASSWORD=secret123" in r["env"]
    assert "GATEFLAME_LAN_IP=192.168.0.10" in r["env"]
    assert "filter-AAAA" in r["env"]
