"""module_dpi_flow — headers-only flow observation.

Answers one question for the customer: *which hostnames is this device on my
network talking to?* It reads the TLS ClientHello SNI and the HTTP/1.x Host
header. Nothing else.

─────────────────────────────────────────────────────────────────────────────
WHAT THIS DELIBERATELY DOES NOT DO
─────────────────────────────────────────────────────────────────────────────
"Deep packet inspection" is a phrase that covers everything from reading a
hostname to decrypting a customer's banking session. This module sits at the
shallow end and the boundary is structural, not a policy note:

- It never sees plaintext bodies. The SNI is the one field a TLS client sends
  in the clear, before the handshake completes, precisely so a middlebox can
  route on it. Reading it does not weaken TLS and does not require a key.
- It does not terminate, proxy, downgrade or MITM anything. No certificate is
  ever generated. If Gate^Flame ever needed that it would be a different
  product with a different conversation with the customer.
- It parses at most `_MAX_PARSE_BYTES` from the front of a frame and retains
  only a hostname string and a counter. The frame itself is never stored,
  never logged and never leaves the function.
- Encrypted Client Hello (ECH) will make SNI unreadable over time. That is
  fine and expected: this module reports `null` for those flows rather than
  reaching for a more invasive technique to keep the number looking full.
  A shrinking DPI number over the next few years is the internet getting
  more private, not the product breaking.

─────────────────────────────────────────────────────────────────────────────
WHY THE PARSER IS SHAPED LIKE THIS
─────────────────────────────────────────────────────────────────────────────
`parse_frame()` is a pure function: bytes in, an observation or None out. No
socket, no state, no I/O. That is what makes it testable against truncated,
malformed and hostile input without root or a NIC — and a packet parser that
cannot be fuzzed on a laptop will not be fuzzed at all.

Every read goes through `_Reader`, which bounds-checks. A parser fed
attacker-controlled length fields is the classic place to hand someone a
crash on a device that is supposed to be the security appliance, so there is
no arithmetic on a length that has not been validated against the remaining
buffer first, and the whole thing is wrapped so a parse failure is always
`None` rather than an exception reaching the capture loop.

Capture requires CAP_NET_RAW. Without it the module reports `degraded` with
the remedy and observes nothing — it never fabricates flows.
"""

from __future__ import annotations

import collections
import logging
import re
import threading
import time
from dataclasses import dataclass

logger = logging.getLogger("gateflame.dpi")

# A ClientHello worth reading is small. Anything past this is either a
# non-TLS frame or someone hoping we will keep walking a length field.
_MAX_PARSE_BYTES = 4096
_MAX_HOSTNAME_LEN = 253  # RFC 1035 limit on a fully-qualified domain name

ETH_HEADER_LEN = 14
ETHERTYPE_IPV4 = 0x0800
ETHERTYPE_IPV6 = 0x86DD
ETHERTYPE_VLAN = 0x8100
PROTO_TCP = 6

TLS_CONTENT_HANDSHAKE = 0x16
TLS_HANDSHAKE_CLIENT_HELLO = 0x01
TLS_EXT_SERVER_NAME = 0x0000

# A hostname we are willing to record. Deliberately strict: this string ends
# up in the UI, in logs and potentially in a support conversation, so it must
# not be able to carry anything but a hostname.
_HOSTNAME_RE = re.compile(rb"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?"
                          rb"(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")


@dataclass(frozen=True)
class Observation:
    """One hostname seen from one LAN source. No payload, ever."""

    source: str
    hostname: str
    protocol: str  # "tls" | "http"


class _Reader:
    """Bounds-checked cursor. The only way this module reads bytes.

    Every accessor validates against the remaining buffer BEFORE any
    arithmetic on a length taken from the wire. `_Truncated` is raised rather
    than returning a short read, so a caller cannot accidentally treat a
    partial value as a real one.
    """

    class _Truncated(Exception):
        pass

    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0

    @property
    def remaining(self) -> int:
        return len(self._data) - self._pos

    def take(self, n: int) -> bytes:
        if n < 0 or n > self.remaining:
            raise self._Truncated
        chunk = self._data[self._pos : self._pos + n]
        self._pos += n
        return chunk

    def u8(self) -> int:
        return self.take(1)[0]

    def u16(self) -> int:
        b = self.take(2)
        return (b[0] << 8) | b[1]

    def u24(self) -> int:
        b = self.take(3)
        return (b[0] << 16) | (b[1] << 8) | b[2]

    def skip(self, n: int) -> None:
        self.take(n)


def _valid_hostname(raw: bytes) -> str | None:
    """Accept only something that is unambiguously a hostname.

    Rejects rather than sanitises. A sanitiser has to be right about every
    encoding trick; a strict accept-list only has to be right about what a
    hostname looks like.
    """
    if not raw or len(raw) > _MAX_HOSTNAME_LEN:
        return None
    lowered = raw.lower()
    if not _HOSTNAME_RE.match(lowered):
        return None
    try:
        text = lowered.decode("ascii")
    except UnicodeDecodeError:
        return None
    # An IP literal satisfies the hostname grammar (digits and dots are both
    # legal) but is not a hostname. SNI must not contain one per RFC 6066,
    # and an HTTP Host that is a bare address tells the customer nothing this
    # module is for — the source/destination view already covers addresses.
    # Recording it would just add noise that looks like a resolved name.
    import ipaddress

    try:
        ipaddress.ip_address(text)
    except ValueError:
        return text
    return None


def _parse_sni(reader: _Reader) -> str | None:
    """Extract the SNI from a TLS ClientHello body."""
    reader.skip(2)  # client_version
    reader.skip(32)  # random
    reader.skip(reader.u8())  # session_id
    reader.skip(reader.u16())  # cipher_suites
    reader.skip(reader.u8())  # compression_methods
    if reader.remaining < 2:
        return None  # no extensions — legal, just means no SNI
    ext_total = reader.u16()
    if ext_total > reader.remaining:
        # A length field claiming more than we hold. Refuse rather than
        # clamping: clamping is how a parser gets walked past its buffer.
        raise _Reader._Truncated
    end = reader.remaining - ext_total
    while reader.remaining > end + 3:
        ext_type = reader.u16()
        ext_len = reader.u16()
        if ext_len > reader.remaining:
            raise _Reader._Truncated
        if ext_type != TLS_EXT_SERVER_NAME:
            reader.skip(ext_len)
            continue
        # server_name_list
        list_len = reader.u16()
        if list_len > reader.remaining:
            raise _Reader._Truncated
        name_type = reader.u8()
        name_len = reader.u16()
        name = reader.take(name_len)
        if name_type != 0:  # 0 = host_name; nothing else is defined
            return None
        return _valid_hostname(name)
    return None


def _parse_http_host(payload: bytes) -> str | None:
    """Pull the Host header out of an HTTP/1.x request head.

    Only looks at the header block, and only at the first Host. Request
    smuggling starts with a parser that tolerates two of them, so a second
    Host header makes the whole frame unreadable rather than picking one.
    """
    head = payload[:_MAX_PARSE_BYTES].split(b"\r\n\r\n", 1)[0]
    lines = head.split(b"\r\n")
    if not lines or b" " not in lines[0]:
        return None
    method = lines[0].split(b" ", 1)[0]
    if method not in (b"GET", b"POST", b"HEAD", b"PUT", b"DELETE", b"OPTIONS", b"PATCH"):
        return None
    hosts = [ln for ln in lines[1:] if ln[:5].lower() == b"host:"]
    if len(hosts) != 1:
        return None
    value = hosts[0][5:].strip()
    # Strip a port, but reject userinfo or a path — neither belongs in Host
    # and both are signs of something trying to smuggle a value through.
    if b"/" in value or b"@" in value:
        return None
    if value.count(b":") == 1:
        value = value.split(b":", 1)[0]
    return _valid_hostname(value)


def parse_frame(frame: bytes) -> Observation | None:
    """Pure function. An Ethernet frame in, at most one hostname out.

    Returns None for anything that is not a readable TLS ClientHello or
    HTTP request — which is the overwhelming majority of traffic, and is not
    an error. Never raises: a parse failure on hostile input must degrade to
    "I learned nothing", never to an exception in the capture loop.
    """
    try:
        return _parse_frame_inner(frame)
    except _Reader._Truncated:
        return None
    except Exception:
        logger.debug("frame parse failed", exc_info=True)
        return None


def _parse_frame_inner(frame: bytes) -> Observation | None:
    reader = _Reader(frame[:_MAX_PARSE_BYTES])
    reader.skip(12)  # dst + src MAC — never recorded
    ethertype = reader.u16()
    if ethertype == ETHERTYPE_VLAN:
        reader.skip(2)
        ethertype = reader.u16()

    if ethertype == ETHERTYPE_IPV4:
        first = reader.u8()
        if first >> 4 != 4:
            return None
        ihl = (first & 0x0F) * 4
        if ihl < 20:
            return None
        reader.skip(1)  # dscp
        reader.u16()  # total_length — not trusted; we use what we actually hold
        reader.skip(4)  # id + flags/frag
        reader.skip(1)  # ttl
        protocol = reader.u8()
        reader.skip(2)  # checksum
        src = ".".join(str(b) for b in reader.take(4))
        reader.skip(4)  # dst
        reader.skip(ihl - 20)  # options
    elif ethertype == ETHERTYPE_IPV6:
        first = reader.u8()
        if first >> 4 != 6:
            return None
        reader.skip(3)  # rest of flow label
        reader.u16()  # payload length
        protocol = reader.u8()
        reader.skip(1)  # hop limit
        src = _format_v6(reader.take(16))
        reader.skip(16)  # dst
        # Extension headers are not walked. A fragmented or extension-laden
        # ClientHello is simply not read — under-reporting is the correct
        # direction for a module whose failure mode should never be a crash.
    else:
        return None

    if protocol != PROTO_TCP:
        return None

    reader.skip(2)  # sport
    reader.skip(2)  # dport
    reader.skip(8)  # seq + ack
    data_offset = (reader.u8() >> 4) * 4
    if data_offset < 20:
        return None
    reader.skip(1)  # flags
    reader.skip(2)  # window
    reader.skip(2)  # checksum
    reader.skip(2)  # urgent
    reader.skip(data_offset - 20)  # tcp options

    payload = reader.take(reader.remaining)
    if not payload:
        return None

    if payload[0] == TLS_CONTENT_HANDSHAKE:
        tls = _Reader(payload)
        tls.skip(1)  # content type
        tls.skip(2)  # legacy record version
        record_len = tls.u16()
        if record_len > tls.remaining:
            # Truncated record: the ClientHello spans more than we captured.
            # Read what is here; the SNI is near the front by construction.
            pass
        if tls.u8() != TLS_HANDSHAKE_CLIENT_HELLO:
            return None
        tls.u24()  # handshake length
        host = _parse_sni(tls)
        return Observation(source=src, hostname=host, protocol="tls") if host else None

    host = _parse_http_host(payload)
    return Observation(source=src, hostname=host, protocol="http") if host else None


def _format_v6(raw: bytes) -> str:
    import ipaddress

    try:
        return str(ipaddress.IPv6Address(raw))
    except ValueError:
        return "::"


class FlowTable:
    """Bounded aggregate of what has been seen.

    Bounded on purpose: an unbounded hostname->count dict is a memory
    exhaustion primitive that any device on the LAN can drive by resolving
    random names. When full, the least-recently-seen entry is evicted and the
    fact that eviction happened is reported, so a truncated view never
    masquerades as a complete one.
    """

    def __init__(self, max_entries: int = 2048, ttl_seconds: int = 3600):
        self._max = max_entries
        self._ttl = ttl_seconds
        self._lock = threading.Lock()
        self._entries: collections.OrderedDict[tuple[str, str], dict] = (
            collections.OrderedDict()
        )
        self.evictions = 0

    def record(self, obs: Observation, now: float | None = None) -> None:
        now = time.time() if now is None else now
        key = (obs.source, obs.hostname)
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                entry = {
                    "source": obs.source,
                    "hostname": obs.hostname,
                    "protocol": obs.protocol,
                    "count": 0,
                    "firstSeen": now,
                    "lastSeen": now,
                }
                self._entries[key] = entry
            entry["count"] += 1
            entry["lastSeen"] = now
            self._entries.move_to_end(key)
            while len(self._entries) > self._max:
                self._entries.popitem(last=False)
                self.evictions += 1

    def snapshot(self, now: float | None = None, limit: int = 200) -> dict:
        now = time.time() if now is None else now
        with self._lock:
            live = [
                dict(e) for e in self._entries.values() if now - e["lastSeen"] <= self._ttl
            ]
        live.sort(key=lambda e: e["lastSeen"], reverse=True)
        return {
            "flows": live[:limit],
            "truncated": len(live) > limit,
            "evictions": self.evictions,
            "note": (
                "Hostnames only — SNI and HTTP Host. No payload is read or stored. "
                "Flows using Encrypted Client Hello are not visible here by design."
            ),
        }


def capability(has_cap_net_raw=None) -> tuple[bool, str | None]:
    """(usable, gap). Never raises — this is called from status paths."""
    try:
        probe = _has_cap_net_raw if has_cap_net_raw is None else has_cap_net_raw
        if not probe():
            return (
                False,
                "no CAP_NET_RAW — grant it to the unit "
                "(AmbientCapabilities=CAP_NET_RAW in gateflame.service), never run as root",
            )
    except Exception as exc:
        return False, f"cannot determine packet capture capability: {exc}"
    return True, None


def _has_cap_net_raw() -> bool:
    """Read the effective capability set from /proc/self/status.

    Checked rather than assumed: attempting to open an AF_PACKET socket to
    find out would be a side effect in a status path, and status paths must
    be free of those.
    """
    CAP_NET_RAW_BIT = 13
    try:
        with open("/proc/self/status", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("CapEff:"):
                    return bool(int(line.split()[1], 16) & (1 << CAP_NET_RAW_BIT))
    except OSError:
        return False
    return False
