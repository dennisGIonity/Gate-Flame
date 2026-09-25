"""Blocklist sources and parsing.

SINGLE SOURCE OF TRUTH: the list URLs and the level descriptions are read from the
T3 node agent's own `node-agent/gateflame/threat_level.py`, so "low / medium / high"
means the same lists on every tier and the dashboard can only ever display what the
filter actually contains (CLAUDE.md: "We display what it SAYS it blocks").
"""
from __future__ import annotations

import importlib.util
import re

from .config import REPO_ROOT

_TL_PATH = REPO_ROOT / "node-agent" / "gateflame" / "threat_level.py"
_spec = importlib.util.spec_from_file_location("gf_threat_level", _TL_PATH)
threat_level = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(threat_level)  # pure module: no I/O, no deps

_DOMAIN = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$")
_SINK = {"0.0.0.0", "127.0.0.1", "::", "::1", "0", "::0", "255.255.255.255", "fe80::1%lo0"}
_JUNK = {"localhost", "localhost.localdomain", "local", "broadcasthost", "ip6-localhost",
         "ip6-loopback", "ip6-localnet", "ip6-mcastprefix", "ip6-allnodes", "ip6-allrouters",
         "ip6-allhosts", "0.0.0.0"}


def sources(level: str) -> list[str]:
    return list(threat_level.lists_for(level))


def all_sources() -> list[str]:
    return sources("high")  # cumulative: high includes every list


def describe(level: str) -> str:
    return threat_level.describe(level)["description"]


def parse(text: str) -> set[str]:
    """hosts files, plain domain lists and ABP `||domain^` lines."""
    out: set[str] = set()
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip().lower()
        if not line or line.startswith("!") or line.startswith("["):
            continue
        if line.startswith("||"):
            line = line[2:].split("^", 1)[0]
            cands = [line]
        else:
            toks = line.split()
            cands = toks[1:] if len(toks) >= 2 and toks[0] in _SINK else toks[:1]
        for d in cands:
            d = d.rstrip(".")
            if d not in _JUNK and _DOMAIN.match(d):
                out.add(d)
    return out
