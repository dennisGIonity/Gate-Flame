"""Scheduled automation on the box: `python -m gateflame.jobs <job>`.

Run by systemd timers (install-automation.sh) as the same user, with the same
environment drop-ins, as the agent - so a job sees exactly the Pi-hole URL,
password and data root the agent sees, and writes into the same `.DUMP`.

Jobs are deliberately small and idempotent. Each prints ONE JSON line and
exits 0 on "ran" (whatever it found) and 1 only when it could not run at all.
The journal is the audit log; `.DUMP/logs/jobs.log` gets the same line so the
kiosk can show "last ran / last result" without journal access.

    anomaly    score the last window of DNS queries (anomaly.py), persist baseline
    backup     copy state.db + profiles/*.json into .DUMP/backups/, keep 14
    selfcheck  the storage root, Pi-hole reachability and the upstream mode,
               in one line, for the fleet feed and the kiosk

No job changes filtering, upstream, or anything a device on the LAN can see.
Automation here is bookkeeping and observation, never enforcement - that is
the owner's action, taken at a screen, with a read-back.
"""

from __future__ import annotations

import json
import os
import sys
import time

from . import anomaly, datadir, pihole, upstream
from .config import config

JOBS = ("anomaly", "backup", "selfcheck")


def _log(line: dict) -> None:
    try:
        p = datadir.path("logs", "jobs.log")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(line, sort_keys=True) + "\n")
    except OSError:
        pass


def job_anomaly() -> dict:
    r = anomaly.run()
    return {
        "job": "anomaly",
        "gap": r["gap"],
        "findings": len(r["findings"]),
        "kinds": sorted({f["kind"] for f in r["findings"]}),
        "attribution": (r["stats"] or {}).get("clientAttribution"),
    }


def job_backup() -> dict:
    made = []
    db = datadir.backup_file(config.db_path, "state", keep=14)
    if db:
        made.append(db)
    profiles_dir = datadir.path("profiles")
    try:
        for name in sorted(os.listdir(profiles_dir)):
            if name.endswith(".json"):
                dest = datadir.backup_file(os.path.join(profiles_dir, name), f"profile-{name[:-5]}", keep=7)
                if dest:
                    made.append(dest)
    except OSError:
        pass
    return {"job": "backup", "copied": len(made), "files": [os.path.basename(m) for m in made]}


def job_selfcheck() -> dict:
    st = datadir.status()
    up = upstream.describe()
    return {
        "job": "selfcheck",
        "storageHealthy": st["healthy"],
        "storageFreeBytes": st["freeBytes"],
        "unhealthyFolders": [k for k, v in st["subdirs"].items() if not (v["present"] and v["writable"])],
        "piholeReachable": pihole.reachable(),
        "upstreamMode": up["mode"],
        "upstreamEncrypted": up["encrypted"],
    }


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1 or argv[0] not in JOBS:
        print(json.dumps({"error": "usage", "jobs": list(JOBS)}))
        return 1
    datadir.ensure()
    started = time.time()
    try:
        result = {"anomaly": job_anomaly, "backup": job_backup, "selfcheck": job_selfcheck}[argv[0]]()
        result["at"] = started
        result["ok"] = True
        result["seconds"] = round(time.time() - started, 2)
    except Exception as exc:  # noqa: BLE001 - a job must report, not crash the timer silently
        result = {"job": argv[0], "at": started, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
    _log(result)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
