"""mDNS advert `_gft1._tcp` so T1 boards find the server without a compiled-in IP
(ESP32-MCP lesson 1: never compile the server's IP into a board). Optional and never
fatal: if zeroconf is missing or fails, boards use their NVS/compiled fallback URL."""
from __future__ import annotations

import socket


def _lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.168.124.1", 9))   # no packet is sent; picks the lab-facing interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


async def advertise(port: int):
    """Called from the app's lifespan, i.e. INSIDE the running event loop - so the async
    API is mandatory (the sync one raises EventLoopBlocked there; seen 2026-09-25)."""
    try:
        from zeroconf import ServiceInfo
        from zeroconf.asyncio import AsyncZeroconf
    except ImportError as e:
        print(f"[t1] zeroconf unavailable ({e}) - no mDNS advert; boards use their fallback URL")
        return None
    ip = _lan_ip()
    try:
        info = ServiceInfo("_gft1._tcp.local.", "GateFlame-T1._gft1._tcp.local.",
                           addresses=[socket.inet_aton(ip)], port=port,
                           properties={"path": "/api/t1/v1", "v": "1"}, server="gateflame-t1.local.")
        azc = AsyncZeroconf()
        await azc.async_register_service(info)
        print(f"[t1] mDNS: _gft1._tcp -> {ip}:{port}")
        return azc
    except Exception as e:  # noqa: BLE001 - discovery is a convenience, never a reason to stop
        print(f"[t1] mDNS advert failed ({type(e).__name__}: {e}) - boards use their fallback URL")
        return None
