"""Gate^Flame node-agent — FastAPI app.

Wires the pairing contract (§3), telemetry, threats, clients and module
control onto the API surface `gateflameApi.ts` in the main repo already
calls. Run with:

    uvicorn gateflame.main:app --host 0.0.0.0 --port 8080

or via the systemd unit in install.sh on the Pi.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

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


def _iso(epoch: float) -> str:
    import time

    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))
