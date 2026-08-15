"""Host telemetry — real numbers, honest gaps.

Every reading here comes from the OS, not a random generator. Where a source
doesn't exist on this host (no thermal zone, no vcgencmd, not actually a Pi),
the field is omitted or the module reports `degraded` with a named reason —
never a plausible-looking fake value.
"""

from __future__ import annotations

import shutil
import subprocess
import time

import psutil

from . import pihole

_start_time = time.time()


def uptime_seconds() -> int:
    return int(time.time() - psutil.boot_time())


def agent_uptime_seconds() -> int:
    return int(time.time() - _start_time)


def read_thermal_c() -> float | None:
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return round(int(f.read().strip()) / 1000.0, 1)
    except (OSError, ValueError):
        # Fall back to psutil sensors on non-Pi hosts, if present at all.
        try:
            temps = psutil.sensors_temperatures()
            for entries in temps.values():
                if entries:
                    return round(entries[0].current, 1)
        except (AttributeError, OSError):
            pass
        return None


def read_throttle_flags() -> str | None:
    if not shutil.which("vcgencmd"):
        return None
    try:
        out = subprocess.run(
            ["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=2
        )
        # Output looks like "throttled=0x50000"
        return out.stdout.strip().split("=")[-1] if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def host_snapshot() -> dict:
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    thermal = read_thermal_c()
    throttle = read_throttle_flags()
    snapshot = {
        "cpuPercent": psutil.cpu_percent(interval=0.1),
        "memUsedMB": round((vm.total - vm.available) / (1024 * 1024)),
        "memTotalMB": round(vm.total / (1024 * 1024)),
        "diskUsedPercent": round(disk.percent, 1),
        "uptimeSeconds": uptime_seconds(),
    }
    if thermal is not None:
        snapshot["tempC"] = thermal
    else:
        snapshot["tempC"] = None
        snapshot["thermalGap"] = "no thermal zone exposed on this host"
    if throttle is not None:
        snapshot["throttleFlags"] = throttle
    return snapshot


def telemetry_summary(prev_counters: dict | None = None) -> dict:
    """Shape matches TelemetrySummaryResponse in src/types/api.ts.

    Query/block/gravity/client counts come from Pi-hole when it's configured
    and reachable. Without it there is no honest source for those numbers on
    this host, so they come back null with a gap noted rather than guessed.
    """
    host = host_snapshot()
    ph = pihole.summary()
    base = {
        "totalQueriesToday": None,
        "queriesBlockedToday": None,
        "blockPercentage": None,
        "domainsOnGravity": None,
        "activeClientsCount": None,
        "dataSavedMB": None,
        "avgLatencyMs": None,
        "uptimeSeconds": host["uptimeSeconds"],
        "host": host,
        "piholeReachable": pihole.reachable(),
    }
    if ph is not None:
        base.update(ph)
    else:
        base["gap"] = "Pi-hole not configured or unreachable — query/block counts unavailable"
    return base
