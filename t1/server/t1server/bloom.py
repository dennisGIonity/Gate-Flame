"""Bloom filter builder/reader. Byte-for-byte the format in firmware gf_bloom.h.

Exact-match semantics, like Pi-hole gravity on the T3 box. Parent domains are NOT
matched: `ads.example.com` listed does not block `x.ads.example.com`.
"""
from __future__ import annotations

import hashlib
import math
import struct
from dataclasses import dataclass
from typing import Iterable

import numpy as np

MAGIC = b"GFT1BLM\x00"
FORMAT = 1
HEADER = 32
MASK64 = (1 << 64) - 1


def normalise(domain: str) -> str | None:
    d = domain.strip().lower()
    if d.endswith("."):
        d = d[:-1]
    if not d or len(d) > 253:
        return None
    return d


def domain_hash(norm: str) -> tuple[int, int]:
    dig = hashlib.sha256(norm.encode("ascii", "ignore")).digest()
    h1 = int.from_bytes(dig[0:8], "little")
    h2 = int.from_bytes(dig[8:16], "little") | 1
    return h1, h2


def size_for(n: int, fp_rate: float) -> tuple[int, int]:
    """(m bits, k) for n items at the target false-positive rate."""
    n = max(n, 1)
    m = math.ceil(-n * math.log(fp_rate) / (math.log(2) ** 2))
    m = max(64, ((m + 7) // 8) * 8)
    k = max(1, min(32, round(m / n * math.log(2))))
    return m, k


def expected_fp(m: int, k: int, n: int) -> float:
    return (1 - math.exp(-k * n / m)) ** k


@dataclass
class BuiltFilter:
    blob: bytes
    m: int
    k: int
    n: int
    version: int
    level: str
    fp_rate: float
    keys: np.ndarray  # sorted uint64 h1 of every inserted domain, for exact checks


def build(domains: Iterable[str], level: str, version: int, fp_rate: float = 0.001) -> BuiltFilter:
    norm = sorted({d for d in (normalise(x) for x in domains) if d})
    n = len(norm)
    m, k = size_for(n, fp_rate)
    sha = hashlib.sha256
    raw = b"".join(sha(d.encode("ascii", "ignore")).digest()[:16] for d in norm)
    pairs = np.frombuffer(raw, dtype="<u8").reshape(-1, 2) if n else np.zeros((0, 2), dtype="<u8")
    h1 = pairs[:, 0].astype(np.uint64)
    h2 = pairs[:, 1].astype(np.uint64) | np.uint64(1)
    bits = np.zeros(m, dtype=np.bool_)
    mm = np.uint64(m)
    with np.errstate(over="ignore"):
        for i in range(k):
            idx = (h1 + np.uint64(i) * h2) % mm   # uint64 wraps mod 2^64, as in C
            bits[idx] = True
    packed = np.packbits(bits, bitorder="little").tobytes()
    header = MAGIC + struct.pack("<HBBIII", FORMAT, k, 0, m, n, version) + level.encode()[:8].ljust(8, b"\x00")
    assert len(header) == HEADER
    return BuiltFilter(header + packed, m, k, n, version, level, expected_fp(m, k, n), np.sort(h1))


class Filter:
    """Reader - used by the server's domain checker and by the tests."""

    def __init__(self, blob: bytes):
        if blob[:8] != MAGIC:
            raise ValueError("bad magic")
        fmt, k, _r, m, n, version = struct.unpack_from("<HBBIII", blob, 8)
        if fmt != FORMAT or len(blob) != HEADER + (m + 7) // 8:
            raise ValueError("bad header or size")
        self.k, self.m, self.n, self.version = k, m, n, version
        self.level = blob[24:32].rstrip(b"\x00").decode()
        self.bits = blob[HEADER:]

    def contains(self, domain: str) -> bool:
        d = normalise(domain)
        if d is None:
            return False
        h1, h2 = domain_hash(d)
        for i in range(self.k):
            idx = ((h1 + i * h2) & MASK64) % self.m
            if not self.bits[idx >> 3] & (1 << (idx & 7)):
                return False
        return True
