"""Gate^Flame Shield - per-device VPN, one region at a time, either edition.

WHY THIS IS SHAPED THE WAY IT IS

Standard is a side-car (ADR-001): household traffic never passes through the
box, so nothing it does can slow the connection or become a single point of
failure during load shedding. A VPN that "just routes some devices through
the box" would make the box their gateway for that traffic - exactly the
thing the standard tier's whole design promises never to become.

The way out: the box never carries a single packet of tunnelled traffic. It
only ISSUES a WireGuard peer configuration for a phone or laptop and tells it
which region to use - the tunnel itself runs ON that device, straight to a
regional exit server, with nothing routed via the Gate^Flame box in between.
That is true on both editions; premium's extra headroom buys nothing here,
because there is nothing for the box to forward. "Per device, per region,
toggleable" falls out of this for free: each device is just another peer,
and each peer picks its own region independently.

WHAT'S REAL HERE TODAY AND WHAT ISN'T

This module talks to a self-hosted Headscale server (open source, MIT -
https://github.com/juanfont/headscale) over its HTTP API. Headscale is the
control plane only: it hands out peer configs and knows which tagged "exit
node" machine sits in which country. The actual exit nodes - real servers
with real public IPs in the UK, US, wherever - are NOT something this module
or this repo can stand up. That's real infrastructure in real countries,
under Ionity's own account and budget, one small VPS per region. Until at
least one exists and is registered with Headscale as an exit node tagged
`region:<code>`, list_regions() below returns an empty list honestly rather
than inventing entries - the same "never claim what hasn't been verified"
rule blocklists.py and health_feed.py already hold to.

No Headscale, WireGuard, or Tailscale name or logo reaches the phone. The
customer-facing name is GATEFLAME_SHIELD_LABEL below - change the one
constant, not the module - and every string the mobile screen shows is
written as a native Gate^Flame capability. See docs/VPN-SHIELD-DESIGN.md for
the full design and infra/headscale/ for how to stand the control plane up
and add a region.
"""

from __future__ import annotations

import threading

import httpx

from .config import config

_TIMEOUT = 15.0

# The one place this feature's customer-facing name lives. Change this
# constant to relabel the whole feature everywhere it appears in API
# responses; the mobile screen renders whatever this module returns, never a
# hardcoded "Shield" of its own.
GATEFLAME_SHIELD_LABEL = "Gate^Flame Shield"

_lock = threading.Lock()
_applying = False
_last_error: str | None = None


def is_applying() -> bool:
    return _applying


def last_error() -> str | None:
    return _last_error


def _headscale_base() -> str | None:
    """The control plane's own address, or None if not yet configured.

    Deliberately a separate on/off switch from the feature toggle itself -
    a box can have Shield "on" in the owner's settings while no control
    plane has been deployed yet, same as filtering can be "on" with an
    unreachable Pi-hole. The state is distinguishable and each is reported
    honestly rather than folded into a single boolean.
    """
    base = getattr(config, "headscale_url", None)
    return base.rstrip("/") if base else None


def _headscale_key() -> str | None:
    return getattr(config, "headscale_api_key", None)


def _get(path: str) -> dict | list | None:
    base = _headscale_base()
    key = _headscale_key()
    if not base or not key:
        return None
    try:
        r = httpx.get(
            f"{base}{path}",
            headers={"Authorization": f"Bearer {key}"},
            timeout=_TIMEOUT,
        )
        if r.status_code != 200:
            return None
        return r.json()
    except (httpx.HTTPError, ValueError):
        return None


def _post(path: str, payload: dict) -> dict | None:
    base = _headscale_base()
    key = _headscale_key()
    if not base or not key:
        return None
    try:
        r = httpx.post(
            f"{base}{path}",
            headers={"Authorization": f"Bearer {key}"},
            json=payload,
            timeout=_TIMEOUT,
        )
        if r.status_code not in (200, 201):
            return None
        return r.json()
    except (httpx.HTTPError, ValueError):
        return None


def _delete(path: str) -> bool:
    base = _headscale_base()
    key = _headscale_key()
    if not base or not key:
        return False
    try:
        r = httpx.delete(
            f"{base}{path}",
            headers={"Authorization": f"Bearer {key}"},
            timeout=_TIMEOUT,
        )
        return r.status_code in (200, 204)
    except httpx.HTTPError:
        return False


def control_plane_reachable() -> bool:
    """Whether Headscale itself answers right now - not whether any region exists."""
    return _get("/api/v1/node") is not None


def list_regions() -> list[dict]:
    """Every region a device can actually pick, right now, verified live.

    An "exit node" in Headscale terms is any registered node advertising
    itself as an exit route (`--advertise-exit-node` on that machine) and
    tagged `tag:region-<code>` at registration. This reads the live node
    list and derives regions from tags actually present - it does not read
    from a static config that could drift from reality, the exact mistake
    that let a blocklist look configured while gravity held zero domains.

    Returns [] (not an error) when no control plane is configured yet, or
    when one is configured but has no exit nodes registered - both are
    "nothing to offer today", not a fault the owner did anything wrong to
    cause.
    """
    nodes = _get("/api/v1/node")
    if not isinstance(nodes, dict):
        return []
    regions: dict[str, dict] = {}
    for node in nodes.get("nodes", []):
        online = bool(node.get("online"))
        for tag in node.get("validTags", []) or node.get("forcedTags", []) or []:
            if not tag.startswith("tag:region-"):
                continue
            code = tag.removeprefix("tag:region-")
            existing = regions.get(code)
            # A region can have more than one exit node behind it later; for
            # now surface it as available if ANY tagged node is online.
            if existing is None or (online and not existing["available"]):
                regions[code] = {
                    "code": code,
                    "label": _region_label(code),
                    "available": online,
                }
    return sorted(regions.values(), key=lambda r: r["code"])


# Human labels for the codes an operator would actually tag a box with.
# Extend freely - an unknown code still works, it just shows as its own code
# rather than a friendly name, which is honest rather than broken.
_REGION_LABELS = {
    "za": "South Africa",
    "uk": "United Kingdom",
    "us": "United States",
    "de": "Germany",
    "nl": "Netherlands",
    "sg": "Singapore",
}


def _region_label(code: str) -> str:
    return _REGION_LABELS.get(code, code.upper())


def device_status(store, mac: str) -> dict:
    """What this module knows about one device's Shield state, from OUR
    storage - not from Headscale, since a device's CHOICE persists even
    while the control plane is briefly unreachable."""
    row = store.get_vpn_device(mac)
    if row is None:
        return {"mac": mac, "region": None, "enabled": False, "peerRegistered": False}
    return row


def list_device_status(store) -> list[dict]:
    return store.list_vpn_devices()


def apply_device_region(store, mac: str, region: str | None, enabled: bool) -> bool:
    """Set one device's desired region/enabled state, then try to make it real.

    Synchronous by design, like blocklists.apply() - a WireGuard peer config
    is small and this call is not rebuilding gravity, so there is no need for
    the background-thread dance blocklists.py uses for a slow gravity rebuild.

    Returns False and records last_error() on any failure. A failure here
    means the device KEEPS its previous config working (or keeps having none)
    - Shield never silently drops a working tunnel because a later request to
    change it failed partway through.
    """
    global _applying, _last_error

    with _lock:
        _applying = True
    try:
        store.set_vpn_device(mac, region=region, enabled=enabled)

        if not enabled or region is None:
            # Disabling doesn't need the control plane to be reachable - the
            # device simply stops being told to use a peer config. Any
            # config already on the device is the device's own to remove;
            # this box was never in that traffic path to begin with.
            _last_error = None
            return True

        base = _headscale_base()
        if not base:
            _last_error = "no VPN control plane configured on this box yet"
            return False

        regions = {r["code"]: r for r in list_regions()}
        if region not in regions:
            _last_error = f"'{region}' is not a region this box currently offers"
            return False
        if not regions[region]["available"]:
            _last_error = f"the exit server for '{region}' is not reachable right now"
            return False

        # Issue (or re-use) a pre-auth key for this device and hand it back
        # to the caller via store state - the mobile app turns this into a
        # QR code / deep link the OS's own WireGuard-compatible client opens.
        key = _post("/api/v1/preauthkey", {"reusable": False, "expiration": "24h"})
        if key is None:
            _last_error = "the VPN control plane rejected the request"
            return False

        store.set_vpn_device_preauth(mac, key.get("preAuthKey", {}).get("key"))
        _last_error = None
        return True
    finally:
        with _lock:
            _applying = False
