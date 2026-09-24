# ========================================================================================
# GATE^FLAME - HONESTY FIXES FROM THE 2026-09-21 AUDIT
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# Three places where the agent said something it had not measured:
#
#   * clients.py returned [] when `ip neigh` could not be READ - "no devices on your
#     network" to a customer holding their phone.
#   * upstream.py's "read-back" used socket.getaddrinfo(), i.e. /etc/resolv.conf, so
#     it passed for an upstream Pi-hole had never used.
#   * /vpn/continents returned a bare [] on a cold cache with none of the flags
#     /vpn/regions carries, re-creating the 2026-08-31 "Not set up on this box" bug.
# ========================================================================================

import socket
import struct
import subprocess
import threading

from gateflame import clients, upstream


# ------------------------------------------------------------------ clients gap
def _neigh_ok(*_a, **_k):
    return subprocess.CompletedProcess(["ip", "neigh"], 0, stdout="", stderr="")


def test_readable_but_empty_table_is_an_empty_house_with_no_gap(monkeypatch):
    monkeypatch.setattr(clients.subprocess, "run", _neigh_ok)
    monkeypatch.setattr(clients, "_read_leases", lambda: {})
    rows, gap = clients.list_clients_with_gap()
    assert rows == []
    assert gap is None


def test_nonzero_exit_is_a_gap_not_an_empty_house(monkeypatch):
    monkeypatch.setattr(
        clients.subprocess, "run",
        lambda *a, **k: subprocess.CompletedProcess(a[0], 1, stdout="", stderr="boom"),
    )
    monkeypatch.setattr(clients, "_read_leases", lambda: {})
    rows, gap = clients.list_clients_with_gap()
    assert rows == []
    assert gap is not None and "neighbour table" in gap and "exited 1" in gap


def test_missing_ip_binary_is_a_gap(monkeypatch):
    def _raise(*_a, **_k):
        raise FileNotFoundError("ip")
    monkeypatch.setattr(clients.subprocess, "run", _raise)
    monkeypatch.setattr(clients, "_read_leases", lambda: {})
    rows, gap = clients.list_clients_with_gap()
    assert rows == []
    assert gap is not None and "FileNotFoundError" in gap


def test_timeout_is_a_gap(monkeypatch):
    def _raise(*_a, **_k):
        raise subprocess.TimeoutExpired(cmd="ip neigh", timeout=2)
    monkeypatch.setattr(clients.subprocess, "run", _raise)
    monkeypatch.setattr(clients, "_read_leases", lambda: {})
    _rows, gap = clients.list_clients_with_gap()
    assert gap is not None and "timed out" in gap


def test_legacy_list_clients_still_returns_rows_only(monkeypatch):
    monkeypatch.setattr(clients.subprocess, "run", _neigh_ok)
    monkeypatch.setattr(clients, "_read_leases", lambda: {})
    assert clients.list_clients() == []


# ---------------------------------------------------------- upstream read-back
def _fake_dns_server(handler):
    """Bind a UDP socket on 127.0.0.1:<ephemeral>, answer one query via handler."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    srv.bind(("127.0.0.1", 0))
    srv.settimeout(3)
    port = srv.getsockname()[1]

    def run():
        try:
            data, addr = srv.recvfrom(512)
            resp = handler(data)
            if resp is not None:
                srv.sendto(resp, addr)
        except OSError:
            pass
        finally:
            srv.close()

    threading.Thread(target=run, daemon=True).start()
    return port


def _answer(data: bytes, rcode: int = 0, ancount: int = 1) -> bytes:
    qid = struct.unpack(">H", data[:2])[0]
    header = struct.pack(">HHHHHH", qid, 0x8180 | rcode, 1, ancount, 0, 0)
    question = data[12:]
    rr = b"\xc0\x0c" + struct.pack(">HHIH", 1, 1, 60, 4) + bytes([1, 2, 3, 4])
    return header + question + (rr if ancount else b"")


def _probe(port: int) -> bool:
    # The function talks to port 53; the test points it at an ephemeral port via
    # a tiny shim so it never needs root.
    real = socket.socket

    class Sock(real):
        def sendto(self, data, addr):  # type: ignore[override]
            return super().sendto(data, (addr[0], port))

    upstream.socket.socket = Sock
    try:
        return upstream._resolve_through_box("dns.google", timeout=2.0)
    finally:
        upstream.socket.socket = real


def test_readback_is_a_real_query_to_the_box_and_accepts_an_answer():
    port = _fake_dns_server(lambda d: _answer(d))
    assert _probe(port) is True


def test_readback_rejects_servfail():
    port = _fake_dns_server(lambda d: _answer(d, rcode=2, ancount=0))
    assert _probe(port) is False


def test_readback_rejects_empty_answer():
    port = _fake_dns_server(lambda d: _answer(d, rcode=0, ancount=0))
    assert _probe(port) is False


def test_readback_times_out_when_nothing_answers():
    port = _fake_dns_server(lambda d: None)
    assert _probe(port) is False


def test_readback_never_uses_the_host_resolver(monkeypatch):
    """getaddrinfo is the bug. If it is ever called again this fails loudly."""
    def _boom(*_a, **_k):
        raise AssertionError("upstream read-back must not consult /etc/resolv.conf")
    monkeypatch.setattr(upstream.socket, "getaddrinfo", _boom)
    port = _fake_dns_server(lambda d: _answer(d))
    assert _probe(port) is True
