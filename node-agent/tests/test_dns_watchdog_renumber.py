# ========================================================================================
# GATE^FLAME - DNS WATCHDOG: A ROUTER SWAP MUST NOT BE A PERMANENT OUTAGE
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# WHAT THESE PIN
#
# 2026-09-21: the household router was replaced and the LAN moved from 192.168.0.0/24
# to 192.168.124.0/24. dns-stack/.env still said GATEFLAME_LAN_IP=192.168.0.10 - the
# only writer of that key was the installer - so docker could not bind port 53 and
# Pi-hole never came up. Restart, recreate and bypass all re-read the same stale
# file and failed identically, forever.
#
# sync_lan_ip_env() is the fix: before any compose up, compare the recorded address
# with the one the box actually holds and rewrite .env when they differ. These tests
# source the watchdog as a library and drive that function against a temp .env.
# ========================================================================================

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
                capture_output=True, text=True, timeout=20,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if "GATEFLAME_BASH_OK" in probe.stdout:
            return candidate
    return None


BASH = _find_bash()
pytestmark = pytest.mark.skipif(BASH is None, reason="a working bash is required")


def run_sync(tmp_path: Path, env_lines: list[str] | None, live_ip: str):
    """Source the watchdog with a fake stack dir, run sync_lan_ip_env, return output.

    live_ip is what the box "holds": it is exported as GATEFLAME_LAN_IP AND the route
    probe is stubbed to the same value, so an empty string genuinely means "no route
    could be read" rather than "fall through to this machine's real address".
    """
    stack = tmp_path / "dns-stack"
    stack.mkdir()
    (stack / "docker-compose.yml").write_text("services: {}\n")
    if env_lines is not None:
        (stack / ".env").write_text("\n".join(env_lines) + "\n")
    script = f"""
      export GATEFLAME_WATCHDOG_LIB=1
      export GATEFLAME_DNS_STACK={stack.as_posix()!r}
      export GATEFLAME_LAN_IP={live_ip!r}
      source {WATCHDOG.as_posix()!r}
      log() {{ echo "$*"; }}
      current_lan_ip() {{ echo {live_ip!r}; }}
      sync_lan_ip_env; echo "RC=$?"; echo "LAN_IP_NOW=$LAN_IP"
    """
    proc = subprocess.run([BASH, "-c", script], capture_output=True, text=True, timeout=60)
    envfile = stack / ".env"
    return proc.stdout + proc.stderr, (envfile.read_text() if envfile.exists() else None)


def test_stale_address_is_rewritten_and_announced(tmp_path):
    out, env = run_sync(
        tmp_path,
        ["PIHOLE_PASSWORD=keep-me", "GATEFLAME_LAN_IP=192.168.0.10", "GATEFLAME_LAN_IP6=::1"],
        live_ip="192.168.124.17",
    )
    assert "RC=0" in out
    assert "LAN RENUMBERED" in out and "192.168.0.10" in out and "192.168.124.17" in out
    assert "GATEFLAME_LAN_IP=192.168.124.17" in env
    assert "GATEFLAME_LAN_IP=192.168.0.10" not in env
    # Every other line - including the credential - survives untouched.
    assert "PIHOLE_PASSWORD=keep-me" in env
    assert "GATEFLAME_LAN_IP6=::1" in env
    # The in-process probe target follows the rewrite, or the next tick tests the dead one.
    assert "LAN_IP_NOW=192.168.124.17" in out


def test_matching_address_is_a_silent_no_op(tmp_path):
    """A 60-second timer must never rewrite a credential file for nothing."""
    before = ["PIHOLE_PASSWORD=x", "GATEFLAME_LAN_IP=192.168.124.17"]
    out, env = run_sync(tmp_path, before, live_ip="192.168.124.17")
    assert "RC=0" in out
    assert "LAN RENUMBERED" not in out
    assert env == "PIHOLE_PASSWORD=x\nGATEFLAME_LAN_IP=192.168.124.17\n"


def test_missing_key_is_appended(tmp_path):
    out, env = run_sync(tmp_path, ["PIHOLE_PASSWORD=x"], live_ip="10.0.0.5")
    assert "RC=0" in out
    assert env.endswith("GATEFLAME_LAN_IP=10.0.0.5\n")
    assert env.startswith("PIHOLE_PASSWORD=x\n")


def test_unknown_live_address_leaves_env_alone(tmp_path):
    """No route = no idea. Writing an empty address would be worse than the stale one."""
    before = ["GATEFLAME_LAN_IP=192.168.0.10"]
    out, env = run_sync(tmp_path, before, live_ip="")
    assert "RC=1" in out
    assert "WARNING" in out
    assert env == "GATEFLAME_LAN_IP=192.168.0.10\n"


def test_missing_env_file_is_reported_not_created(tmp_path):
    out, env = run_sync(tmp_path, None, live_ip="10.0.0.5")
    assert "RC=1" in out
    assert "missing" in out
    assert env is None
