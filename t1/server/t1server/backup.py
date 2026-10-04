"""Back up what cannot be rebuilt.

Lose `keys/` and every board in the field refuses every filter you sign next (its public key is
compiled in) - the fix is reflashing all of them. Lose `t1.db` and every board's token is gone:
each must be re-enrolled by hand. Filters, the downloaded list cache and the allow-list file are
all rebuildable and are NOT backed up.

    python -m t1server backup [DEST_DIR]       -> DEST_DIR/t1-backup-YYYYmmdd-HHMMSS.zip

The database is copied with SQLite's online-backup API, so a backup taken while the server runs
is consistent. A zip holds secrets in the clear: keep it somewhere only you can read.
"""
from __future__ import annotations

import sqlite3
import tempfile
import time
import zipfile
from pathlib import Path

from .config import DATA_DIR, data_path

KEEP = 14


def make_backup(dest: Path | str, store=None) -> Path:
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    name = dest / f"t1-backup-{time.strftime('%Y%m%d-%H%M%S')}.zip"
    n = 1
    while name.exists():                                    # two backups in one second must not collide
        name = dest / f"t1-backup-{time.strftime('%Y%m%d-%H%M%S')}-{n}.zip"
        n += 1
    with tempfile.TemporaryDirectory() as tmp:
        snap = Path(tmp) / "t1.db"
        if store is not None:
            out = sqlite3.connect(str(snap))
            with store.lock:
                store.db.backup(out)
            out.close()
        else:
            src = sqlite3.connect(str(data_path("t1.db")))
            out = sqlite3.connect(str(snap))
            src.backup(out)
            out.close()
            src.close()
        with zipfile.ZipFile(name, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(snap, "t1.db")
            for rel in ("secrets.json",):
                p = DATA_DIR / rel
                if p.exists():
                    z.write(p, rel)
            for sub in ("keys", "firmware"):
                for p in sorted((DATA_DIR / sub).glob("*")) if (DATA_DIR / sub).is_dir() else []:
                    if p.is_file():
                        z.write(p, f"{sub}/{p.name}")
    for old in sorted(dest.glob("t1-backup-*.zip"))[:-KEEP]:
        old.unlink(missing_ok=True)
    return name
