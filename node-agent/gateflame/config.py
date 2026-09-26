"""Runtime configuration. Environment-driven, sane defaults for dev/CI."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    db_path: str = os.environ.get("GATEFLAME_DB_PATH", "/var/lib/gateflame/state.db")
    # Persistent data root (.DUMP) for everything that is not state.db - see
    # datadir.py. Read there via os.environ at call time so tests can point it
    # at a tmp dir; mirrored here so `config` documents every knob in one place.
    data_root: str = os.environ.get("GATEFLAME_DATA_ROOT", "/opt/gateflame/.DUMP")
    listen_host: str = os.environ.get("GATEFLAME_HOST", "0.0.0.0")
    listen_port: int = int(os.environ.get("GATEFLAME_PORT", "8080"))
    # What /system/status reports as agentVersion. The installers write the exact
    # release (e.g. "1.1.0+ab12cd3") into a systemd drop-in (20-version.conf); this
    # default is only what an agent started WITHOUT that drop-in says. It read
    # "0.1.0" for every release through 1.0.3, so the fleet could not tell boxes
    # apart by build - keep it equal to the release this package ships in.
    agent_version: str = os.environ.get("GATEFLAME_VERSION", "1.1.0")
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
    # Background work the lifespan starts. Both default ON on a box; tests/conftest.py
    # turns them off so a `with TestClient(app)` never leaks a sampler thread or a
    # real fetch to vpngate.net - the same gating feed_enabled already gives the feed.
    history_sampler_enabled: bool = os.environ.get("GATEFLAME_HISTORY_SAMPLER", "true").lower() == "true"
    history_sample_seconds: int = int(os.environ.get("GATEFLAME_HISTORY_SAMPLE_SECONDS", "60"))
    vpngate_warm: bool = os.environ.get("GATEFLAME_VPNGATE_WARM", "true").lower() == "true"


config = Config()
