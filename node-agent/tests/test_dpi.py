"""Tests for module_dpi_flow — the packet parser.

A packet parser is fed attacker-controlled length fields by definition, on a
device whose entire selling point is being the secure thing on the network.
So the bar here is not "does it read a hostname from a well-formed frame" —
it is "can any sequence of bytes make it crash, hang, over-read, or record
something that is not a hostname".

Everything runs against `parse_frame`, a pure function. No socket, no root,
no NIC.
"""

from __future__ import annotations

import random
import struct

import pytest

from gateflame import dpi
from gateflame.dpi import FlowTable, Observation, parse_frame

SRC_V4 = "192.168.1.55"


# ── frame construction helpers ─────────────────────────────────────────────


def eth(payload: bytes, ethertype: int = 0x0800) -> bytes:
    return b"\xaa" * 6 + b"\xbb" * 6 + struct.pack("!H", ethertype) + payload


def ipv4(payload: bytes, protocol: int = 6, src: str = SRC_V4) -> bytes:
    src_bytes = bytes(int(p) for p in src.split("."))
    return (
        bytes([0x45, 0x00])
        + struct.pack("!H", 20 + len(payload))
        + b"\x00\x00\x00\x00"
        + bytes([64, protocol])
        + b"\x00\x00"
        + src_bytes
        + b"\x08\x08\x08\x08"
        + payload
    )


def ipv6(payload: bytes, protocol: int = 6) -> bytes:
    src = bytes.fromhex("fd000000000000000000000000000055")
    return (
        bytes([0x60, 0, 0, 0])
        + struct.pack("!H", len(payload))
        + bytes([protocol, 64])
        + src
        + bytes.fromhex("20010db8000000000000000000000001")
        + payload
    )


def tcp(payload: bytes) -> bytes:
    return (
        struct.pack("!HH", 44444, 443)
        + b"\x00" * 8
        + bytes([0x50, 0x18])
        + b"\xff\xff\x00\x00\x00\x00"
        + payload
    )


def client_hello(hostname: bytes | None, *, name_type: int = 0) -> bytes:
    if hostname is None:
        extensions = b""
    else:
        server_name = bytes([name_type]) + struct.pack("!H", len(hostname)) + hostname
        sni_ext = struct.pack("!H", len(server_name)) + server_name
        extensions = struct.pack("!HH", 0x0000, len(sni_ext)) + sni_ext

    body = (
        b"\x03\x03"
        + b"\x11" * 32
        + b"\x00"  # session id length
        + struct.pack("!H", 2)
        + b"\x13\x01"  # cipher suites
        + b"\x01\x00"  # compression
        + struct.pack("!H", len(extensions))
        + extensions
    )
    handshake = bytes([0x01]) + struct.pack("!I", len(body))[1:] + body
    return bytes([0x16, 0x03, 0x01]) + struct.pack("!H", len(handshake)) + handshake


def tls_frame(hostname: bytes | None, **kw) -> bytes:
    return eth(ipv4(tcp(client_hello(hostname, **kw))))


def http_frame(head: bytes) -> bytes:
    return eth(ipv4(tcp(head)))


# ── 1. The happy paths ─────────────────────────────────────────────────────


def test_reads_sni_from_a_client_hello():
    obs = parse_frame(tls_frame(b"www.ionity.today"))
    assert obs == Observation(source=SRC_V4, hostname="www.ionity.today", protocol="tls")


def test_reads_host_from_an_http_request():
    obs = parse_frame(http_frame(b"GET /x HTTP/1.1\r\nHost: example.com\r\n\r\n"))
    assert obs.hostname == "example.com"
    assert obs.protocol == "http"


def test_hostname_is_lowercased():
    assert parse_frame(tls_frame(b"WWW.Ionity.TODAY")).hostname == "www.ionity.today"


def test_host_header_port_is_stripped():
    obs = parse_frame(http_frame(b"GET / HTTP/1.1\r\nHost: example.com:8443\r\n\r\n"))
    assert obs.hostname == "example.com"


def test_ipv6_source_is_read():
    frame = eth(ipv6(tcp(client_hello(b"example.com"))), ethertype=0x86DD)
    assert parse_frame(frame).source == "fd00::55"


def test_vlan_tagged_frames_are_read():
    inner = struct.pack("!H", 0x0800) + ipv4(tcp(client_hello(b"example.com")))
    frame = b"\xaa" * 6 + b"\xbb" * 6 + struct.pack("!H", 0x8100) + b"\x00\x64" + inner
    assert parse_frame(frame).hostname == "example.com"


# ── 2. Truncation at every offset must never raise ─────────────────────────


def test_truncation_at_every_single_offset_returns_none_not_an_exception():
    """The exhaustive version of 'handles short packets'. Every prefix of a
    valid frame is fed in; any crash here is a remote DoS on the appliance."""
    frame = tls_frame(b"www.ionity.today")
    for cut in range(len(frame)):
        assert parse_frame(frame[:cut]) is None or isinstance(
            parse_frame(frame[:cut]), Observation
        )


def test_truncated_http_never_raises():
    frame = http_frame(b"GET / HTTP/1.1\r\nHost: example.com\r\n\r\n")
    for cut in range(len(frame)):
        parse_frame(frame[:cut])  # must not raise


@pytest.mark.parametrize("payload", [b"", b"\x00", b"\x16", b"\x16\x03", b"\xff" * 10])
def test_tiny_and_empty_frames(payload):
    assert parse_frame(payload) is None


# ── 3. Hostile length fields — the classic parser kill ─────────────────────


def hello_with_extensions_total(hostname: bytes, claimed_total: int) -> bytes:
    """A ClientHello whose extensions-total length field is a lie."""
    server_name = b"\x00" + struct.pack("!H", len(hostname)) + hostname
    sni_ext = struct.pack("!H", len(server_name)) + server_name
    extensions = struct.pack("!HH", 0x0000, len(sni_ext)) + sni_ext
    body = (
        b"\x03\x03"
        + b"\x11" * 32
        + b"\x00"
        + struct.pack("!H", 2)
        + b"\x13\x01"
        + b"\x01\x00"
        + struct.pack("!H", claimed_total)   # <- the lie
        + extensions
    )
    handshake = bytes([0x01]) + struct.pack("!I", len(body))[1:] + body
    return bytes([0x16, 0x03, 0x01]) + struct.pack("!H", len(handshake)) + handshake


@pytest.mark.parametrize("claimed", [0xFFFF, 0x7FFF, 4096, 100])
def test_extension_length_larger_than_the_buffer_is_refused(claimed):
    """A length field claiming more than we hold must refuse, not clamp.
    Clamping is how a parser gets walked past its own buffer."""
    hostile = hello_with_extensions_total(b"example.com", claimed)
    assert parse_frame(eth(ipv4(tcp(hostile)))) is None


def test_server_name_length_larger_than_the_buffer_is_refused():
    good = client_hello(b"example.com")
    hostile = good.replace(struct.pack("!H", 11) + b"example.com",
                           struct.pack("!H", 60000) + b"example.com")
    assert parse_frame(eth(ipv4(tcp(hostile)))) is None


def test_session_id_length_claiming_the_whole_packet():
    body = b"\x03\x03" + b"\x11" * 32 + b"\xff" + b"\x00" * 8
    handshake = bytes([0x01]) + struct.pack("!I", len(body))[1:] + body
    record = bytes([0x16, 0x03, 0x01]) + struct.pack("!H", len(handshake)) + handshake
    assert parse_frame(eth(ipv4(tcp(record)))) is None


def test_ihl_below_the_legal_minimum_is_refused():
    bad = bytes([0x43, 0x00]) + b"\x00" * 18 + tcp(client_hello(b"example.com"))
    assert parse_frame(eth(bad)) is None


def test_tcp_data_offset_below_the_legal_minimum_is_refused():
    bad_tcp = (
        struct.pack("!HH", 4444, 443)
        + b"\x00" * 8
        + bytes([0x30, 0x18])  # data offset 3 → 12 bytes, illegal
        + b"\xff\xff\x00\x00\x00\x00"
        + client_hello(b"example.com")
    )
    assert parse_frame(eth(ipv4(bad_tcp))) is None


def test_ip_total_length_field_is_not_trusted():
    """A frame lying about its own length must not make the parser read past
    what was actually captured."""
    payload = tcp(client_hello(b"example.com"))
    lying = (
        bytes([0x45, 0x00])
        + struct.pack("!H", 60000)  # claims 60kB
        + b"\x00\x00\x00\x00"
        + bytes([64, 6])
        + b"\x00\x00"
        + bytes([192, 168, 1, 55])
        + b"\x08\x08\x08\x08"
        + payload
    )
    obs = parse_frame(eth(lying))
    assert obs is None or obs.hostname == "example.com"


# ── 4. Fuzz ────────────────────────────────────────────────────────────────


def test_random_bytes_never_raise():
    rng = random.Random(20260814)
    for _ in range(4000):
        size = rng.randint(0, 600)
        parse_frame(bytes(rng.getrandbits(8) for _ in range(size)))


def test_bit_flipped_valid_frames_never_raise():
    """Mutation fuzzing around a structurally valid frame — this reaches the
    deep length-field paths that pure random bytes almost never hit."""
    rng = random.Random(7)
    base = bytearray(tls_frame(b"www.ionity.today"))
    for _ in range(4000):
        mutant = bytearray(base)
        for _ in range(rng.randint(1, 5)):
            mutant[rng.randrange(len(mutant))] = rng.getrandbits(8)
        parse_frame(bytes(mutant))


def test_truncated_mutants_never_raise():
    rng = random.Random(99)
    base = bytearray(tls_frame(b"www.ionity.today"))
    for _ in range(2000):
        mutant = bytearray(base[: rng.randrange(1, len(base))])
        if mutant:
            mutant[rng.randrange(len(mutant))] = rng.getrandbits(8)
        parse_frame(bytes(mutant))


# ── 5. Only a hostname may ever be recorded ────────────────────────────────


@pytest.mark.parametrize(
    "hostile",
    [
        b"example.com\x00.evil.com",
        b"example.com\r\nX-Injected: 1",
        b"<script>alert(1)</script>",
        b"../../etc/passwd",
        b"'; DROP TABLE flows;--",
        b"exa mple.com",
        b"-example.com",
        b"example-.com",
        b"example",  # no dot — not a FQDN
        b"." * 10,
        b"a" * 300,
        b"\xff\xfe\xfd",
        b"192.168.1.1\x00",
        b"",
    ],
)
def test_non_hostnames_are_rejected_not_sanitised(hostile):
    obs = parse_frame(tls_frame(hostile))
    assert obs is None


def test_a_recorded_hostname_always_matches_the_strict_pattern():
    """Whatever survives, survives as something that is unambiguously a
    hostname — it ends up in the UI, logs and support conversations."""
    rng = random.Random(4242)
    alphabet = b"abcxyz019-._\x00\r\n<>'\"/\\ "
    for _ in range(1500):
        candidate = bytes(rng.choice(alphabet) for _ in range(rng.randint(1, 40)))
        obs = parse_frame(tls_frame(candidate))
        if obs is not None:
            assert dpi._HOSTNAME_RE.match(obs.hostname.encode())


def test_ip_literal_in_host_header_is_not_recorded_as_a_hostname():
    obs = parse_frame(http_frame(b"GET / HTTP/1.1\r\nHost: 192.168.1.1\r\n\r\n"))
    assert obs is None


# ── 6. HTTP specifics ──────────────────────────────────────────────────────


def test_two_host_headers_make_the_frame_unreadable():
    """Request smuggling starts with a parser that tolerates two Hosts and
    picks one. Refusing is the only safe answer."""
    frame = http_frame(
        b"GET / HTTP/1.1\r\nHost: good.com\r\nHost: evil.com\r\n\r\n"
    )
    assert parse_frame(frame) is None


def test_host_with_userinfo_or_path_is_rejected():
    for value in (b"user@evil.com", b"example.com/path"):
        frame = http_frame(b"GET / HTTP/1.1\r\nHost: " + value + b"\r\n\r\n")
        assert parse_frame(frame) is None


def test_non_http_payload_is_not_treated_as_http():
    assert parse_frame(http_frame(b"SSH-2.0-OpenSSH_9.2\r\n")) is None


def test_body_after_the_header_block_is_never_read():
    frame = http_frame(
        b"POST /x HTTP/1.1\r\nHost: example.com\r\n\r\npassword=hunter2&card=4111111111111111"
    )
    obs = parse_frame(frame)
    assert obs.hostname == "example.com"
    # The observation carries a hostname and nothing else. There is no field
    # a body could occupy even if the parser had read one.
    assert set(vars(obs)) == {"source", "hostname", "protocol"}


# ── 7. Non-TLS, non-HTTP, and absent SNI ───────────────────────────────────


def test_client_hello_without_sni_yields_nothing():
    assert parse_frame(tls_frame(None)) is None


def test_non_hostname_sni_name_type_is_ignored():
    assert parse_frame(tls_frame(b"example.com", name_type=9)) is None


def test_udp_is_ignored():
    assert parse_frame(eth(ipv4(b"\x00" * 20, protocol=17))) is None


def test_non_ip_ethertype_is_ignored():
    assert parse_frame(eth(b"\x00" * 40, ethertype=0x0806)) is None  # ARP


def test_tls_application_data_is_not_parsed():
    """Post-handshake records are encrypted. The module must not pretend to
    read them."""
    record = bytes([0x17, 0x03, 0x03]) + struct.pack("!H", 20) + b"\xde" * 20
    assert parse_frame(eth(ipv4(tcp(record)))) is None


# ── 8. The flow table is bounded ───────────────────────────────────────────


def test_flow_table_counts_repeats():
    table = FlowTable()
    obs = Observation(SRC_V4, "example.com", "tls")
    for _ in range(5):
        table.record(obs, now=1000)
    assert table.snapshot(now=1000)["flows"][0]["count"] == 5


def test_flow_table_is_bounded_and_reports_eviction():
    """An unbounded hostname dict is a memory-exhaustion primitive any device
    on the LAN can drive by resolving random names."""
    table = FlowTable(max_entries=10)
    for i in range(100):
        table.record(Observation(SRC_V4, f"h{i}.example.com", "tls"), now=1000)
    snap = table.snapshot(now=1000)
    assert len(snap["flows"]) == 10
    assert snap["evictions"] == 90


def test_evicting_keeps_the_most_recent():
    table = FlowTable(max_entries=2)
    table.record(Observation(SRC_V4, "old.example.com", "tls"), now=1)
    table.record(Observation(SRC_V4, "mid.example.com", "tls"), now=2)
    table.record(Observation(SRC_V4, "new.example.com", "tls"), now=3)
    names = {f["hostname"] for f in table.snapshot(now=3)["flows"]}
    assert names == {"mid.example.com", "new.example.com"}


def test_entries_expire_from_the_snapshot():
    table = FlowTable(ttl_seconds=60)
    table.record(Observation(SRC_V4, "example.com", "tls"), now=1000)
    assert table.snapshot(now=1000 + 30)["flows"]
    assert table.snapshot(now=1000 + 120)["flows"] == []


def test_snapshot_states_its_own_limits():
    """A customer looking at this list must know it is hostnames only and
    that ECH flows are invisible — otherwise absence reads as safety."""
    note = FlowTable().snapshot()["note"]
    assert "Hostnames only" in note
    assert "Encrypted Client Hello" in note


# ── 9. Capability is honest ────────────────────────────────────────────────


def test_no_cap_net_raw_reports_the_remedy():
    usable, gap = dpi.capability(has_cap_net_raw=lambda: False)
    assert usable is False
    assert "CAP_NET_RAW" in gap
    assert "never run as root" in gap


def test_capability_never_raises():
    def explode():
        raise OSError("no /proc")

    usable, gap = dpi.capability(has_cap_net_raw=explode)
    assert usable is False
    assert "no /proc" in gap


def test_capability_is_true_when_granted():
    assert dpi.capability(has_cap_net_raw=lambda: True) == (True, None)


# ── 10. Structural privacy guards ──────────────────────────────────────────


def test_the_observation_type_has_nowhere_to_put_a_payload():
    obs = Observation(SRC_V4, "example.com", "tls")
    assert set(vars(obs)) == {"source", "hostname", "protocol"}


def test_parser_reads_a_bounded_prefix_only():
    huge = tls_frame(b"example.com") + b"\x00" * 200_000
    assert parse_frame(huge).hostname == "example.com"
    assert dpi._MAX_PARSE_BYTES <= 8192


def test_module_does_not_reach_for_decryption_or_mitm():
    """Checks the CODE, not the prose — the module docstring legitimately
    discusses decryption in order to rule it out."""
    import ast
    import pathlib

    tree = ast.parse(pathlib.Path(dpi.__file__).read_text())

    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    for forbidden in ("ssl", "cryptography", "OpenSSL", "hashlib", "hmac"):
        assert forbidden not in imported

    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    names |= {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    for forbidden in ("x509", "private_key", "decrypt", "wrap_socket"):
        assert forbidden not in names
