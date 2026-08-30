"""Runtime configuration. Environment-driven, sane defaults for dev/CI."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    db_path: str = os.environ.get("GATEFLAME_DB_PATH", "/var/lib/gateflame/state.db")
    listen_host: str = os.environ.get("GATEFLAME_HOST", "0.0.0.0")
    listen_port: int = int(os.environ.get("GATEFLAME_PORT", "8080"))
    agent_version: str = os.environ.get("GATEFLAME_VERSION", "0.1.0")
    feed_url: str = os.environ.get("GATEFLAME_FEED_URL", "https://feeds.ionity.today/api/v1/nodes")
    feed_token: str | None = os.environ.get("GATEFLAME_FEED_TOKEN")
    feed_enabled: bool = os.environ.get("GATEFLAME_FEED_ENABLED", "false").lower() == "true"
    feed_interval_seconds: int = int(os.environ.get("GATEFLAME_FEED_INTERVAL_SECONDS", "900"))
    pihole_api_url: str | None = os.environ.get("GATEFLAME_PIHOLE_URL")
    # Pi-hole v6 replaced the open /admin/api.php endpoints with an
    # authenticated REST API, so reading query counts now needs the admin
    # password. Supplied via a systemd drop-in with mode 600, never committed.
    # Absent means the DNS filter module reports an honest gap rather than
    # silently showing zeros.
    pihole_password: str | None = os.environ.get("GATEFLAME_PIHOLE_PASSWORD")
    # Directory holding the built kiosk bundle (dist-kiosk). When it contains an
    # index.html the bundle is served at /device-kiosk. When it does not, the
    # route is not mounted AT ALL rather than mounted-and-empty, so a 404 means
    # "no kiosk installed" and never "installed but broken".
    kiosk_dir: str = os.environ.get("GATEFLAME_KIOSK_DIR", "/opt/gateflame/kiosk")
    # Gate^Flame Shield (per-device VPN, see vpn.py). Absent means the control
    # plane isn't deployed yet on this box - list_regions() then returns []
    # honestly instead of a fault, same shape as pihole_api_url above.
    headscale_url: str | None = os.environ.get("GATEFLAME_HEADSCALE_URL")
    headscale_api_key: str | None = os.environ.get("GATEFLAME_HEADSCALE_API_KEY")
    # Console PIN (ConsoleLock.tsx's `verifyPin` seam). Absent means the console
    # stays hold-to-unlock only, same as before this existed - a household that
    # never sets one loses nothing. Set by the owner at the box, never over the
    # network: nothing here reads it from a paired-device request.
    console_pin: str | None = os.environ.get("GATEFLAME_CONSOLE_PIN")


config = Config()
