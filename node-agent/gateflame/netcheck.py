"""Expose gateflame-netcheck.sh --json over the API.

This is a ROUTE, NOT A FEATURE. The script already exists, already has a
`--json` mode, and already produces exactly the shape Ionibot renders
(`src/ionibot/types.ts::NetcheckPayload`). Nothing here re-derives a check.

WHY RENDERING THE BOX'S OWN ANSWER MATTERS
Ionibot deliberately does not compute its own view of whether the household is
protected. If the phone and the box could disagree, the customer would have no
way to tell which one was lying. So the phone asks the box, and the box answers
with the same script an engineer would run over SSH.

HONESTY CONTRACT
Every failure path here returns a NAMED GAP and never a fabricated result. There
is no "assume it passed" branch, because a clean bill of health from a check that
did not run is worse than no check at all — the customer stops looking.

`listenerFromNetcheck()` on the client turns a missing `lanlistener` entry into
`unknown`, and `resolveState` is written so `unknown` never becomes the
"your phone is bypassing the box" screen. That chain only holds if this module
refuses to invent a result, so it does.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

# The script lives beside the package on the Pi (/home/wabapi/node-agent/), not
# inside it. Overridable because the deployed layout and the repo layout differ,
# and a hardcoded path is how this ends up working only on one machine.
DEFAULT_SCRIPT = str(Path(__file__).resolve().parent.parent / "gateflame-netcheck.sh")

# The script makes real network calls (DNS queries with timeouts, a router probe).
# Its own per-check timeouts bound it well under this; this is the backstop that
# stops a wedged check holding an API worker open forever.
TIMEOUT_SECONDS = 25


class NetcheckRunner:
    """Runs the network-shape check and parses its JSON.

    Injectable `runner` so the whole thing is testable with no bash, no network
    and no Pi — the same seam discipline as firewall.py and wan.py.
    """

    def __init__(self, script_path: str | None = None, runner=None, bash: str | None = None):
        self._script = script_path or os.environ.get("GATEFLAME_NETCHECK_SH", DEFAULT_SCRIPT)
        self._runner = runner or self._run_subprocess
        self._bash = bash

    # ---------------------------------------------------------------- helpers

    def _find_bash(self) -> str | None:
        if self._bash:
            return self._bash
        return shutil.which("bash")

    def _run_subprocess(self, argv: list[str]) -> tuple[int, str, str]:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
        return proc.returncode, proc.stdout, proc.stderr

    @staticmethod
    def _gap(reason: str, remedy: str) -> dict:
        """A gap, shaped so the client cannot mistake it for a result.

        `results` is an EMPTY LIST rather than absent: Ionibot's probe checks
        `Array.isArray(json.results)` and would discard a payload without it,
        losing the reason. An empty list plus a named gap survives the trip and
        still yields `listener: 'unknown'`, which is the honest answer.
        """
        return {
            "fails": None,
            "warns": None,
            "lan_ip": None,
            "gateway": None,
            "results": [],
            "gap": reason,
            "remedy": remedy,
        }

    # ------------------------------------------------------------------- run

    def run(self) -> dict:
        """Return the netcheck payload, or a payload carrying a named gap.

        Never raises. A diagnostic endpoint that 500s tells the customer's phone
        nothing except that something went wrong, and Ionibot would render the
        same 'could not read' either way — so we spend the response body on
        saying WHICH thing went wrong instead.
        """
        if not Path(self._script).is_file():
            return self._gap(
                f"the network check script is not installed at {self._script}",
                "deploy gateflame-netcheck.sh next to the agent, or set GATEFLAME_NETCHECK_SH",
            )

        bash = self._find_bash()
        if not bash:
            return self._gap(
                "bash is not available on this box, so the network check cannot run",
                "install bash (the check is a bash script, not POSIX sh)",
            )

        try:
            code, out, err = self._runner([bash, self._script, "--json"])
        except subprocess.TimeoutExpired:
            return self._gap(
                f"the network check did not finish within {TIMEOUT_SECONDS} seconds",
                "run `bash gateflame-netcheck.sh` on the box to see which check is hanging",
            )
        except OSError as exc:
            return self._gap(
                f"the network check could not be started: {exc}",
                "check the script is readable and bash is executable",
            )

        # EXIT CODE 1 MEANS "AT LEAST ONE FAIL", NOT "THE SCRIPT BROKE".
        # Treating it as an error would hide exactly the reports worth reading —
        # a box with problems is the case this endpoint exists for. Only a code
        # the script does not document is treated as a malfunction.
        if code not in (0, 1):
            detail = (err or out or "").strip()[:200]
            return self._gap(
                f"the network check exited with an unexpected code {code}: {detail}",
                "run `bash gateflame-netcheck.sh --json` on the box and read stderr",
            )

        try:
            payload = json.loads(out)
        except (json.JSONDecodeError, TypeError):
            return self._gap(
                "the network check ran but did not return readable output",
                "run `bash gateflame-netcheck.sh --json` on the box and check for stray output",
            )

        # Shape guard. Something that parses as JSON but is not a report must not
        # be forwarded — the client would treat a bare `{}` as a report with no
        # failures, which reads as a healthy box.
        if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
            return self._gap(
                "the network check returned JSON that is not a report",
                "the script's --json output has changed shape; check it against src/ionibot/types.ts",
            )

        return payload
