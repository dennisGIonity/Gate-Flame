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

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="gateflame-pytest-")
os.environ.setdefault("GATEFLAME_DB_PATH", os.path.join(_tmp, "state.db"))
os.environ.setdefault("GATEFLAME_DATA_ROOT", os.path.join(_tmp, "dump"))
