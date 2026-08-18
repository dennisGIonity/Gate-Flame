# ========================================================================================
# GATE^FLAME - DNS WATCHDOG: THE LISTENER THAT MATTERS IS THE LAN ONE
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# WHAT THESE PIN
#
# Until 2026-08-18 dns_answers() probed 127.0.0.1:53 and nothing else. docker-compose
# publishes port 53 on TWO sockets - loopback and the LAN address - and they fail
# independently. Every state in which the LAN socket is dead and loopback is alive
# therefore read as HEALTHY: no restart, no recreate, no bypass, no log line, and a
# household with no DNS at all.
#
# That is not a hypothetical. It is the shape of the "mobile devices keep losing
# connection, nothing in the logs" report that produced this fix.
#
# The bug was undetectable by inspection because nothing could run the health logic in
# isolation. dns-watchdog.sh now stops after its definitions when sourced with
# GATEFLAME_WATCHDOG_LIB=1, so these tests stub the per-server probe and assert the
# decision instead of trusting the reading.
# ========================================================================================

import os
import shutil
import subprocess
from pathlib import Path

import pytest

WATCHDOG = Path(__file__).resolve().parent.parent / "dns-watchdog.sh"


def _find_bash():
    """Locate a bash that can actually run a script.

    On Windows this cannot be shutil.which('bash'). CreateProcess searches the
    system directory BEFORE anything on PATH, so C:\\Windows\\System32\\bash.exe -
    the WSL launcher - always wins, and on a machine with no WSL distro installed
    it prints "Windows Subsystem for Linux has no installed distributions" to
    stdout and exits 0. Every assertion then fails against that banner, which
    looks exactly like a broken test and is not one. Candidates are therefore
    probed by running them, not by trusting the name.
    """
    candidates = [
        os.environ.get("GATEFLAME_TEST_BASH"),
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
        "/bin/bash",
        "/usr/bin/bash",
        shutil.which("bash"),
    ]
    for candidate in candidates:
        if not candidate or not Path(candidate).exists():
            continue
        try:
            probe = subprocess.run(
                [candidate, "-c", "echo GATEFLAME_BASH_OK"],
                capture_output=True,
                text=True,
                timeout=20,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if "GATEFLAME_BASH_OK" in probe.stdout:
            return candidate
    return None


BASH = _find_bash()

pytestmark = pytest.mark.skipif(
    BASH is None, reason="a working bash is required to exercise the watchdog"
)


def run_health(loopback_ok: bool, lan_ok: bool, lan_ip: str = "192.168.0.10"):
    """Source the watchdog as a library, stub dns_answers_on, ask dns_answers.

    Returns (exit_code, combined_output). Exit 0 means the watchdog considers the
    resolver healthy and will take no action.
    """
    # Forward slashes, not the native separator: Git bash treats a backslash inside
    # single quotes as a literal character, so 'E:\\Gateflame\\...' is not a path.
    # 'E:/Gateflame/...' works on both Git bash and a real Linux shell.
    watchdog_path = WATCHDOG.as_posix()
    script = f"""
      export GATEFLAME_WATCHDOG_LIB=1
      export GATEFLAME_LAN_IP={lan_ip!r}
      source {watchdog_path!r}

      # Replace the real probe. This is the seam the fix created.
      dns_answers_on() {{
        case "$1" in
          127.0.0.1) return {0 if loopback_ok else 1} ;;
          *)         return {0 if lan_ok else 1} ;;
        esac
      }}
      # Keep the journal out of the test output but keep the message on stdout.
      log() {{ echo "$*"; }}

      if dns_answers; then echo "VERDICT=healthy"; else echo "VERDICT=unhealthy"; fi
    """
    proc = subprocess.run(
        [BASH, "-c", script], capture_output=True, text=True, timeout=60
    )
    return proc.returncode, proc.stdout + proc.stderr


def test_both_listeners_up_is_healthy():
    _, out = run_health(loopback_ok=True, lan_ok=True)
    assert "VERDICT=healthy" in out


def test_loopback_down_is_unhealthy():
    """The original check. Still has to work."""
    _, out = run_health(loopback_ok=False, lan_ok=False)
    assert "VERDICT=unhealthy" in out


def test_lan_listener_down_is_unhealthy_even_though_loopback_answers():
    """THE REGRESSION THIS FILE EXISTS FOR.

    Before the fix this combination returned healthy. If this test ever passes
    again by reporting 'healthy', the silent whole-house outage is back.
    """
    _, out = run_health(loopback_ok=True, lan_ok=False)
    assert "VERDICT=unhealthy" in out, (
        "loopback answering must NOT be enough - the household reaches the box on "
        "its LAN address, and that is the socket that has to be proven alive"
    )


def test_silent_outage_is_logged_distinctly():
    """A dead LAN listener needs its own message.

    'DNS did not answer' sends an operator to look at the containers, which are
    fine. The remedy here is different - docker has to rebind - so the log has to
    say which socket failed.
    """
    _, out = run_health(loopback_ok=True, lan_ok=False)
    assert "SILENT OUTAGE" in out
    assert "192.168.0.10" in out


def test_missing_lan_ip_degrades_loudly_but_does_not_hard_fail():
    """If the address cannot be determined we must not flap the whole stack.

    An empty LAN_IP means the routing table could not be read - restarting Pi-hole
    would not fix that, and a watchdog that recreates the resolver every 60s over a
    detection failure is worse than the fault it is chasing. Verify loopback, warn,
    and let a human see it.
    """
    _, out = run_health(loopback_ok=True, lan_ok=False, lan_ip="")
    assert "VERDICT=healthy" in out
    assert "WARNING" in out and "no LAN address" in out
