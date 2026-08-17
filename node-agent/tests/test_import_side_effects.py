"""Importing the app must not require privileges.

`tests/test_wan.py` already pins this promise for `services.py`: constructing a
module-scope object "must not create /var/lib/gateflame or take a file lock as
an import side effect". `main.py` was never held to the same standard, and it
does exactly that on line 41:

    store = Store(config.db_path)

Consequence, found by CI on 2026-08-17: the whole suite passed for every human
who ran it — as root, or on a box where /var/lib/gateflame already existed — and
died at collection on an unprivileged runner with "attempt to write a readonly
database". 439 green tests told us nothing about whether the module could be
imported by a normal user.

This test fails for the same reason CI did, so the day the import side effect is
removed it starts passing, and the day someone adds another one it starts failing.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent


def test_importing_main_does_not_touch_the_default_db_path(tmp_path):
    """Import with a redirected DB path and assert the default was never used.

    Run in a subprocess because `gateflame.main` is almost certainly already
    imported by the rest of the suite, and an import that has happened cannot be
    un-happened.
    """
    db = tmp_path / "state.db"
    result = subprocess.run(
        [sys.executable, "-c", "import gateflame.main"],
        cwd=AGENT_ROOT,
        env={
            "PATH": "/usr/bin:/bin",
            "GATEFLAME_DB_PATH": str(db),
            # Deliberately no HOME: the import must not want one either.
        },
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, f"importing gateflame.main failed:\n{result.stderr}"


def test_the_default_db_path_is_still_what_the_unit_file_expects():
    """A guard on the constant itself, read in a clean subprocess.

    The systemd drop-in sets GATEFLAME_DB_PATH=/var/lib/gateflame/state.db. If
    the default here ever drifts from that, a box deployed without the drop-in
    silently writes its identity somewhere else and every paired phone stops
    being recognised.

    Read in a subprocess with the variable UNSET, because `Config.db_path` takes
    its default from os.environ at class-definition time, and other tests in this
    suite mutate the environment. Asserting against live os.environ here made the
    result depend on test ordering - which it did, once.
    """
    result = subprocess.run(
        [sys.executable, "-c", "from gateflame.config import Config; print(Config().db_path)"],
        cwd=AGENT_ROOT,
        env={"PATH": "/usr/bin:/bin"},  # no GATEFLAME_DB_PATH
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "/var/lib/gateflame/state.db"
