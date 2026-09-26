"""Runs before pytest imports a single test module in this directory.

BUG-01 (docs/FUNCTION-STATUS-AND-BUGS.md): `gateflame/main.py` does
`store = Store(config.db_path)` at MODULE SCOPE, and `Store.__init__` does
`Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)`. With the
default `GATEFLAME_DB_PATH` (`/var/lib/gateflame/state.db`), that mkdir is a
permission error for any non-root user - which is every fresh clone.

`test_pairing.py` already protects itself by setting the env var before its
own `from gateflame.main import app` - but `test_kiosk_route.py` does the same
import with no such guard, and 'k' collates before 'p'. Pytest collects test
files alphabetically, so on a machine where the shell has never exported
GATEFLAME_DB_PATH, collection dies in test_kiosk_route.py with
"attempt to write a readonly database" before test_pairing.py's own
protection ever runs. 439 green tests on this machine proved nothing about a
fresh clone, because this machine always had the var set by hand.

conftest.py is imported before any test module in its directory or below,
regardless of file name - that ordering guarantee is exactly what closes this
gap. `setdefault` so a developer or CI that already exports the real value
(or points it somewhere specific) is never overridden.

This does not touch `Config.db_path`'s own default - that default is pinned
by test_import_side_effects.py::test_the_default_db_path_is_still_what_the_unit_file_expects
because the systemd drop-in on the Pi depends on it, and is out of scope here.
The real fix (build the store in a lifespan handler instead of at import) is
already flagged in ci.yml as its own change, because it touches application
startup - not this one.
"""

from __future__ import annotations

import dataclasses
import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="gateflame-pytest-")
os.environ.setdefault("GATEFLAME_DB_PATH", os.path.join(_tmp, "state.db"))
os.environ.setdefault("GATEFLAME_DATA_ROOT", os.path.join(_tmp, "dump"))

# Background work the app's lifespan would start. Several tests enter
# `with TestClient(app)`, which runs the lifespan; without these the suite
# would start a 60 s history sampler thread and a real HTTP fetch to
# vpngate.net every time. A test that wants the sampler starts one itself.
os.environ.setdefault("GATEFLAME_HISTORY_SAMPLER", "false")
os.environ.setdefault("GATEFLAME_VPNGATE_WARM", "false")


@pytest.fixture
def fake_pihole(monkeypatch):
    """gateflame.pihole wired to an in-process fake Pi-hole v6 (tests/fake_pihole.py).

    Every request the agent makes goes through httpx.MockTransport, so the code
    under test is the real session, retry, cache and parsing code - only the
    server is fake. Session state and caches start empty for each test.
    """
    from fake_pihole import FakePihole

    from gateflame import dns_history, pihole
    from gateflame.ttlcache import TTLCache

    fake = FakePihole()
    monkeypatch.setattr(
        pihole, "config",
        dataclasses.replace(pihole.config, pihole_api_url="http://pihole.test", pihole_password="pw"),
    )
    monkeypatch.setattr(pihole, "_transport", fake.transport())
    for name, value in (("_sid", None), ("_sid_expires", 0.0), ("_sid_validity", 0.0),
                        ("_auth_failure", None), ("_auth_backoff_until", 0.0),
                        ("_last_summary_failure", None)):
        monkeypatch.setattr(pihole, name, value)
    monkeypatch.setattr(pihole, "_cache", TTLCache())
    monkeypatch.setattr(dns_history, "_cache", TTLCache())
    return fake
