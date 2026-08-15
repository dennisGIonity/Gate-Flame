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


config = Config()
