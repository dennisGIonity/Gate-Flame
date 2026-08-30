"""Client list — passive discovery only.

Reads the kernel neighbour table (what `ip neigh` shows) and, when present,
dnsmasq/Pi-hole DHCP lease files for a friendly name. Never sends probes,
never touches the network. On a host with no neighbour table (this sandbox,
most CI), returns an empty list rather than fabricating entries.

WHAT THE RAW TABLE LOOKS LIKE, and why this file no longer returns it as-is.

Measured on the live box, `ip neigh` gave back a list in which barely half the
rows were household devices:

    192.168.0.6   2c:a1:eb:40:1a:00  eth0                 <- the workstation
    192.168.0.6   2c:a1:eb:40:1a:00  wlan0                <- the SAME machine
    172.28.0.11   d6:f4:58:ed:a0:64  br-d515babb52be      <- a docker container
    fe80::4a6b..  ...                                     <- link-local

Three problems, all of which reached the Shield screen:

  * DUPLICATES. The box is dual-homed on one /24 (eth0 .10, wlan0 .13 - see
    the STATE doc), so every neighbour is seen twice, once per interface. A
    household with eight devices looked like sixteen.
  * CONTAINERS. Pi-hole and the rest of the DNS stack run in docker, and
    their bridge neighbours are indistinguishable from real clients in the
    raw table. Offering to put a VPN on `172.28.0.11` is offering to route
    our own resolver through Japan.
  * LINK-LOCAL. `fe80::` entries are the same devices again in IPv6 form,
    and they are what made the list look like "IPv6 device tags".

So this module now returns one row per physical device, household only.
Filtering is by ADDRESS SHAPE, never by name, so nothing real is dropped for
having an unfamiliar label.
"""

from __future__ import annotations

import ipaddress
import re
import subprocess
from pathlib import Path

from .device_names import display_label, is_randomised_mac, vendor_for_mac

LEASE_PATHS = [
    Path("/etc/pihole/dhcp.leases"),
    Path("/var/lib/misc/dnsmasq.leases"),
]

_NEIGH_LINE = re.compile(
    r"^(?P<ip>[0-9a-fA-F:.]+)\s+dev\s+(?P<dev>\S+)\s+lladdr\s+(?P<mac>[0-9a-f:]{17})\s+(?P<state>\S+)",
    re.MULTILINE,
)

# Interfaces that carry container traffic, not household traffic. Prefix match
# so a differently-hashed bridge id still matches.
_CONTAINER_IFACE_PREFIXES = ("docker", "br-", "veth", "lo")

# Broadcast/multicast MACs are not devices.
_NOT_A_DEVICE_MAC = {"00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff"}


def _read_leases() -> dict[str, str]:
    """mac -> hostname, from whichever lease file exists.

    Empty on this product: the router runs DHCP, we are a side-car. Kept
    because a premium in-path box, or a household that hands us DHCP, would
    populate it - and a real hostname beats every fallback below it.
    """
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


def _is_household_address(ip: str, iface: str) -> bool:
    """Whether this row describes a device on the customer's own network."""
    if any(iface.startswith(p) for p in _CONTAINER_IFACE_PREFIXES):
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    # Link-local is the same device again in another form - fe80:: for IPv6,
    # 169.254 for a machine that failed DHCP. Neither is a separate client.
    if addr.is_link_local or addr.is_loopback or addr.is_multicast:
        return False
    # Docker's default pools. A container is not a household device even when
    # it appears on an interface whose name we did not recognise above.
    if isinstance(addr, ipaddress.IPv4Address) and addr in ipaddress.ip_network("172.16.0.0/12"):
        return False
    return True


def list_clients(owner_names: dict[str, str] | None = None) -> list[dict]:
    """One row per physical device, household only, each with a real label.

    `owner_names` maps mac -> the name the owner typed for it (storage.py).
    Passing nothing is valid and simply means no device has been named yet.
    """
    try:
        out = subprocess.run(["ip", "neigh"], capture_output=True, text=True, timeout=2)
        table = out.stdout if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        table = ""

    leases = _read_leases()
    owner_names = {k.lower(): v for k, v in (owner_names or {}).items()}

    # MAC is the identity. The same device on eth0 and wlan0 is ONE device;
    # merging on MAC is what collapses the duplicate rows.
    by_mac: dict[str, dict] = {}

    for match in _NEIGH_LINE.finditer(table):
        if match.group("state") not in ("REACHABLE", "STALE", "DELAY", "PERMANENT"):
            continue
        mac = match.group("mac").lower()
        ip = match.group("ip")
        iface = match.group("dev")

        if mac in _NOT_A_DEVICE_MAC:
            continue
        if not _is_household_address(ip, iface):
            continue

        existing = by_mac.get(mac)
        if existing is None:
            hostname = leases.get(mac)
            by_mac[mac] = {
                "ip": ip,
                "mac": mac,
                "hostname": hostname,
                "interface": iface,
                # Everything below is derived, never invented - see
                # device_names.py for what each source can and cannot know.
                "ownerName": owner_names.get(mac),
                "vendor": vendor_for_mac(mac),
                "randomisedMac": is_randomised_mac(mac),
                "label": display_label(mac, owner_names.get(mac), hostname),
                # Kept so the UI can say "also seen on wlan0" rather than
                # silently discarding the fact that we merged two rows.
                "interfaces": [iface],
            }
        else:
            if iface not in existing["interfaces"]:
                existing["interfaces"].append(iface)
            # Prefer an IPv4 address for display: it is the one a person can
            # actually type into a browser or a router's admin page.
            try:
                if isinstance(ipaddress.ip_address(ip), ipaddress.IPv4Address) and \
                   not isinstance(ipaddress.ip_address(existing["ip"]), ipaddress.IPv4Address):
                    existing["ip"] = ip
            except ValueError:
                pass

    # Named devices first, then anything with a vendor, then bare MACs - so
    # the list the owner has curated stays at the top as it grows.
    return sorted(
        by_mac.values(),
        key=lambda c: (c["ownerName"] is None, c["vendor"] is None, c["label"].lower()),
    )
