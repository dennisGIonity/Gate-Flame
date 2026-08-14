"""Client list — passive discovery only.

Reads the kernel neighbour table (what `ip neigh` shows) and, when present,
dnsmasq/Pi-hole DHCP lease files for a friendly name. Never sends probes,
never touches the network. On a host with no neighbour table (this sandbox,
most CI), returns an empty list rather than fabricating entries.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

LEASE_PATHS = [
    Path("/etc/pihole/dhcp.leases"),
    Path("/var/lib/misc/dnsmasq.leases"),
]

_NEIGH_LINE = re.compile(
    r"^(?P<ip>[0-9a-fA-F:.]+)\s+dev\s+(?P<dev>\S+)\s+lladdr\s+(?P<mac>[0-9a-f:]{17})\s+(?P<state>\S+)",
    re.MULTILINE,
)


def _read_leases() -> dict[str, str]:
    """mac -> hostname, from whichever lease file exists."""
    for path in LEASE_PATHS:
        if not path.exists():
            continue
        names: dict[str, str] = {}
        try:
            for line in path.read_text().splitlines():
                # dnsmasq lease format: <expiry> <mac> <ip> <hostname> <clientid>
                parts = line.split()
                if len(parts) >= 4:
                    mac, hostname = parts[1].lower(), parts[3]
                    if hostname != "*":
                        names[mac] = hostname
        except OSError:
            continue
        return names
    return {}


def list_clients() -> list[dict]:
    try:
        out = subprocess.run(["ip", "neigh"], capture_output=True, text=True, timeout=2)
        table = out.stdout if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        table = ""

    leases = _read_leases()
    clients = []
    for match in _NEIGH_LINE.finditer(table):
        if match.group("state") not in ("REACHABLE", "STALE", "DELAY", "PERMANENT"):
            continue
        mac = match.group("mac").lower()
        clients.append(
            {
                "ip": match.group("ip"),
                "mac": mac,
                "hostname": leases.get(mac),
                "interface": match.group("dev"),
            }
        )
    return clients
