"""Node 1.1.0 review fixes that are not about Pi-hole: hardware portability,
versioning, and three places where "could not look" read as "nothing there".
"""

from __future__ import annotations

import re
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from gateflame import main, services, telemetry
from gateflame.firewall import Firewall
from gateflame.netcheck import NetcheckRunner

AGENT_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = AGENT_ROOT.parent


# ------------------------------------------------------- thermal zones (A733)


def _zone(root: Path, n: int, ztype: str, millideg: str) -> None:
    z = root / f"thermal_zone{n}"
    z.mkdir(parents=True)
    (z / "type").write_text(ztype + "\n")
    (z / "temp").write_text(millideg + "\n")


def test_the_cpu_zone_is_chosen_by_type_not_by_number(tmp_path):
    """On Allwinner boards zone 0 is not guaranteed to be the CPU. The old reader
    took thermal_zone0 on faith and would report the GPU (or DDR) as the CPU."""
    _zone(tmp_path, 0, "gpu_thermal_zone", "38000")
    _zone(tmp_path, 1, "ddr_thermal_zone", "35000")
    _zone(tmp_path, 2, "cpul_thermal_zone", "52300")
    chosen = telemetry._resolve_zone(str(tmp_path))
    assert chosen.endswith("thermal_zone2/temp")
    assert telemetry._read_zone(chosen) == 52.3


def test_the_pi5_zone_zero_is_still_found(tmp_path):
    _zone(tmp_path, 0, "cpu-thermal", "48150")
    assert telemetry._resolve_zone(str(tmp_path)).endswith("thermal_zone0/temp")


def test_an_untyped_board_falls_back_to_the_first_readable_zone(tmp_path):
    _zone(tmp_path, 0, "", "not a number")
    _zone(tmp_path, 1, "", "41000")
    assert telemetry._resolve_zone(str(tmp_path)).endswith("thermal_zone1/temp")


def test_zones_sort_numerically_not_lexically(tmp_path):
    for n in (2, 10, 1):
        _zone(tmp_path, n, "", f"{40 + n}000")
    assert telemetry._resolve_zone(str(tmp_path)).endswith("thermal_zone1/temp")


def test_an_implausible_reading_is_not_a_temperature(tmp_path):
    _zone(tmp_path, 0, "cpu-thermal", "999999")      # 999.999 C: a stub, not a sensor
    assert telemetry._resolve_zone(str(tmp_path)) is None


def test_a_board_without_vcgencmd_says_why_throttle_is_null(monkeypatch):
    monkeypatch.setattr(telemetry.shutil, "which", lambda name: None)
    snap = telemetry.host_snapshot()
    assert snap["throttleFlags"] is None
    assert "Raspberry Pi" in snap["throttleGap"]


# ---------------------------------------------------------------- versioning


def test_the_default_agent_version_is_the_release_not_0_1_0():
    out = subprocess.run(
        [sys.executable, "-c", "from gateflame.config import Config; print(Config().agent_version)"],
        cwd=AGENT_ROOT, env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True, timeout=60,
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "1.1.0"


def _version_regex(script: Path) -> str:
    text = script.read_text(encoding="utf-8")
    m = re.search(r"grep -Em1 '([^']+)'", text)
    assert m, f"no version filter in {script.name}"
    return m.group(1)


@pytest.mark.parametrize("script", ["tools/install-pi-release.sh", "node-agent/install.sh",
                                    "node-agent/install-all.sh"])
def test_installers_take_only_a_version_line_from_VERSION(script, tmp_path):
    """The 1.0.2 banner: '(# VERSION_NAME  human-facing semver ...\\n1.0.2+10b3bda)'."""
    garbage = tmp_path / "VERSION"
    garbage.write_text("# VERSION_NAME  human-facing semver shown in app settings and on the store.\r\n"
                       "1.0.2+10b3bda\r\n")
    pattern = _version_regex(REPO_ROOT / script)
    out = subprocess.run(["bash", "-c", f"tr -d '\\r' < {garbage} | grep -Em1 '{pattern}'"],
                         capture_output=True, text=True, timeout=30)
    assert out.stdout.strip() == "1.0.2+10b3bda"
    (tmp_path / "VERSION").write_text("# only a comment\n")
    out = subprocess.run(["bash", "-c", f"tr -d '\\r' < {garbage} | grep -Em1 '{pattern}'"],
                         capture_output=True, text=True, timeout=30)
    assert out.stdout.strip() == ""


def test_package_release_reads_the_assignment_not_the_comment(tmp_path):
    props = tmp_path / "version.properties"
    props.write_text("# VERSION_NAME  human-facing semver shown in app settings and on the store.\n"
                     "VERSION_CODE=16\nVERSION_NAME=1.1.0\r\n")
    text = (REPO_ROOT / "tools/package-release.sh").read_text(encoding="utf-8")
    m = re.search(r"NAME=\"\$\(awk -F= '([^']+)' android/version.properties\)\"", text)
    assert m, "package-release.sh no longer derives NAME with the anchored awk"
    out = subprocess.run(["awk", "-F=", m.group(1), str(props)], capture_output=True, text=True, timeout=30)
    assert out.stdout.strip() == "1.1.0"


# --------------------------------------------- read-back probes real routes


def _app_paths() -> set[str]:
    return {getattr(r, "path", "") for r in main.app.routes}


def test_every_route_the_release_readback_probes_exists():
    """1.0.3 probed /filtering/state, /threats/summary and /network/devices - none
    of which ever existed - and printed their 404s as results."""
    text = (REPO_ROOT / "tools/install-pi-release.sh").read_text(encoding="utf-8")
    block = re.search(r'ROUTES="([^"]+)"', text)
    assert block, "no ROUTES list in install-pi-release.sh"
    routes = block.group(1).split()
    assert len(routes) >= 20
    paths = _app_paths()
    missing = [r for r in routes if "/api/v1/" + r.split("?")[0] not in paths]
    assert missing == [], f"read-back probes routes the agent does not serve: {missing}"
    for new in ("dns/history?window=24h", "history/system?window=24h"):
        assert new in routes


# ------------------------------------------ "could not look" vs "nothing there"


class _NoNft:
    available = False

    def run(self, args, stdin_text=None):  # pragma: no cover - never reached
        raise AssertionError("must not run nft when it is unavailable")


def test_bounced_names_the_gap_when_nft_cannot_be_driven():
    report = Firewall(runner=_NoNft(), context_provider=lambda: None).bounced_report()
    assert report["bounced"] == [] and "nft" in report["gap"]


def test_reading_the_bounce_list_never_installs_a_ruleset():
    calls: list = []

    class Nft:
        available = True

        def run(self, args, stdin_text=None):
            calls.append(list(args))
            return subprocess.CompletedProcess(args, 0, stdout='{"nftables": []}', stderr="")

    report = Firewall(runner=Nft(), context_provider=lambda: None).bounced_report()
    assert report == {"bounced": [], "gap": None}
    assert ["-f", "-"] not in calls, "a GET must not add a table to the kernel"


def test_dpi_is_not_implemented_rather_than_running_on_nothing(monkeypatch):
    """No capture loop exists; with CAP_NET_RAW the module used to go `running`."""
    status = services.module_status("module_dpi_flow")
    assert status["status"] == "not_implemented"
    assert "capture loop" in status["gap"]
    assert services.start_module("module_dpi_flow").ok is False


def test_flows_route_says_nothing_is_capturing():
    c = TestClient(main.app, client=("127.0.0.1", 51000))
    body = c.get("/api/v1/flows/recent").json()
    assert body["flows"] == [] and body["capturing"] is False and body["gap"]


# ---------------------------------------------------------- netcheck coalescing


def test_concurrent_netchecks_share_one_run(tmp_path):
    script = tmp_path / "gateflame-netcheck.sh"
    script.write_text("#!/bin/bash\n")
    started = threading.Event()
    release = threading.Event()
    runs: list = []

    def runner(argv):
        runs.append(argv)
        started.set()
        release.wait(5)
        return 0, '{"fails": 0, "warns": 0, "results": []}', ""

    nc = NetcheckRunner(script_path=str(script), runner=runner, bash="/bin/bash")
    results: list = []
    first = threading.Thread(target=lambda: results.append(nc.run()))
    first.start()
    assert started.wait(5)
    others = [threading.Thread(target=lambda: results.append(nc.run())) for _ in range(4)]
    for t in others:
        t.start()
    release.set()
    for t in [first, *others]:
        t.join(10)
    assert len(runs) == 1, "callers arriving mid-run must share it, not start their own"
    assert len(results) == 5 and all(r["results"] == [] for r in results)
    # ...and nothing is cached afterwards: the next call runs again.
    nc.run()
    assert len(runs) == 2


# ------------------------------------------------------------ import hygiene


def test_new_modules_have_no_import_side_effects(tmp_path):
    """Importing must not create the data root or open SQLite (same rule as main.py)."""
    root = tmp_path / "never-created"
    out = subprocess.run(
        [sys.executable, "-c",
         "import gateflame.system_history, gateflame.dns_history, gateflame.dnsprobe, gateflame.ttlcache"],
        cwd=AGENT_ROOT, env={"PATH": "/usr/bin:/bin", "GATEFLAME_DATA_ROOT": str(root)},
        capture_output=True, text=True, timeout=60,
    )
    assert out.returncode == 0, out.stderr
    assert not root.exists()
