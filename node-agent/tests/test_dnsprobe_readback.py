"""The installer's DNS read-back tells blocking, not-blocking and no-WAN apart.

The 1.0.3 install on the lab printed "FAIL DNS silent" for a running box: it
asked for doubleclick.net with a 4 s budget and called anything short of a
reply silence. The lab router has no WAN uplink, which is exactly when "blocked
from gravity" (needs no internet), "forwarded and failed" and "timed out" have to
be told apart - gateflame/dnsprobe.py does that, and these tests drive it
against a real UDP server on loopback.
"""

from __future__ import annotations

import socket
import struct
import threading

import pytest

from gateflame import dnsprobe
from gateflame.dnsprobe import Answer


class FakeDNS:
    """A tiny UDP DNS server: name -> ("A", "1.2.3.4") | ("RCODE", 2) | ("SILENT",)."""

    def __init__(self, table: dict):
        self.table = table
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.hits: dict[str, int] = {}
        self._stop = False
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self):
        self.sock.settimeout(0.2)
        while not self._stop:
            try:
                data, addr = self.sock.recvfrom(512)
            except OSError:
                continue
            qid = struct.unpack(">H", data[:2])[0]
            i, labels = 12, []
            while data[i]:
                labels.append(data[i + 1:i + 1 + data[i]].decode())
                i += 1 + data[i]
            name = ".".join(labels)
            question = data[12:i + 5]
            self.hits[name] = self.hits.get(name, 0) + 1
            rule = self.table.get(name, ("RCODE", 3))
            if rule[0] == "SILENT" or (rule[0] == "SILENT_ONCE" and self.hits[name] == 1):
                continue
            if rule[0] in ("A", "SILENT_ONCE"):
                ip = rule[1]
                answer = b"\xc0\x0c" + struct.pack(">HHIH", 1, 1, 60, 4) + socket.inet_aton(ip)
                self.sock.sendto(struct.pack(">HHHHHH", qid, 0x8180, 1, 1, 0, 0) + question + answer, addr)
            elif rule[0] == "RCODE":
                self.sock.sendto(struct.pack(">HHHHHH", qid, 0x8180 | rule[1], 1, 0, 0, 0) + question, addr)

    def close(self):
        self._stop = True
        self.thread.join(2)
        self.sock.close()


@pytest.fixture
def dns():
    servers: list[FakeDNS] = []

    def make(table):
        s = FakeDNS(table)
        servers.append(s)
        return s

    yield make
    for s in servers:
        s.close()


# ------------------------------------------------------------------ query()


def test_query_reads_the_address_and_the_rcode(dns):
    s = dns({"doubleclick.net": ("A", "0.0.0.0"), "broken.example": ("RCODE", 2)})
    a = dnsprobe.query("127.0.0.1", "doubleclick.net", port=s.port, timeout=2)
    assert a.rcode == "NOERROR" and a.addresses == ["0.0.0.0"] and a.is_block
    b = dnsprobe.query("127.0.0.1", "broken.example", port=s.port, timeout=2)
    assert b.rcode == "SERVFAIL" and not b.is_block, "a SERVFAIL is a forward that failed, not a block"


def test_query_silence_is_no_answer_not_an_exception(dns):
    s = dns({"slow.example": ("SILENT",)})
    a = dnsprobe.query("127.0.0.1", "slow.example", port=s.port, timeout=0.3)
    assert a.timed_out


def test_retries_happen_only_on_silence(dns):
    s = dns({"doubleclick.net": ("SILENT_ONCE", "0.0.0.0")})
    a, tries = dnsprobe.query_with_retries("127.0.0.1", "doubleclick.net", attempts=3, timeout=0.3, port=s.port)
    assert a.is_block and tries == 2


# ---------------------------------------------------------------- classify()


def levels(verdicts):
    return [v.level for v in verdicts]


def test_blocked_from_gravity_with_no_wan_is_a_pass_and_a_warn():
    """THE LAB TODAY: blocking proven, clean names cannot resolve - not a fault."""
    v = dnsprobe.classify("127.0.0.1", Answer("NOERROR", ["0.0.0.0"]), Answer(None), wan=False)
    assert levels(v) == ["PASS", "WARN"]
    assert "blocking proven" in v[0].message
    assert "NO internet" in v[1].message


def test_no_wan_and_servfail_on_the_clean_name_is_still_only_a_warn():
    v = dnsprobe.classify("x", Answer("NXDOMAIN"), Answer("SERVFAIL"), wan=False)
    assert levels(v) == ["PASS", "WARN"]


def test_a_real_address_for_the_blocked_name_is_a_fail():
    v = dnsprobe.classify("x", Answer("NOERROR", ["142.250.1.1"]), Answer("NOERROR", ["1.2.3.4"]), wan=True)
    assert v[0].level == "FAIL" and "NOT BLOCKING" in v[0].message
    assert v[1].level == "PASS"


def test_a_servfail_for_the_blocked_name_is_not_blocking():
    """Before: any empty reply printed as 'NXDOMAIN' and passed as blocked."""
    v = dnsprobe.classify("x", Answer("SERVFAIL"), Answer(None), wan=False)
    assert v[0].level == "FAIL" and "forwarded it instead of blocking" in v[0].message


def test_total_silence_is_one_fail():
    v = dnsprobe.classify("x", Answer(None), Answer(None), wan=True)
    assert levels(v) == ["FAIL"] and "silent" in v[0].message


def test_clean_failure_with_wan_is_a_fail():
    v = dnsprobe.classify("x", Answer("NOERROR", ["0.0.0.0"]), Answer("SERVFAIL"), wan=True)
    assert levels(v) == ["PASS", "FAIL"] and "internet IS reachable" in v[1].message


# ------------------------------------------------------------------ readback()


def test_readback_end_to_end_on_a_box_with_no_wan(dns):
    s = dns({"doubleclick.net": ("A", "0.0.0.0"), "www.ionity.today": ("RCODE", 2)})
    verdicts = dnsprobe.readback(["127.0.0.1"], port=s.port, wan=False, timeout=1, attempts=2)
    assert levels(verdicts) == ["WARN", "PASS", "WARN"]
    assert not any(v.level == "FAIL" for v in verdicts)


def test_readback_fails_when_the_filter_is_not_blocking(dns):
    s = dns({"doubleclick.net": ("A", "142.250.1.1"), "www.ionity.today": ("A", "1.2.3.4")})
    verdicts = dnsprobe.readback(["127.0.0.1"], port=s.port, wan=True, timeout=1)
    assert "FAIL" in levels(verdicts)


def test_parse_rejects_a_response_to_someone_elses_query():
    reply = struct.pack(">HHHHHH", 1, 0x8180, 0, 0, 0, 0)
    with pytest.raises(ValueError):
        dnsprobe.parse_response(reply, qid=2)


def test_the_module_needs_nothing_outside_the_standard_library():
    """The installers run it with the system python3, before any venv exists."""
    import ast
    import sys
    from pathlib import Path

    src = Path(dnsprobe.__file__).read_text(encoding="utf-8")
    imported = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            imported.add(node.module.split(".")[0])
    assert imported <= set(sys.stdlib_module_names), imported - set(sys.stdlib_module_names)
