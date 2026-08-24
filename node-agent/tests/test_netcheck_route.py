"""The netcheck route, and the honesty contract it has to keep.

Ionibot renders this payload instead of deriving its own view of whether the
household is protected. That only works if the box refuses to invent a result,
so most of these tests are about what happens when the check CANNOT run.

Nothing here needs bash, a network, or a Pi — the subprocess runner is injected.
"""

from __future__ import annotations

import json
import subprocess

import pytest

from gateflame.netcheck import NetcheckRunner

# The real script's --json output, trimmed. Shape is pinned against
# src/ionibot/types.ts::NetcheckPayload — if these disagree, the phone silently
# stops being able to read the box.
REAL_PAYLOAD = {
    "fails": 1,
    "warns": 1,
    "lan_ip": "192.168.0.10",
    "gateway": "192.168.0.1",
    "results": [
        {"status": "PASS", "check": "addr", "message": "this box is at 192.168.0.10"},
        {"status": "FAIL", "check": "router", "message": "the router is not forwarding to us"},
        {"status": "WARN", "check": "ipv6", "message": "router advertises IPv6 it cannot route"},
        {"status": "PASS", "check": "lanlistener", "message": "port 53 answers on the LAN address"},
    ],
}


def _ok(payload=None, code=0):
    """A runner that returns the given payload on stdout."""
    body = json.dumps(REAL_PAYLOAD if payload is None else payload)
    return lambda argv: (code, body, "")


@pytest.fixture
def script(tmp_path):
    """A file that exists, so the is_file() guard passes. Never executed."""
    p = tmp_path / "gateflame-netcheck.sh"
    p.write_text("#!/usr/bin/env bash\n")
    return str(p)


# ------------------------------------------------------------------ happy path


def test_returns_the_scripts_payload_verbatim(script):
    run = NetcheckRunner(script_path=script, runner=_ok(), bash="/bin/bash")
    assert run.run() == REAL_PAYLOAD


def test_exit_code_1_is_a_report_with_failures_not_an_error(script):
    """The script documents exit 1 as "at least one FAIL".

    Treating that as a malfunction would hide exactly the reports worth reading:
    a box WITH problems is the case this endpoint exists for. This is the single
    easiest mistake to make here, so it gets its own test.
    """
    run = NetcheckRunner(script_path=script, runner=_ok(code=1), bash="/bin/bash")
    out = run.run()
    assert out == REAL_PAYLOAD
    assert "gap" not in out


def test_passes_the_json_flag(script):
    seen = {}

    def capture(argv):
        seen["argv"] = argv
        return 0, json.dumps(REAL_PAYLOAD), ""

    NetcheckRunner(script_path=script, runner=capture, bash="/bin/bash").run()
    assert seen["argv"] == ["/bin/bash", script, "--json"]


# --------------------------------------------------------- the honesty contract


def _assert_named_gap(out):
    """Every failure path must be distinguishable from a healthy box."""
    assert out["gap"], "a failure must carry a named reason"
    assert out["remedy"], "a named reason without a remedy is just a complaint"
    # Not zero. A zero fail count IS a clean bill of health, and claiming one
    # from a check that did not run is the lie this module exists to avoid.
    assert out["fails"] is None
    assert out["warns"] is None
    # Present but empty, so Ionibot's Array.isArray(results) guard keeps the
    # payload and the customer gets to see the reason.
    assert out["results"] == []


def test_missing_script_is_a_named_gap(tmp_path):
    out = NetcheckRunner(script_path=str(tmp_path / "nope.sh"), bash="/bin/bash").run()
    _assert_named_gap(out)
    assert "not installed" in out["gap"]


def test_missing_bash_is_a_named_gap(script):
    run = NetcheckRunner(script_path=script, runner=_ok(), bash=None)
    run._find_bash = lambda: None  # noqa: SLF001 - exercising the no-bash box
    out = run.run()
    _assert_named_gap(out)
    assert "bash" in out["gap"]


def test_a_hanging_check_times_out_into_a_gap(script):
    def hang(argv):
        raise subprocess.TimeoutExpired(cmd=argv, timeout=25)

    out = NetcheckRunner(script_path=script, runner=hang, bash="/bin/bash").run()
    _assert_named_gap(out)
    assert "did not finish" in out["gap"]


def test_unstartable_script_is_a_gap_not_a_crash(script):
    def boom(argv):
        raise OSError("Exec format error")

    out = NetcheckRunner(script_path=script, runner=boom, bash="/bin/bash").run()
    _assert_named_gap(out)


def test_unexpected_exit_code_is_a_gap(script):
    run = NetcheckRunner(
        script_path=script,
        runner=lambda argv: (127, "", "bash: command not found"),
        bash="/bin/bash",
    )
    out = run.run()
    _assert_named_gap(out)
    assert "127" in out["gap"]


def test_unparseable_output_is_a_gap(script):
    run = NetcheckRunner(
        script_path=script,
        runner=lambda argv: (0, "this is not json", ""),
        bash="/bin/bash",
    )
    _assert_named_gap(run.run())


def test_json_that_is_not_a_report_is_a_gap(script):
    """`{}` parses fine and would read to the client as a box with no failures.

    This is the subtle one: valid JSON of the wrong shape is more dangerous than
    garbage, because garbage fails loudly and `{}` looks like good news.
    """
    for junk in ({}, [], {"results": "not a list"}, "a string"):
        run = NetcheckRunner(
            script_path=script,
            runner=lambda argv, j=junk: (0, json.dumps(j), ""),
            bash="/bin/bash",
        )
        _assert_named_gap(run.run())


def test_run_never_raises(script):
    """The route has no try/except of its own, by design — this is why."""

    def nasty(argv):
        raise OSError("anything at all")

    NetcheckRunner(script_path=script, runner=nasty, bash="/bin/bash").run()
