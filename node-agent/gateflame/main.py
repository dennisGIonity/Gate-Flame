"""Gate^Flame node-agent — FastAPI app.

Wires the pairing contract (§3), telemetry, threats, clients and module
control onto the API surface `gateflameApi.ts` in the main repo already
calls. Run with:

    uvicorn gateflame.main:app --host 0.0.0.0 --port 8080

or via the systemd unit in install.sh on the Pi.
"""

from __future__ import annotations

import os

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import clients as clients_mod
from . import services, telemetry, threats
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
