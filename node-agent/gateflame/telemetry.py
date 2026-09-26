"""Host telemetry — real numbers, honest gaps.

Every reading here comes from the OS, not a random generator. Where a source
doesn't exist on this host (no thermal zone, no vcgencmd, not actually a Pi),
the field is null with a named gap — never a plausible-looking fake value.

HARDWARE PORTABILITY (Standard T3 = Radxa Cubie A7A, Allwinner A733; lab = Pi 5)

  * Temperature. The old reader took `thermal_zone0` on faith. On a Pi 5 that
    is `cpu-thermal`; on Allwinner boards zone 0 can be any of several sensors
    (CPU cluster, GPU, DDR, NPU - the numbering follows the device tree, not a
    convention), so "zone 0" is not "the CPU". The reader now prefers a zone
    whose `type` names the CPU/SoC, falls back to zone 0, then to psutil. The
    choice is resolved once and re-resolved if the chosen zone stops reading.
  * Throttle flags. `vcgencmd` is Raspberry Pi firmware. Every other board
    gets `throttleFlags: null` plus a `throttleGap` saying why, instead of the
    field silently vanishing.
"""

from __future__ import annotations

import glob
import os
import shutil
import subprocess
import threading
import time

import psutil

from . import pihole

_start_time = time.time()

THERMAL_ROOT = "/sys/class/thermal"

# Substrings of a thermal zone `type` that identify the CPU/SoC die. Checked in
# order, so a zone literally called "cpu-thermal" beats a "soc" catch-all.
_CPU_ZONE_HINTS = ("cpu", "soc", "x86_pkg_temp", "package", "acpitz")

_zone_lock = threading.Lock()
_zone_path: str | None = None
_zone_resolved = False


def uptime_seconds() -> int:
    return int(time.time() - psutil.boot_time())


def agent_uptime_seconds() -> int:
    return int(time.time() - _start_time)


def _read_zone(path: str) -> float | None:
    try:
        with open(path, encoding="ascii") as f:
            raw = int(f.read().strip())
    except (OSError, ValueError):
        return None
    # Millidegrees by the sysfs ABI. A zone reporting whole degrees (seen on
    # some vendor kernels) would read as 0.05 C here; that is not a temperature.
    celsius = raw / 1000.0
    if not -40.0 <= celsius <= 150.0:
        return None
    return round(celsius, 1)


def _resolve_zone(root: str = THERMAL_ROOT) -> str | None:
    """The temp file of the zone that best represents the CPU, or None."""
    zones = sorted(glob.glob(os.path.join(root, "thermal_zone*")),
                   key=lambda p: int("".join(ch for ch in os.path.basename(p) if ch.isdigit()) or 0))
    typed: list[tuple[str, str]] = []
    for zone in zones:
        try:
            with open(os.path.join(zone, "type"), encoding="ascii") as f:
                ztype = f.read().strip().lower()
        except OSError:
            ztype = ""
        typed.append((ztype, os.path.join(zone, "temp")))
    for hint in _CPU_ZONE_HINTS:
        for ztype, temp in typed:
            if hint in ztype and _read_zone(temp) is not None:
                return temp
    for _ztype, temp in typed:
        if _read_zone(temp) is not None:
            return temp
    return None


def read_thermal_c() -> float | None:
    global _zone_path, _zone_resolved
    with _zone_lock:
        if not _zone_resolved:
            _zone_path = _resolve_zone()
            _zone_resolved = True
        path = _zone_path
    if path is not None:
        value = _read_zone(path)
        if value is not None:
            return value
        # The chosen zone stopped reading (driver reload, hotplug). Look again
        # next time rather than reporting nothing forever.
        with _zone_lock:
            _zone_resolved = False
    # Fall back to psutil sensors on hosts without a usable sysfs zone.
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
            ["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=2, check=False
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
    else:
        snapshot["throttleFlags"] = None
        snapshot["throttleGap"] = (
            "throttle state is read with vcgencmd, which is Raspberry Pi firmware; "
            "this host does not provide it"
            if not shutil.which("vcgencmd")
            else "vcgencmd is installed but did not report throttle state"
        )
    return snapshot


def telemetry_summary(prev_counters: dict | None = None) -> dict:
    """Shape matches TelemetrySummaryResponse in src/types/api.ts.

    Query/block/gravity/client counts come from Pi-hole when it's configured
    and reachable. Without it there is no honest source for those numbers on
    this host, so they come back null with a gap noted rather than guessed.

    One Pi-hole read, not two: `piholeReachable` is derived from the same
    (briefly cached) summary instead of asking Pi-hole the question again.
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
        "piholeReachable": ph is not None,
    }
    if ph is not None:
        base.update(ph)
    else:
        # "Not configured" and "did not answer" need opposite actions, so they
        # never share a sentence (CLAUDE.md).
        base["gap"] = pihole.gap_for(pihole.last_failure(), "query and block counts")
    return base
