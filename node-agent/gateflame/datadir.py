"""The box's persistent data root - `.DUMP` - and its subfolders.

WHY

"A reboot is still amnesia" sat in the open-items list for three weeks. Every
module that wanted to remember something across a restart had to invent its
own path, and most of them did not bother: VPN Gate cached in memory, blocklist
state lived only in Pi-hole, nothing kept a history. `/var/lib/gateflame` holds
exactly one file, `state.db`, and the systemd unit's ReadWritePaths grants
exactly that directory.

This module gives every module ONE answer to "where do I put it": a root with a
fixed set of subfolders, created on first use, reported by `/system/status`
so a support engineer can see from a phone whether the box can actually
persist anything.

    /opt/gateflame/.DUMP/
        storage/    SQLite files other than state.db (history, caches)
        profiles/   owner profiles + accessibility preferences (JSON)
        ml/         anomaly-detection baselines and model state (JSON)
        history/    rolling telemetry/query history
        logs/       agent-side logs the journal does not keep
        exports/    files the owner asked for (reports, config dumps)
        backups/    dated copies of state.db and profiles

The name and the layout were Dennis's call (2026-09-10): a dot-folder so it
reads as machine-owned, subfolders so a backup is one `tar` of one tree.

RULES

- `state.db` stays where it is (`GATEFLAME_DB_PATH`). Moving the live pairing
  database would strand every paired handset on GF-72TYTITQ. `backups/` gets
  a copy; the original does not move.
- Nothing here raises on a read-only or missing root. `ensure()` reports
  `writable: False` and callers degrade - the API keeps answering, the kiosk
  says "cannot persist", and the operator sees exactly which folder failed.
  A box that cannot write must still filter DNS.
- Appliance paths are POSIX. PurePosixPath, never Path (see CLAUDE.md).
"""

from __future__ import annotations

import os
import shutil
import time
from pathlib import PurePosixPath

DEFAULT_ROOT = "/opt/gateflame/.DUMP"

SUBDIRS: tuple[str, ...] = (
    "storage",
    "profiles",
    "ml",
    "history",
    "logs",
    "exports",
    "backups",
)

# 0750: the service user reads and writes, its group reads, nobody else sees
# owner profiles or query history. Mode is applied at creation only; an
# operator who loosens it on purpose is not fought.
_DIR_MODE = 0o750


def root() -> str:
    return os.environ.get("GATEFLAME_DATA_ROOT", DEFAULT_ROOT)


def path(subdir: str, *parts: str) -> str:
    """Absolute POSIX path inside the data root. `subdir` must be one of SUBDIRS."""
    if subdir not in SUBDIRS:
        raise ValueError(f"unknown data subdir {subdir!r}; expected one of {SUBDIRS}")
    return str(PurePosixPath(root(), subdir, *parts))


def _writable(p: str) -> bool:
    """A real write, not os.access(): ProtectSystem=strict lies to access()."""
    probe = os.path.join(p, f".probe-{os.getpid()}-{int(time.time() * 1000)}")
    try:
        with open(probe, "w", encoding="utf-8") as fh:
            fh.write("ok")
        os.remove(probe)
        return True
    except OSError:
        return False


def ensure() -> dict:
    """Create the root and every subfolder that is missing. Never raises.

    Returns the same shape as status(), so a caller can log it once at
    startup and a route can return it on demand.
    """
    r = root()
    try:
        os.makedirs(r, mode=_DIR_MODE, exist_ok=True)
    except OSError:
        pass
    for sub in SUBDIRS:
        try:
            os.makedirs(os.path.join(r, sub), mode=_DIR_MODE, exist_ok=True)
        except OSError:
            pass
    return status()


def status() -> dict:
    """What exists, what is writable, and how much is stored. Never raises."""
    r = root()
    exists = os.path.isdir(r)
    subdirs: dict[str, dict] = {}
    total_bytes = 0
    for sub in SUBDIRS:
        p = os.path.join(r, sub)
        present = os.path.isdir(p)
        files = 0
        size = 0
        if present:
            try:
                with os.scandir(p) as it:
                    for entry in it:
                        if entry.is_file(follow_symlinks=False):
                            files += 1
                            try:
                                size += entry.stat(follow_symlinks=False).st_size
                            except OSError:
                                pass
            except OSError:
                pass
        total_bytes += size
        subdirs[sub] = {
            "path": p,
            "present": present,
            "writable": _writable(p) if present else False,
            "files": files,
            "bytes": size,
        }

    free_bytes: int | None = None
    if exists:
        try:
            free_bytes = shutil.disk_usage(r).free
        except OSError:
            free_bytes = None

    return {
        "root": r,
        "present": exists,
        "writable": _writable(r) if exists else False,
        "subdirs": subdirs,
        "totalBytes": total_bytes,
        "freeBytes": free_bytes,
        # Every subfolder present AND writable. This is the one bit the
        # kiosk's storage tile keys off; anything less is shown red with the
        # failing folder named, never as a generic "storage error".
        "healthy": exists and all(v["present"] and v["writable"] for v in subdirs.values()),
    }


def backup_file(src: str, label: str, keep: int = 14) -> str | None:
    """Copy `src` into backups/ as <label>-<UTC stamp>.<ext>, pruning to `keep`.

    Returns the new path, or None when the copy could not be made (missing
    source, unwritable root). Used for state.db and the profiles folder by the
    nightly automation timer; safe to call from anywhere.
    """
    if not os.path.isfile(src):
        return None
    dest_dir = path("backups")
    try:
        os.makedirs(dest_dir, mode=_DIR_MODE, exist_ok=True)
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        ext = os.path.splitext(src)[1]
        dest = os.path.join(dest_dir, f"{label}-{stamp}{ext}")
        shutil.copy2(src, dest)
    except OSError:
        return None

    # Prune oldest beyond `keep`, by name (the stamp sorts lexically).
    try:
        siblings = sorted(
            f for f in os.listdir(dest_dir) if f.startswith(f"{label}-") and f.endswith(ext)
        )
        for old in siblings[:-keep]:
            try:
                os.remove(os.path.join(dest_dir, old))
            except OSError:
                pass
    except OSError:
        pass
    return dest
