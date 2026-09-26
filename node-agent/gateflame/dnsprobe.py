"""A dependency-free DNS probe and the installer's DNS read-back.

    python3 -m gateflame.dnsprobe readback 127.0.0.1 192.168.124.3

Standard library only, on purpose: the installers run this with the system
python3, before (or without) the agent's venv, on boards that ship neither dig
nor nslookup (Raspberry Pi OS Lite, Radxa OS minimal).

WHY A READ-BACK NEEDS MORE THAN "DID SOMETHING ANSWER"

The 1.0.3 install on the lab printed

    FAIL  DNS silent on 127.0.0.1
    FAIL  DNS silent on 192.168.124.3

for a box that was running. The probe asked for doubleclick.net, gave it four
seconds, and treated anything but a reply as silence. The lab router has no
WAN uplink, and that single fact makes several different situations look alike
from a four-second timeout:

  * doubleclick.net answered 0.0.0.0 from gravity  -> BLOCKING PROVEN. Needs no
    internet at all: Pi-hole answers it locally.
  * doubleclick.net answered with a real address    -> NOT BLOCKING (gravity
    does not hold it). A real fault, internet or not.
  * doubleclick.net came back SERVFAIL              -> Pi-hole did not block it
    and forwarded it, and the forward failed. Also NOT BLOCKING.
  * a CLEAN name timed out or SERVFAILed            -> expected when this box
    has no internet; a real fault when it does.
  * nothing answered at all, repeatedly             -> the resolver is silent.

Each needs a different action, so each gets its own verdict and sentence here,
and whether the box has an internet uplink is measured (TCP connect to public
anycast resolvers), not assumed.
"""

from __future__ import annotations

import random
import socket
import struct
import sys
import time
from dataclasses import dataclass, field

RCODES = {0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED"}

BLOCKED_PROBE = "doubleclick.net"
CLEAN_PROBE = "www.ionity.today"
WAN_TARGETS = (("1.1.1.1", 443), ("9.9.9.9", 443), ("8.8.8.8", 443))


@dataclass
class Answer:
    """One query's outcome. `rcode` is None when nothing came back in time."""

    rcode: str | None
    addresses: list[str] = field(default_factory=list)
    elapsed_ms: float | None = None

    @property
    def timed_out(self) -> bool:
        return self.rcode is None

    @property
    def is_block(self) -> bool:
        """Pi-hole's blocking replies: NULL (0.0.0.0/::), NXDOMAIN, or NODATA."""
        if self.rcode == "NXDOMAIN":
            return True
        if self.rcode == "NOERROR":
            return not self.addresses or all(a in ("0.0.0.0", "::") for a in self.addresses)
        return False

    def describe(self) -> str:
        if self.timed_out:
            return "no answer"
        if self.addresses:
            return ", ".join(self.addresses[:3])
        return self.rcode or "?"


def _encode_name(name: str) -> bytes:
    out = b""
    for part in name.strip(".").split("."):
        raw = part.encode("idna")
        if not 0 < len(raw) < 64:
            raise ValueError(f"bad label in {name!r}")
        out += bytes([len(raw)]) + raw
    return out + b"\x00"


def _skip_name(data: bytes, i: int) -> int:
    while i < len(data):
        length = data[i]
        if length == 0:
            return i + 1
        if length & 0xC0 == 0xC0:   # compression pointer: 2 bytes, ends the name
            return i + 2
        i += 1 + length
    raise ValueError("truncated name")


def parse_response(data: bytes, qid: int) -> Answer:
    if len(data) < 12:
        raise ValueError("short response")
    rid, flags, qdcount, ancount = struct.unpack(">HHHH", data[:8])
    if rid != qid:
        raise ValueError("response id does not match the query")
    rcode = RCODES.get(flags & 0x000F, f"RCODE{flags & 0x000F}")
    i = 12
    for _ in range(qdcount):
        i = _skip_name(data, i) + 4
    addresses: list[str] = []
    for _ in range(ancount):
        i = _skip_name(data, i)
        if i + 10 > len(data):
            break
        rtype, _rclass, _ttl, rdlen = struct.unpack(">HHIH", data[i:i + 10])
        i += 10
        rdata = data[i:i + rdlen]
        i += rdlen
        if rtype == 1 and rdlen == 4:
            addresses.append(".".join(str(b) for b in rdata))
        elif rtype == 28 and rdlen == 16:
            addresses.append(socket.inet_ntop(socket.AF_INET6, rdata))
    return Answer(rcode=rcode, addresses=addresses)


def query(server: str, name: str, *, timeout: float = 3.0, port: int = 53, qtype: int = 1) -> Answer:
    """One UDP query. Never raises: a network error or a garbled reply is 'no answer'."""
    qid = random.randint(0, 0xFFFF)
    try:
        packet = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + _encode_name(name) + struct.pack(">HH", qtype, 1)
    except ValueError:
        return Answer(rcode=None)
    family = socket.AF_INET6 if ":" in server else socket.AF_INET
    started = time.monotonic()
    try:
        sock = socket.socket(family, socket.SOCK_DGRAM)
    except OSError:
        return Answer(rcode=None)
    try:
        sock.settimeout(timeout)
        sock.sendto(packet, (server, port))
        deadline = started + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return Answer(rcode=None)
            sock.settimeout(remaining)
            data, _ = sock.recvfrom(4096)
            try:
                answer = parse_response(data, qid)
            except ValueError:
                continue   # a stray or garbled datagram; keep waiting for ours
            answer.elapsed_ms = round((time.monotonic() - started) * 1000, 1)
            return answer
    except OSError:
        return Answer(rcode=None)
    finally:
        sock.close()


def query_with_retries(server: str, name: str, *, attempts: int = 3, timeout: float = 3.0,
                       port: int = 53) -> tuple[Answer, int]:
    """Retry only on silence: a real answer, of any kind, is final. (answer, tries used)."""
    answer = Answer(rcode=None)
    for n in range(1, attempts + 1):
        answer = query(server, name, timeout=timeout, port=port)
        if not answer.timed_out:
            return answer, n
    return answer, attempts


def wan_reachable(targets=WAN_TARGETS, timeout: float = 2.0) -> bool:
    """Does this box have a path to the internet? A TCP handshake to a public
    anycast resolver proves it without depending on DNS (which is the thing
    under test)."""
    for host, port in targets:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            continue
    return False


@dataclass
class Verdict:
    level: str      # PASS | WARN | FAIL
    message: str


def classify(listener: str, blocked: Answer, clean: Answer, wan: bool, *,
             blocked_name: str = BLOCKED_PROBE, clean_name: str = CLEAN_PROBE,
             blocked_tries: int = 1) -> list[Verdict]:
    """The read-back's verdicts for one listener. Pure: all I/O happens before."""
    out: list[Verdict] = []
    retried = f" (answered on attempt {blocked_tries})" if blocked_tries > 1 else ""

    if blocked.timed_out and clean.timed_out:
        out.append(Verdict("FAIL", f"DNS silent on {listener}: neither {blocked_name} nor {clean_name} got any answer"))
        return out

    if blocked.is_block:
        out.append(Verdict("PASS", f"blocking proven on {listener}: {blocked_name} -> {blocked.describe()}{retried}"))
    elif blocked.timed_out:
        out.append(Verdict("FAIL", f"{listener} answered {clean_name} but gave no answer for {blocked_name}, "
                                   "which Pi-hole should answer from its own blocklist"))
    elif blocked.rcode == "NOERROR":
        out.append(Verdict("FAIL", f"NOT BLOCKING on {listener}: {blocked_name} resolved to {blocked.describe()} "
                                   "- gravity does not hold it (empty blocklist, or filtering paused)"))
    else:
        out.append(Verdict("FAIL", f"NOT BLOCKING on {listener}: {blocked_name} came back {blocked.rcode}, "
                                   "so Pi-hole forwarded it instead of blocking it - gravity does not hold it"))

    if clean.rcode == "NOERROR" and clean.addresses:
        out.append(Verdict("PASS", f"recursion works on {listener}: {clean_name} -> {clean.describe()}"))
    elif not wan:
        why = "timed out" if clean.timed_out else f"came back {clean.rcode}"
        out.append(Verdict("WARN", f"{clean_name} {why} on {listener} - expected: this box has NO internet "
                                   "uplink (no public resolver reachable), so nothing outside the "
                                   "blocklist can resolve. Not a Gate^Flame fault."))
    else:
        why = "timed out" if clean.timed_out else f"came back {clean.rcode or 'empty'}"
        out.append(Verdict("FAIL", f"{clean_name} {why} on {listener} although the internet IS reachable "
                                   "- the recursive resolver (unbound) or Pi-hole's upstream is broken"))
    return out


def readback(listeners: list[str], *, port: int = 53, wan: bool | None = None,
             blocked_name: str = BLOCKED_PROBE, clean_name: str = CLEAN_PROBE,
             attempts: int = 3, timeout: float = 3.0) -> list[Verdict]:
    have_wan = wan_reachable() if wan is None else wan
    verdicts = [Verdict("PASS" if have_wan else "WARN",
                        "internet uplink: reachable" if have_wan
                        else "internet uplink: NONE (no public resolver answered a TCP connect)")]
    for listener in listeners:
        if not listener:
            continue
        blocked, tries = query_with_retries(listener, blocked_name, attempts=attempts, timeout=timeout, port=port)
        clean = query(listener, clean_name, timeout=timeout + 2, port=port)
        verdicts.extend(classify(listener, blocked, clean, have_wan,
                                 blocked_name=blocked_name, clean_name=clean_name, blocked_tries=tries))
    return verdicts


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) >= 2 and argv[0] == "readback":
        verdicts = readback(argv[1:])
        for v in verdicts:
            print(f"      {v.level:<4}  {v.message}")
        return 1 if any(v.level == "FAIL" for v in verdicts) else 0
    if len(argv) == 2:
        answer = query(argv[0], argv[1])
        print(answer.describe() if not answer.timed_out else "")
        return 0 if not answer.timed_out else 1
    print("usage: python3 -m gateflame.dnsprobe readback <listener> [listener...]\n"
          "       python3 -m gateflame.dnsprobe <server> <name>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
