"""LAN-only gating and scope enforcement.

Two independent checks, deliberately kept separate:

- `require_lan`: refuses any request whose source address is not private
  (RFC1918), loopback, or link-local. The node never serves the public
  internet, full stop — this runs before auth, not instead of it.
- `require_scope`: the pairing scope model from the contract. `kiosk` scope is
  granted only to loopback callers, never to a bearer token. That is what
  makes "stop a module" and "revoke devices" require physical presence.
"""

from __future__ import annotations

import ipaddress

from fastapi import Depends, HTTPException, Request

from .storage import Store

PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def is_private_address(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return any(ip in net for net in PRIVATE_NETWORKS)


def is_loopback(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return ip.is_loopback


def require_lan(request: Request) -> None:
    client = request.client
    addr = client.host if client else None
    if not addr or not is_private_address(addr):
        raise HTTPException(status_code=403, detail={"error": "lan_only"})


class ScopeChecker:
    """Callable FastAPI dependency: require one of `scopes`.

    `kiosk` scope is synthesised from loopback source address, never from a
    bearer token — there is no such thing as a "kiosk token" a phone could
    steal or a backup could leak.
    """

    def __init__(self, store: Store, scopes: tuple[str, ...]):
        self.store = store
        self.scopes = scopes

    def __call__(self, request: Request) -> dict:
        require_lan(request)
        client = request.client
        addr = client.host if client else ""
        granted: set[str] = set()
        if is_loopback(addr):
            granted.add("kiosk")

        auth = request.headers.get("authorization", "")
        device = None
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
            device = self.store.device_for_token(token)
            if device:
                granted.update(device["scopes"])

        if not granted.intersection(self.scopes):
            raise HTTPException(status_code=401, detail={"error": "insufficient_scope", "required": list(self.scopes)})

        return {"device": device, "granted_scopes": sorted(granted), "source_ip": addr}
