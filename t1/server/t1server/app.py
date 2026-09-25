"""Gate^Flame T1 server - FastAPI on :8095.

  /api/t1/v1/...   device API (X-T1-Token) and admin API (loopback or X-T1-Admin)
  /mcp             MCP JSON-RPC (admin)
  /                dashboard (static)

Admin trust: a request from this machine (127.0.0.1/::1) is trusted without a token,
because this server runs on Dennis's own workstation. From anywhere else on the LAN
the X-T1-Admin token is required. Devices always need the device token.
"""
from __future__ import annotations

import hmac
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import mcp, signing
from .config import LEVELS, PORT, data_path, tokens
from .service import Service
from .store import Store

STATIC = Path(__file__).resolve().parents[1] / "static"


def create_app(store: Store | None = None, svc: Service | None = None, advertise: bool = False) -> FastAPI:
    store = store or Store()
    svc = svc or Service(store)
    tok = tokens()

    def housekeeping():
        while True:
            try:
                store.prune()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(3600)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        signing.public_pem()           # create the key on first run, not on first build
        svc.allow_meta()
        threading.Thread(target=housekeeping, daemon=True).start()
        if advertise and not any(svc.current_filter(lv) for lv in LEVELS):
            svc.build_filters()        # first run: boards need something to download
        zc = None
        if advertise:
            from .discovery import advertise as adv
            zc = await adv(PORT)
        yield
        if zc:
            await zc.async_close()

    app = FastAPI(title="Gate^Flame T1 server", version="0.1.0", docs_url="/api/t1/docs", lifespan=lifespan)
    app.state.svc = svc
    started = time.time()

    def device_auth(req: Request):
        if not hmac.compare_digest(req.headers.get("x-t1-token", ""), tok["device_token"]):
            raise HTTPException(401, "device token required")

    def admin_auth(req: Request):
        host = req.client.host if req.client else ""
        if host in ("127.0.0.1", "::1", "localhost", "testclient"):
            return
        if not hmac.compare_digest(req.headers.get("x-t1-admin", ""), tok["admin_token"]):
            raise HTTPException(401, "admin token required from another machine")

    # ── open ──
    @app.get("/api/t1/v1/health")
    def health():
        return {"ok": True, "service": "gateflame-t1", "uptime_s": round(time.time() - started),
                "filters": {lv: (svc.current_filter(lv) or {}).get("version", 0) for lv in LEVELS}}

    # ── device ──
    @app.get("/api/t1/v1/manifest.txt", dependencies=[Depends(device_auth)])
    def manifest(level: str = "low"):
        return PlainTextResponse(svc.manifest_text(level))

    @app.get("/api/t1/v1/filter/{level}/{version}.bin", dependencies=[Depends(device_auth)])
    def filter_bin(level: str, version: int):
        p = svc.filter_file(level, version)
        if not p:
            raise HTTPException(404, "no such filter")
        return FileResponse(p, media_type="application/octet-stream")

    @app.get("/api/t1/v1/allow.txt", dependencies=[Depends(device_auth)])
    def allow_txt():
        svc.allow_meta()
        return PlainTextResponse(data_path("allow.txt").read_text())

    @app.post("/api/t1/v1/telemetry", dependencies=[Depends(device_auth)])
    async def telemetry(req: Request):
        try:
            body = await req.json()
            return PlainTextResponse(svc.ingest(body, req.client.host if req.client else ""))
        except (ValueError, TypeError) as e:
            raise HTTPException(400, str(e)) from e

    # ── admin ──
    A = [Depends(admin_auth)]

    @app.get("/api/t1/v1/status", dependencies=A)
    def status():
        return {"server": {"uptime_s": round(time.time() - started), "port": PORT},
                "fleet": svc.fleet_summary(), **svc.filter_status()}

    @app.get("/api/t1/v1/devices", dependencies=A)
    def devices():
        return svc.devices()

    @app.get("/api/t1/v1/devices/{did}", dependencies=A)
    def device(did: str, hours: float = 24):
        d = svc.device(did, hours)
        if d is None:
            raise HTTPException(404, "no such device")
        return d

    @app.post("/api/t1/v1/devices/{did}/cmd", dependencies=A)
    async def cmd(did: str, req: Request):
        b = await req.json()
        try:
            return svc.send_command(did, b.get("command", ""), str(b.get("arg", "")))
        except KeyError as e:
            raise HTTPException(404, f"no device {e}") from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.post("/api/t1/v1/devices/{did}/label", dependencies=A)
    async def label(did: str, req: Request):
        svc.set_label(did, (await req.json()).get("label", did))
        return {"ok": True}

    @app.delete("/api/t1/v1/devices/{did}", dependencies=A)
    def forget(did: str):
        for t in ("devices", "telemetry", "commands"):
            store.x(f"DELETE FROM {t} WHERE {'id' if t == 'devices' else 'device_id'}=?", (did,))
        store.event("device_forgotten", "removed from the fleet list", did)
        return {"ok": True}

    @app.post("/api/t1/v1/filters/build", dependencies=A)
    def build():
        return svc.build_filters()

    @app.get("/api/t1/v1/check", dependencies=A)
    def check(domain: str, level: str = "low"):
        return svc.check_domain(domain, level)

    @app.get("/api/t1/v1/allowlist", dependencies=A)
    def allowlist():
        return {"entries": svc.allow_list(), "meta": svc.allow_meta()}

    @app.post("/api/t1/v1/allowlist", dependencies=A)
    async def allow_add(req: Request):
        b = await req.json()
        try:
            return svc.allow_add(b.get("domain", ""), b.get("note", ""))
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.delete("/api/t1/v1/allowlist/{domain}", dependencies=A)
    def allow_remove(domain: str):
        return svc.allow_remove(domain)

    @app.get("/api/t1/v1/events", dependencies=A)
    def events(limit: int = 100):
        return svc.events(limit)

    @app.get("/api/t1/v1/pubkey.pem", dependencies=A)
    def pubkey():
        return PlainTextResponse(signing.public_pem())

    @app.post("/mcp", dependencies=A)
    async def mcp_rpc(req: Request):
        body = await req.json()
        if isinstance(body, list):
            out = [r for r in (mcp.handle(svc, m) for m in body) if r is not None]
            return JSONResponse(out) if out else Response(status_code=202)
        r = mcp.handle(svc, body)
        return JSONResponse(r) if r is not None else Response(status_code=202)

    app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="dashboard")
    return app
