"""Gate^Flame node-agent — FastAPI app.

Wires the pairing contract (§3), telemetry, threats, clients and module
control onto the API surface `gateflameApi.ts` in the main repo already
calls. Run with:

    uvicorn gateflame.main:app --host 0.0.0.0 --port 8080

or via the systemd unit in install.sh on the Pi.
"""

from __future__ import annotations

import os

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import blocklists, content_categories, filtering_state, threat_level, vpn, vpngate
from . import clients as clients_mod
from . import pihole, services, telemetry, threats
from .config import config
from .health_feed import HealthFeedLoop
from .security import ScopeChecker, is_loopback, require_lan
from .storage import Store

app = FastAPI(title="Gate^Flame node-agent")

# LAN clients only, but the LAN includes the phone's own browser/webview
# talking cross-origin to the node — CORS must allow it. require_lan already
# blocks anything not RFC1918/loopback/link-local regardless of Origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

store = Store(config.db_path)
feed_loop = HealthFeedLoop(store)

kiosk_only = ScopeChecker(store, ("kiosk",))
read_scope = ScopeChecker(store, ("read", "control", "kiosk"))
control_scope = ScopeChecker(store, ("control", "kiosk"))


@app.on_event("startup")
def _startup() -> None:
    feed_loop.start()

    # An "until_reboot" pause has to actually END at reboot, or the phrase is a
    # lie: the box would come back up still unprotected with no indication that
    # what the owner asked for had not happened.
    if store.clear_reboot_pause():
        blocklists.apply_async(store)
    else:
        # RECONCILE ON EVERY OTHER BOOT. Without this, a box whose blocklist is
        # empty stays empty indefinitely: apply() only ever ran on a settings
        # CHANGE, so nothing re-checked reality against intent and the only way
        # back was a human PUTting a threat level the box already had.
        #
        # Cheap when things already agree - two reads, no rebuild - which matters
        # where load shedding makes a reboot a weekly event rather than a rare one.
        blocklists.reconcile_async(store)


@app.on_event("shutdown")
def _shutdown() -> None:
    feed_loop.stop()


@app.get("/api/v1/system/status")
def get_status(request: Request):
    # Path matches src/services/nodeDiscovery.ts, which probes this route on
    # every discovery candidate to confirm it's actually a Gate^Flame node
    # (checking for nodeId + agentVersion) rather than a captive portal.
    require_lan(request)
    return {
        "nodeId": store.node_id(),
        "agentVersion": config.agent_version,
        "provisioned": store.is_provisioned(),
    }


# ---- Pairing (§3.1) --------------------------------------------------------


@app.post("/api/v1/pair/request", status_code=201)
def pair_request(request: Request, _=Depends(kiosk_only)):
    code, expires_at = store.create_pairing_code()
    return {
        "code": code,
        "expiresAt": _iso(expires_at),
        "attemptsRemaining": 5,
    }


@app.post("/api/v1/pair/claim")
def pair_claim(body: dict, request: Request):
    require_lan(request)
    source_ip = request.client.host if request.client else "unknown"

    wait = store.check_rate_limit(source_ip)
    if wait is not None:
        from fastapi import HTTPException

        raise HTTPException(status_code=429, detail={"error": "rate_limited", "retryAfterSeconds": wait})

    code = str(body.get("code", ""))
    device_name = str(body.get("deviceName", "Unnamed device"))

    result = store.claim_pairing_code(code)
    if not result.ok:
        from fastapi import HTTPException

        if result.error == "code_expired":
            raise HTTPException(status_code=410, detail={"error": "code_expired"})
        remaining = store.record_failed_attempt(code)
        raise HTTPException(
            status_code=401, detail={"error": "invalid_code", "attemptsRemaining": remaining}
        )

    device_id, token = store.register_device(device_name, ["read", "control"])
    store.mark_provisioned()
    return {
        "deviceToken": token,
        "deviceId": device_id,
        "nodeId": store.node_id(),
        "nodeName": "Gate^Flame Node",
        "scopes": ["read", "control"],
    }


@app.get("/api/v1/pair/devices")
def pair_devices(_=Depends(read_scope)):
    # Shape matches PairedDevice in src/types/api.ts: deviceName + ISO pairedAt.
    return {
        "devices": [
            {
                "id": d["id"],
                "deviceName": d["name"],
                "pairedAt": _iso(d["pairedAt"]),
                "scopes": d["scopes"],
            }
            for d in store.list_devices()
        ]
    }


@app.delete("/api/v1/pair/devices/{device_id}")
def pair_revoke(device_id: str, _=Depends(kiosk_only)):
    ok = store.revoke_device(device_id)
    return {"ok": ok}


@app.post("/api/v1/pair/devices/revoke-all")
def pair_revoke_all(_=Depends(kiosk_only)):
    # provisioned flag is untouched by design — see storage.Store.revoke_all.
    count = store.revoke_all()
    return {"ok": True, "revoked": count, "provisioned": store.is_provisioned()}


# ---- Telemetry / threats / clients -----------------------------------------


@app.get("/api/v1/telemetry/summary")
def get_telemetry(_=Depends(read_scope)):
    return telemetry.telemetry_summary()


@app.get("/api/v1/threats/recent")
def get_threats(limit: int = 20, _=Depends(read_scope)):
    return threats.recent(limit)


@app.get("/api/v1/clients")
def get_clients(_=Depends(read_scope)):
    return {"clients": clients_mod.list_clients()}


# ---- Modules / services -----------------------------------------------------


@app.get("/api/v1/services")
def get_services(_=Depends(read_scope)):
    return {"modules": services.list_modules()}


@app.get("/api/v1/modules/{module_id}/metrics")
def get_module_metrics(module_id: str, _=Depends(read_scope)):
    return services.module_status(module_id)


@app.post("/api/v1/services/{module_id}/start")
def start_service(module_id: str, _=Depends(control_scope)):
    return services.start_module(module_id).to_dict()


@app.post("/api/v1/services/{module_id}/stop")
def stop_service(module_id: str, _=Depends(kiosk_only)):
    return services.stop_module(module_id).to_dict()


# ---- Firewall bounce (module_firewall_bounce) -------------------------------
#
# Scope choice, stated because it is not obvious: bouncing takes `control`,
# the same as starting a module. Bouncing ADDS enforcement, it is visible in
# the UI, it expires on its own, and cutting a misbehaving device off from
# the phone in your hand is the entire point of the feature.
#
# Releasing also takes `control`, not `kiosk`. A stolen-but-still-paired
# phone could use it, but the blast radius is one host un-bounced —
# recoverable, visible and self-limiting. Tearing the bouncer down wholesale
# is the dangerous action, and that goes through /services/{id}/stop, which
# stays kiosk-only (physical presence).


@app.post("/api/v1/firewall/bounce")
def firewall_bounce(body: dict, _=Depends(control_scope)):
    from fastapi import HTTPException

    from .firewall import FirewallRefusal, FirewallUnavailable

    try:
        result = services.firewall.bounce(body.get("address"), body.get("seconds", 900))
    except FirewallRefusal as exc:
        # 422, not 400: the request was well-formed, the target was refused.
        raise HTTPException(
            status_code=422, detail={"error": exc.reason, "advisory": exc.advisory}
        ) from None
    except FirewallUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "capability_unavailable", "advisory": exc.gap},
        ) from None
    return {"ok": True, **result}


@app.delete("/api/v1/firewall/bounce/{address}")
def firewall_release(address: str, _=Depends(control_scope)):
    from fastapi import HTTPException

    from .firewall import FirewallRefusal, FirewallUnavailable

    try:
        result = services.firewall.release(address)
    except FirewallRefusal as exc:
        raise HTTPException(
            status_code=422, detail={"error": exc.reason, "advisory": exc.advisory}
        ) from None
    except FirewallUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "capability_unavailable", "advisory": exc.gap},
        ) from None
    return {"ok": True, **result}


@app.get("/api/v1/firewall/bounced")
def firewall_bounced(_=Depends(read_scope)):
    # Read straight from the kernel — elements expire there, so any cached
    # copy starts lying the moment a timeout fires.
    return {"bounced": services.firewall.bounced()}


# ---- WAN budget, posture, flows --------------------------------------------


@app.get("/api/v1/wan/summary")
def wan_summary(_=Depends(read_scope)):
    """Monthly usage against the configured cap, plus link quality.

    `gap` is non-null whenever a number could not be measured. The UI's
    DataSourceBanner keys off that rather than off a zero, because a zero is
    indistinguishable from "nothing happened".
    """
    return services.wan.report()


@app.get("/api/v1/posture/audit")
def posture_audit(_=Depends(read_scope)):
    """Read-only posture findings. Never remediates anything."""
    return services.posture.audit()


@app.get("/api/v1/posture/netcheck")
def posture_netcheck(_=Depends(read_scope)):
    """The box's own outward-looking network check, as JSON.

    Ionibot (`src/ionibot/probes.ts` probe A5) renders this verbatim rather than
    deriving its own view, so the phone and the box can never disagree about
    whether the household is protected.

    SCOPE: `read`, deliberately — matching /posture/audit next door rather than
    the unauthenticated /system/status. The payload names the gateway, this box's
    address and whether filtering is currently bypassed. That last one is a
    security-relevant disclosure, and "anyone already on the LAN" includes the
    guest network. A paired phone has a token; an unpaired one gets a 401 and
    Ionibot degrades to "I could not read the full report", which is true.

    Never 500s and never raises: on any failure the body carries a named `gap`
    and an empty `results`, so the customer's phone can say WHICH part could not
    be read instead of showing a generic error.
    """
    return services.netcheck.run()


@app.get("/api/v1/flows/recent")
def flows_recent(limit: int = 200, _=Depends(read_scope)):
    """Hostnames observed on the LAN — SNI and HTTP Host only.

    The response carries its own `note` stating that no payload is read and
    that Encrypted Client Hello flows are invisible here. That matters:
    without it, an empty list reads as "nothing is happening" when it may
    mean "everything is using ECH".
    """
    return services.flows.snapshot(limit=max(1, min(limit, 500)))


def _iso(epoch: float) -> str:
    import time

    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


# ---------------------------------------------------------------------------
# Device kiosk
#
# The kiosk is NOT an Android app - it is Chromium in --kiosk mode ON the Pi,
# pointed at http://localhost:8080/device-kiosk. `npm run build:html-kiosk`
# produced the bundle every release and NOTHING SERVED IT: node-agent had no
# static route, so /device-kiosk always 404'd and the built HTML was dead
# weight on disk. The kiosk has never rendered, on any device.
# ---------------------------------------------------------------------------


def mount_device_kiosk(target_app: FastAPI, kiosk_dir: str) -> bool:
    """Mount the kiosk bundle on `target_app` and record the result in state.

    Factored out of module scope so it is testable WITHOUT reloading this
    module. Reloading re-runs `store = Store(...)` and rebuilds every
    ScopeChecker, which leaks into any test module imported afterwards - that
    silently broke three pairing tests while this was being written.

    Returns True when a bundle was found and mounted.
    """
    mounted = os.path.isfile(os.path.join(kiosk_dir, "index.html"))

    if mounted:
        target_app.mount(
            "/device-kiosk",
            StaticFiles(directory=kiosk_dir, html=True),
            name="device-kiosk",
        )

        # The bundle is built with base "/", so its <script src> is
        # "/assets/kiosk.<hash>.js" - an ABSOLUTE path from the server root,
        # not relative to /device-kiosk/. Mounting only /device-kiosk serves
        # index.html with a 200 and then 404s every script it asks for: a blank
        # screen that looks exactly like a frontend bug and is not one.
        #
        # Fixed here rather than by setting `base` in the Vite config, because
        # that config is SHARED with the mobile build, where Capacitor serves
        # from the webview root and a relative base would break the APK.
        assets = os.path.join(kiosk_dir, "assets")
        if os.path.isdir(assets):
            target_app.mount("/assets", StaticFiles(directory=assets), name="kiosk-assets")

    target_app.state.kiosk = {
        "mounted": mounted,
        "path": "/device-kiosk" if mounted else None,
        "directory": kiosk_dir,
        "gap": None if mounted else f"no index.html in {kiosk_dir}",
    }
    return mounted


mount_device_kiosk(app, config.kiosk_dir)


@app.get("/api/v1/system/kiosk")
def kiosk_status(request: Request):
    """Whether a kiosk bundle is installed, and where it is served from.

    Exists so install-kiosk.sh and the Pi validator can ASSERT the kiosk is
    reachable instead of assuming it - which is how it stayed broken while the
    bundle was rebuilt every release and served by nothing.
    """
    require_lan(request)
    return request.app.state.kiosk


# ---------------------------------------------------------------------------
# Filtering settings
#
# The owner's three choices, and the only writable surface the app exposes:
#
#   GET  /api/v1/filtering                what is on, what is off, and why
#   PUT  /api/v1/filtering/threat-level   how much DANGER to block
#   PUT  /api/v1/filtering/categories     what CONTENT to block
#   POST /api/v1/filtering/pause          switch protection off, temporarily
#   POST /api/v1/filtering/resume         switch it back on
#
# Reads need `read`. Writes need `control` - a paired phone can change these,
# because it is the owner's box and the whole point of the app is that they
# never need a terminal.
#
# Applying a change means rewriting Pi-hole's blocklists and rebuilding gravity,
# which takes tens of seconds on a Pi. The routes return immediately and the
# rebuild runs in the background: an app that hung for 40 seconds on a toggle
# would be assumed broken and tapped again.
# ---------------------------------------------------------------------------


class ThreatLevelBody(BaseModel):
    level: str


class CategoriesBody(BaseModel):
    categories: list[str]


class PauseBody(BaseModel):
    duration: str = filtering_state.DEFAULT_DURATION
    reason: str | None = None


class VpnDeviceBody(BaseModel):
    region: str | None = None
    enabled: bool = False
    provider: str = "headscale"


def _filtering_state_payload() -> dict:
    """Everything a surface needs to render the filtering controls honestly."""
    settings = store.get_filter_settings()

    # An expired timed pause resumes itself the moment anyone looks. Doing it
    # here rather than on a timer means there is no window in which the API
    # reports "paused" for a pause that has already run out.
    if not settings["enabled"] and filtering_state.is_expired(settings["pause_resume_at"]):
        store.resume_filtering()
        settings = store.get_filter_settings()

    state = filtering_state.describe(
        enabled=settings["enabled"],
        duration=settings["pause_duration"],
        resume_time=settings["pause_resume_at"],
        reason=settings["pause_reason"],
    )

    # Bypass outranks everything. If the watchdog has fallen back to an
    # unfiltered resolver, the household is unprotected because the box FAILED,
    # not because anyone chose it - and saying "active" here would be the
    # single most misleading thing this API could do.
    if pihole_bypass_active():
        state["protectionStatus"] = "bypass"
        state["enabled"] = False

    # The same rule, for the failure the bypass check cannot see.
    #
    # FOUND ON THE LIVE BOX 2026-08-24. GF-72TYTITQ reported
    # `protectionStatus: "active", enabled: true, blocklistCount: 1` while
    # Pi-hole held ZERO blocklists and resolved doubleclick.net to a real
    # address. It had never filtered anything, from the day it was built.
    #
    # Nothing was in bypass, so the check above passed it as healthy. The agent
    # had no environment at all (`systemctl show -p Environment` was empty), so
    # `config.pihole_api_url` was None, every `blocklists.apply()` returned
    # False with "Pi-hole unreachable", and the payload cheerfully rendered the
    # owner's INTENT as though it were the state of the network.
    #
    # `unconfigured` is checked first and needs no history: with no Pi-hole URL
    # the agent structurally CANNOT write a list, and that is knowable the
    # instant the process starts. `degraded` covers the case where it could
    # reach Pi-hole once and the last attempt failed.
    #
    # This DOES call Pi-hole, and that is a deliberate reversal. The first cut
    # used only local signals to keep a polled route cheap, and it was wrong:
    # the one question that matters - is anything actually being blocked - can
    # only be answered by the thing doing the blocking. `pihole.summary()` is a
    # loopback call with a cached session and a 4s timeout, and `telemetry`
    # already makes it on the same poll, so the added cost is one request.
    # `summary()` returning None is itself a fault here, not a reason to guess.
    fault: str | None = None
    if state["protectionStatus"] == "active":
        if not config.pihole_api_url:
            state["protectionStatus"] = "unconfigured"
            fault = "This box has no Pi-hole configured, so it cannot block anything."
        else:
            # ASK PI-HOLE WHAT IT ACTUALLY HAS. An earlier version of this check
            # trusted `last_error()` alone and would have passed the live box on
            # 2026-08-24 a second time: after the drop-in was written the agent
            # could read Pi-hole fine, no apply had been attempted since, so
            # last_error was None - and gravity was still empty. 131,068 queries,
            # 0 blocked, reported as "active".
            #
            # `apply()` only runs on a settings CHANGE. Nothing reconciles wanted
            # against loaded at boot, so an empty box stays empty indefinitely and
            # every local signal looks healthy. Until that reconcile exists this
            # comparison is the only thing standing between a customer and a
            # green light over an unprotected network.
            wanted = blocklists.desired_lists(settings)
            loaded = pihole.summary()
            if loaded is None:
                fault = "Pi-hole is not answering, so what it is blocking cannot be confirmed."
            elif wanted and not loaded.get("domainsOnGravity"):
                fault = "Pi-hole has no blocklist loaded, so nothing is being blocked."
            elif blocklists.last_error():
                # A recorded error and a healthy-looking Pi-hole disagree. Ask
                # which one is current rather than trusting the memory: the
                # error is sticky and survives anything that fixes the box
                # WITHOUT going through this agent.
                actual = blocklists.current_lists()
                if actual is not None and set(wanted).issubset(set(actual)):
                    blocklists.forget_error()
                else:
                    # The lists really are wrong, so the error still stands -
                    # e.g. a threat-level change that failed to apply while the
                    # PREVIOUS lists remain loaded and gravity looks fine.
                    fault = blocklists.last_error()

            if fault:
                state["protectionStatus"] = "degraded"

    if fault:
        state["enabled"] = False

    # Surfaced unconditionally, not just on failure: a surface that has to infer
    # "still working" from the absence of a field cannot tell it apart from an
    # older agent that never sent one.
    state["applying"] = blocklists.is_applying()
    # The specific error wins over the general one. `fault` describes the SYMPTOM
    # ("no blocklist loaded"); last_error() names the CAUSE ("Pi-hole rejected
    # <url>"). Preferring the symptom hid a 400 from the lists API behind a
    # sentence that read like a Pi-hole problem, which cost a diagnostic round
    # trip on 2026-08-24.
    state["lastError"] = blocklists.last_error() or fault

    state["threatLevel"] = threat_level.describe(settings["threat_level"])
    state["availableLevels"] = threat_level.all_levels()
    state["categories"] = content_categories.describe_all(settings["categories"])
    state["pauseDurations"] = filtering_state.all_durations()
    return state


def pihole_bypass_active() -> bool:
    """True when the watchdog has fallen back to the unfiltered resolver."""
    return os.path.isfile("/var/lib/gateflame/bypass")


@app.get("/api/v1/filtering")
def get_filtering(request: Request, _=Depends(read_scope)):
    return _filtering_state_payload()


@app.put("/api/v1/filtering/threat-level")
def put_threat_level(
    body: ThreatLevelBody, request: Request, _=Depends(control_scope)
):
    if body.level not in ("low", "medium", "high"):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_level", "allowed": ["low", "medium", "high"]},
        )
    store.set_threat_level(body.level)
    blocklists.apply_async(store)
    return _filtering_state_payload()


@app.put("/api/v1/filtering/categories")
def put_categories(
    body: CategoriesBody, request: Request, _=Depends(control_scope)
):
    unknown = [c for c in body.categories if not content_categories.known(c)]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail={"error": "unknown_categories", "unknown": unknown,
                    "allowed": list(content_categories.CATEGORIES)},
        )
    store.set_categories(content_categories.sanitise(body.categories))
    blocklists.apply_async(store)
    return _filtering_state_payload()


@app.post("/api/v1/filtering/pause")
def pause_filtering(
    body: PauseBody, request: Request, _=Depends(control_scope)
):
    """Switch protection off. The owner's call - see filtering_state."""
    if not filtering_state.valid_duration(body.duration):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_duration",
                    "allowed": filtering_state.DURATION_ORDER},
        )
    resume_at = filtering_state.resume_at(body.duration)
    store.pause_filtering(body.duration, resume_at, body.reason)
    blocklists.apply_async(store)
    return _filtering_state_payload()


@app.post("/api/v1/filtering/resume")
def resume_filtering(request: Request, _=Depends(control_scope)):
    store.resume_filtering()
    blocklists.apply_async(store)
    return _filtering_state_payload()


# ---------------------------------------------------------------------------
# Gate^Flame Shield - per-device VPN. See vpn.py for the full design and why
# the box is never in the tunnel's path on either edition.
# ---------------------------------------------------------------------------

@app.get("/api/v1/vpn/regions")
def get_vpn_regions(request: Request, _=Depends(read_scope)):
    return {
        "label": vpn.GATEFLAME_SHIELD_LABEL,
        "controlPlaneReachable": vpn.control_plane_reachable(),
        # True the moment VPN Gate's public list has ever been read successfully
        # - distinct from controlPlaneReachable, which is specifically about
        # Ionity's own (currently nonexistent) Headscale exit servers. A box
        # can have zero of one and plenty of the other.
        "vpnGateAvailable": vpngate.last_fetch_ok(),
        "regions": vpn.list_all_regions(),
    }


@app.get("/api/v1/vpn/devices")
def get_vpn_devices(request: Request, _=Depends(read_scope)):
    return {"devices": vpn.list_device_status(store)}


@app.get("/api/v1/vpn/devices/{mac}")
def get_vpn_device(mac: str, request: Request, _=Depends(read_scope)):
    return vpn.device_status(store, mac.lower())


@app.put("/api/v1/vpn/devices/{mac}")
def put_vpn_device(
    mac: str, body: VpnDeviceBody, request: Request, _=Depends(control_scope)
):
    ok = vpn.apply_device_region(store, mac.lower(), body.region, body.enabled, body.provider)
    result = vpn.device_status(store, mac.lower())
    result["applying"] = vpn.is_applying()
    result["lastError"] = vpn.last_error()
    if not ok:
        # Same shape as blocklists: the intent is still recorded (device_status
        # reflects what was asked for), the write just did not fully land, and
        # the caller gets a 200 with lastError set rather than a bare 4xx/5xx -
        # the mobile screen needs to show WHAT didn't work, not just THAT it
        # didn't.
        pass
    return result


@app.get("/api/v1/vpn/continents")
def get_vpn_continents(request: Request, _=Depends(read_scope)):
    """Coarser than /vpn/regions on purpose - one tile per continent, each
    already resolved to its own best country right now. See
    vpngate.list_continents() for why this doesn't need its own storage
    concept."""
    return {"continents": vpngate.list_continents()}


@app.get("/api/v1/vpn/devices/{mac}/vpngate-config")
def get_vpngate_device_config(mac: str, request: Request, _=Depends(read_scope)):
    """The actual .ovpn text for a device currently on the VPN Gate path -
    fetched live each call, never persisted, since VPN Gate's own server list
    rotates and a saved config can silently go stale. See vpn.py's
    vpngate_config_for_device() and vpngate.py's own docstring for what this
    network actually is and is not before wiring a "download" button to it."""
    return vpn.vpngate_config_for_device(store, mac.lower())
