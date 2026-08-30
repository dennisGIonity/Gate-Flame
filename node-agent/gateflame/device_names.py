"""Turning MAC addresses into something a person can recognise.

WHY THIS EXISTS

`clients.py` reads the kernel neighbour table and the DHCP lease file. On this
product the lease file is always empty, because ADR-001 makes us a SIDE-CAR:
the router keeps DHCP, we never hand out leases, so we never learn a hostname.
Measured on the live box - every single client came back `"hostname": null`.

The Shield screen therefore listed raw MACs, which is what the owner reported:
unreadable, and easily mistaken for IPv6 addresses.

Three sources of a name, best first, and NONE of them invent one:

  1. A name the OWNER typed. Stored on the box, survives reboots. This is the
     only source that can be genuinely right, and for most phones it is the
     only source available at all (see randomised MACs below).
  2. The DHCP hostname, if a lease file ever does appear (a premium in-path
     box, or a household that lets us run DHCP).
  3. The IEEE OUI vendor of the MAC - a registry fact, not a guess. "Apple"
     tells you which handset far better than `ca:fe:24:3b:1c:cb` does.

If none of those exist the MAC is shown as-is. A device is never given a
made-up name.

THE LIMIT WORTH KNOWING: modern phones randomise their MAC per network for
privacy. A randomised (locally-administered) MAC has NO vendor - it is not in
any registry, by design. Of the real clients on the test LAN, most were
randomised. So vendor lookup helps with laptops, printers, TVs and routers,
and will usually NOT help with the phones - which is exactly why owner-set
names are the primary path and not a nice-to-have.
"""

from __future__ import annotations

# A deliberately small table of consumer-visible OUI prefixes. This is NOT the
# full IEEE registry (~35k entries, ~2 MB) - shipping that to a Pi to name a
# handful of household devices is not a trade worth making. Unknown prefixes
# fall through to the MAC, which is honest; a partial table never guesses.
#
# Source: IEEE MA-L assignments. Lowercase, colon-separated, first 3 octets.
_OUI: dict[str, str] = {
    "78:20:51": "TP-Link",
    "2c:a1:eb": "Intel",
    "dc:a6:32": "Raspberry Pi",
    "b8:27:eb": "Raspberry Pi",
    "e4:5f:01": "Raspberry Pi",
    "d8:3a:dd": "Raspberry Pi",
    "28:cd:c1": "Raspberry Pi",
    "00:1a:11": "Google",
    "f4:f5:d8": "Google",
    "3c:5a:b4": "Google",
    "ac:de:48": "Apple",
    "f0:18:98": "Apple",
    "a4:83:e7": "Apple",
    "8c:85:90": "Apple",
    "dc:2b:2a": "Apple",
    "00:16:6c": "Samsung",
    "5c:0a:5b": "Samsung",
    "78:1f:db": "Samsung",
    "e8:50:8b": "Samsung",
    "00:12:fb": "Samsung",
    "fc:db:b3": "Samsung",
    "00:1d:7e": "Cisco-Linksys",
    "00:23:69": "Cisco-Linksys",
    "c0:56:27": "Belkin",
    "94:10:3e": "Belkin",
    "00:24:01": "D-Link",
    "1c:bd:b9": "D-Link",
    "00:1f:33": "Netgear",
    "a0:40:a0": "Netgear",
    "20:e5:2a": "Netgear",
    "00:0c:29": "VMware",
    "00:50:56": "VMware",
    "08:00:27": "VirtualBox",
    "00:15:5d": "Hyper-V",
    "b4:2e:99": "Giga-Byte",
    "00:e0:4c": "Realtek",
    "52:54:00": "QEMU/KVM",
    "00:04:4b": "NVIDIA",
    "48:b0:2d": "NVIDIA",
    "00:17:88": "Philips Hue",
    "ec:fa:bc": "Espressif (IoT)",
    "24:0a:c4": "Espressif (IoT)",
    "a0:20:a6": "Espressif (IoT)",
    "b8:d7:af": "Murata (IoT)",
    "00:1e:c0": "Microchip",
    "18:fe:34": "Espressif (IoT)",
    "00:80:92": "Silex",
    "9c:8e:cd": "Amazon",
    "fc:65:de": "Amazon",
    "68:37:e9": "Amazon",
    "00:bb:3a": "Amazon",
    "6c:56:97": "Amazon",
    "00:04:20": "Slim Devices",
    "b0:be:76": "TP-Link",
    "50:c7:bf": "TP-Link",
    "a4:2b:b0": "TP-Link",
    "60:32:b1": "TP-Link",
    "1c:61:b4": "TP-Link",
    "00:1c:c0": "Intel",
    "3c:97:0e": "Intel",
    "8c:16:45": "Intel",
    "00:26:b9": "Dell",
    "18:66:da": "Dell",
    "d4:be:d9": "Dell",
    "00:21:5a": "HP",
    "3c:d9:2b": "HP",
    "70:5a:0f": "HP",
    "00:1b:78": "HP",
    "00:24:e8": "Dell",
    "00:04:f2": "Polycom",
    "00:09:0f": "Fortinet",
    "00:1b:63": "Apple",
    "00:03:93": "Apple",
    "68:96:7b": "Apple",
    "d0:81:7a": "Apple",
    "90:dd:5d": "Apple",
    "f4:d4:88": "Apple",
    "cc:29:f5": "Apple",
    "84:38:35": "Apple",
    "00:1f:5b": "Apple",
    "00:25:00": "Apple",
    "34:12:98": "Apple",
    "6c:4d:73": "Apple",
    "98:5a:eb": "Apple",
    "b8:e8:56": "Apple",
    "1c:1a:c0": "Apple",
    "d0:03:4b": "Apple",
    "88:66:a5": "Apple",
    "00:1e:52": "Apple",
    "bc:92:6b": "Apple",
    "e0:ac:cb": "Apple",
}


def is_randomised_mac(mac: str) -> bool:
    """True for a locally-administered MAC - a privacy-randomised address.

    Bit 0x02 of the first octet is the U/L flag: set means locally
    administered, which in practice on a household LAN means the device chose
    the address itself rather than using its burned-in one. Such an address is
    in no registry and never will be, so vendor lookup is not merely missing,
    it is impossible. Saying so is better than showing an empty vendor field
    and letting someone assume the lookup failed.
    """
    try:
        first = int(mac.split(":")[0], 16)
    except (ValueError, IndexError):
        return False
    return bool(first & 0x02)


def vendor_for_mac(mac: str) -> str | None:
    """IEEE OUI vendor, or None. Never a guess - unknown returns None."""
    if not mac or is_randomised_mac(mac):
        return None
    return _OUI.get(mac.lower()[:8])


def short_mac(mac: str) -> str:
    """Last two octets, for telling two same-vendor devices apart."""
    parts = (mac or "").split(":")
    return "".join(parts[-2:]).upper() if len(parts) >= 2 else (mac or "")


def display_label(mac: str, owner_name: str | None, hostname: str | None) -> str:
    """The one place a client's on-screen name is decided.

    Order is owner > DHCP > vendor > raw MAC, and the fallback is always the
    real address rather than "Unknown device" - a MAC at least identifies the
    thing uniquely, which a placeholder does not.
    """
    if owner_name:
        return owner_name
    if hostname:
        return hostname
    vendor = vendor_for_mac(mac)
    if vendor:
        return f"{vendor} {short_mac(mac)}"
    return mac
