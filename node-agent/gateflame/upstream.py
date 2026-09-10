"""DNS upstream selection: the box's own recursion (default) or Cloudflare.

WHAT THE OWNER IS CHOOSING

Where clean lookups go AFTER Pi-hole has filtered them.

    recursive           unbound in the stack walks from the root servers.
                        No third party sees the household's queries. DEFAULT,
                        and ADR-001's privacy posture. Unchanged.
    cloudflare          1.1.1.1 / 1.0.0.1. Fastest cold lookups; Cloudflare
                        sees the queries.
    cloudflare-malware  1.1.1.2 / 1.0.0.2. Cloudflare also refuses known
                        malware domains - a second, independent filter behind
                        Pi-hole's.
    cloudflare-family   1.1.1.3 / 1.0.0.3. Malware + adult content refused
                        upstream, for households that want belt and braces
                        with the "family" profile.

Ionity is a Cloudflare shop, so offering their resolvers is the obvious
option. It is an OPTION. The default stays recursive because the product's
privacy promise (docs/PRIVACY-NOTICE.md §3) is written against it, and a
customer who switches is told, in the payload and on the screen, exactly who
now sees their lookups.

HOW IT IS APPLIED

Through Pi-hole's own v6 config API (`PATCH /api/config`, key
`dns.upstreams`) - the same field the compose file seeds with
`172.28.0.10#53`. Nothing here edits a file, restarts a container or touches
unbound: unbound keeps running so switching back is instant and cannot fail
for want of a cold cache.

READ-BACK IS THE RESULT. `apply()` does not return "saved" because the PATCH
returned 200. It re-reads `dns.upstreams`, checks it equals what was asked
for, and then resolves a known-good name through the box to prove the new
upstream actually answers. Only then is the mode reported. A router that said
"saved" and had not was what cost this household days (CLAUDE.md).

ENCRYPTION, HONESTLY

Pi-hole forwards over plain port-53 UDP/TCP. It does not speak DNS-over-TLS,
so the Cloudflare modes here are NOT encrypted on the wire between the box and
1.1.1.1. The payload says so (`encrypted: false`) and the UI must show it. DoT
would need a forwarding unbound instance with `forward-tls-upstream`, which
means a config mount into the distroless klutchell/unbound container and a
restart path with rollback - a deliberate, tested change, not a flag flip.
Tracked as a follow-up in docs/gateflame-STATE-resume-here.md.
"""

from __future__ import annotations

import socket
import threading
import time
from dataclasses import dataclass

from . import datadir, pihole

UPSTREAM_KEY = "dns.upstreams"

# The recursive resolver's address is the compose network's unbound. Kept as
# the ONE literal the default mode resolves to; if the stack ever moves unbound
# the compose file and this constant change together.
UNBOUND_UPSTREAM = "172.28.0.10#53"


@dataclass(frozen=True)
class Mode:
    id: str
    label: str
    description: str
    upstreams: tuple[str, ...]
    operator: str
    encrypted: bool
    filters: tuple[str, ...]


MODES: dict[str, Mode] = {
    "recursive": Mode(
        id="recursive",
        label="Gate^Flame recursion (default)",
        description="The box resolves from the DNS root servers itself. Nobody outside "
        "this house sees the lookups.",
        upstreams=(UNBOUND_UPSTREAM,),
        operator="This box",
        encrypted=False,
        filters=(),
    ),
    "cloudflare": Mode(
        id="cloudflare",
        label="Cloudflare 1.1.1.1",
        description="Clean lookups are forwarded to Cloudflare. Faster cold lookups; "
        "Cloudflare sees the queries this box sends.",
        upstreams=("1.1.1.1#53", "1.0.0.1#53"),
        operator="Cloudflare",
        encrypted=False,
        filters=(),
    ),
    "cloudflare-malware": Mode(
        id="cloudflare-malware",
        label="Cloudflare 1.1.1.2 (malware blocking)",
        description="As Cloudflare, and Cloudflare also refuses known malware domains - "
        "a second filter behind this box's own.",
        upstreams=("1.1.1.2#53", "1.0.0.2#53"),
        operator="Cloudflare",
        encrypted=False,
        filters=("malware",),
    ),
    "cloudflare-family": Mode(
        id="cloudflare-family",
        label="Cloudflare 1.1.1.3 (malware + adult)",
        description="As Cloudflare, with malware and adult content refused upstream as well.",
        upstreams=("1.1.1.3#53", "1.0.0.3#53"),
        operator="Cloudflare",
        encrypted=False,
        filters=("malware", "adult"),
    ),
}

DEFAULT_MODE = "recursive"

# A name every mode must be able to resolve for the read-back to count. The
# product's own domain: it is not on any blocklist, it is not adult, it is not
# malware, and if it does not resolve the box is not working.
_PROBE_NAME = "www.ionity.today"

_lock = threading.Lock()
_last: dict = {"mode": None, "checkedAt": None, "error": None}


def valid(mode_id: str) -> bool:
    return mode_id in MODES


def match(upstreams: list[str] | None) -> str | None:
    """Which mode a Pi-hole upstream list corresponds to; None if none does."""
    if not upstreams:
        return None
    got = sorted(u.strip() for u in upstreams if isinstance(u, str))
    for m in MODES.values():
        if sorted(m.upstreams) == got:
            return m.id
    return None


def read_current() -> list[str] | None:
    """Pi-hole's live `dns.upstreams`, or None when Pi-hole is unreachable.

    None is NOT "recursive". Undetermined is not a mode - see CLAUDE.md on
    `gateway_forwards_to_us is None`.
    """
    data = pihole.api_get(f"/api/config/{UPSTREAM_KEY}")
    if not isinstance(data, dict):
        return None
    cfg = data.get("config") or {}
    dns = cfg.get("dns") or {}
    ups = dns.get("upstreams")
    if isinstance(ups, list):
        return [str(u) for u in ups]
    return None


def _resolve_through_box(name: str, timeout: float = 4.0) -> bool:
    """Does a lookup through the local resolver come back? Loopback only
    proves the local half; the LAN address is checked by netcheck. Here we are
    proving the UPSTREAM answers, for which loopback is the right vantage."""
    try:
        socket.setdefaulttimeout(timeout)
        socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)
        return True
    except (socket.gaierror, socket.timeout, OSError):
        return False
    finally:
        socket.setdefaulttimeout(None)


def describe() -> dict:
    """Current mode plus the catalogue. Never raises.

    `mode` is derived from Pi-hole's live setting, not from a stored choice,
    so a hand edit in the Pi-hole admin page shows up here as `custom` with
    the raw list, rather than this API lying that recursion is on.
    """
    current = read_current()
    mode_id = match(current)
    reachable = current is not None
    return {
        "reachable": reachable,
        "mode": mode_id if mode_id else ("custom" if reachable else None),
        "upstreams": current,
        "default": DEFAULT_MODE,
        "encrypted": MODES[mode_id].encrypted if mode_id else None,
        "operator": MODES[mode_id].operator if mode_id else None,
        "modes": [
            {
                "id": m.id,
                "label": m.label,
                "description": m.description,
                "upstreams": list(m.upstreams),
                "operator": m.operator,
                "encrypted": m.encrypted,
                "filters": list(m.filters),
                "isDefault": m.id == DEFAULT_MODE,
            }
            for m in MODES.values()
        ],
        "lastApply": dict(_last),
        # Said in the payload so no UI can leave it out.
        "notice": (
            "Modes other than the default forward clean lookups to a third party over "
            "plain DNS (not encrypted). The default keeps every lookup on this box."
        ),
    }


def apply(mode_id: str, applied_by: str | None = None) -> dict:
    """Set Pi-hole's upstreams to `mode_id` and PROVE it. Returns describe()
    plus an `applied` block. Raises ValueError for an unknown mode; every other
    failure is reported in `applied.ok`/`applied.error`, never raised, because
    the UI has to render the failure, not a stack trace."""
    if not valid(mode_id):
        raise ValueError(f"unknown upstream mode {mode_id!r}")
    mode = MODES[mode_id]

    with _lock:
        before = read_current()
        result: dict = {
            "requested": mode_id,
            "before": before,
            "ok": False,
            "readBack": None,
            "resolves": None,
            "error": None,
            "appliedBy": applied_by,
            "at": time.time(),
        }

        if before is None:
            result["error"] = "Pi-hole is not reachable; nothing was changed."
            _last.update(mode=None, checkedAt=result["at"], error=result["error"])
            _log(result)
            return {**describe(), "applied": result}

        patched = pihole.api_patch("/api/config", {"config": {"dns": {"upstreams": list(mode.upstreams)}}})
        if patched is None:
            result["error"] = "Pi-hole refused the change (PATCH /api/config failed)."
            _last.update(mode=match(before), checkedAt=result["at"], error=result["error"])
            _log(result)
            return {**describe(), "applied": result}

        after = read_current()
        result["readBack"] = after
        if match(after) != mode_id:
            result["error"] = (
                f"Pi-hole reported saved, but read-back shows {after!r}, not {list(mode.upstreams)!r}."
            )
            _last.update(mode=match(after), checkedAt=result["at"], error=result["error"])
            _log(result)
            return {**describe(), "applied": result}

        # Give FTL a moment to pick the new forwarders up, then prove they answer.
        time.sleep(0.5)
        resolves = _resolve_through_box(_PROBE_NAME)
        result["resolves"] = resolves
        if not resolves:
            # Roll back. A box whose upstream cannot resolve is a box with no
            # internet, and we know the previous list worked a second ago.
            pihole.api_patch("/api/config", {"config": {"dns": {"upstreams": before}}})
            result["error"] = (
                f"{_PROBE_NAME} did not resolve through the new upstream; reverted to the previous setting."
            )
            result["readBack"] = read_current()
            _last.update(mode=match(result["readBack"]), checkedAt=result["at"], error=result["error"])
            _log(result)
            return {**describe(), "applied": result}

        result["ok"] = True
        _last.update(mode=mode_id, checkedAt=result["at"], error=None)
        _log(result)
        return {**describe(), "applied": result}


def _log(result: dict) -> None:
    """Append one line to .DUMP/logs/upstream.log. Best effort."""
    try:
        import json
        import os

        p = datadir.path("logs", "upstream.log")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(result, sort_keys=True) + "\n")
    except OSError:
        pass
