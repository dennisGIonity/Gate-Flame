"""The firmware's pure-C headers (gf_json.h, gf_cache.h, the TCP / TTL / captive parts of gf_dns.h),
compiled on the host with -Wall -Wextra -Werror and run under AddressSanitizer + UBSan when the
compiler has them. 296 checks live in tests/c/host_unit.c; this just builds and runs them."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent


def _cc():
    cc = shutil.which("gcc") or shutil.which("cc")
    if not cc:
        pytest.skip("no C compiler on this machine")
    return cc


def _build(tmp_path, *flags):
    out = tmp_path / "host_unit"
    r = subprocess.run([_cc(), "-O1", "-g", "-Wall", "-Wextra", "-Werror", *flags, "-o", str(out),
                        str(HERE / "c" / "host_unit.c")], capture_output=True, text=True)
    return r, out


def test_pure_c_headers_pass_their_unit_tests(tmp_path):
    r, out = _build(tmp_path)
    assert r.returncode == 0, r.stderr
    run = subprocess.run([str(out)], capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    assert " 0 failed" in run.stdout


def test_and_clean_under_address_and_undefined_behaviour_sanitizers(tmp_path):
    r, out = _build(tmp_path, "-fsanitize=address,undefined", "-fno-sanitize-recover=all")
    if r.returncode != 0 and ("sanitize" in r.stderr or "asan" in r.stderr.lower() or "libasan" in r.stderr):
        pytest.skip("this compiler has no sanitizer runtime")
    assert r.returncode == 0, r.stderr
    run = subprocess.run([str(out)], capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
