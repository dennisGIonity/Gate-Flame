"""Runtime configuration. Environment-driven, sane defaults for dev/CI.

Same shape as node-agent's `config.py`, with one difference: this one is
constructed via `Config.from_env()` rather than evaluated once at import, so a
test can stand up several isolated receivers in one process. The module-level
`config` singleton still exists for the production entrypoint.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    db_path: str = "/var/lib/gateflame-feed/feed.db"
    listen_host: str = "0.0.0.0"
    listen_port: int = 8081

    # Bearer token for the Ionity support read API. There is no default and no
    # fallback: if this is unset every admin route answers 503. A support
    # console that silently accepts an empty token is worse than one that is
    # down, because nobody notices.
    admin_token: str | None = None

    # Keyed-hash pepper for node tokens. See security.py for why HMAC and not
    # a bare digest. If unset, security.load_or_create_pepper() generates one
    # into a 0600 sidecar file *next to* the DB, not inside it.
    token_pepper: str | None = None

    # §4 gives no explicit lifetime for health data (§4.2 only lists
    # "retention limits and deletion on request" among the POPIA duties the
    # health-only line is designed to avoid). 90 days is chosen here — see the
    # README "Retention and privacy" section for the reasoning.
    retention_days: int = 90

    # Rate limiting. The agent posts every 15 min (§4.3 rule 5); 60 s minimum
    # spacing and 60 accepted reports/hour leaves room for restarts, backoff
    # and manual re-sends while still capping one broken node at ~1440
    # rows/day instead of a disk-filling retry loop.
    min_interval_seconds: float = 60.0
    max_reports_per_hour: int = 60

    # §4.3 rule 5 promises ≤ 8 KB per POST. We enforce the customer-facing
    # number as a hard limit rather than treating it as advice.
    max_body_bytes: int = 8192

    # Belt-and-braces disk cap, independent of retention: even if retention is
    # misconfigured to 10 years, one node can never hold more than this many
    # rows. 10000 ≈ 104 days at the contracted 15-minute interval.
    max_rows_per_node: int = 10_000

    # A report whose sentAt is further from server time than this is stored
    # but flagged (see storage/main). Only genuinely absurd values are
    # rejected — a unit with a dead RTC is exactly the unit support needs to
    # see. See main.py for the full reasoning.
    clock_suspect_seconds: float = 86_400.0
    # Asymmetric on purpose. A clock that is *behind* has an ordinary cause —
    # a Pi has no battery-backed RTC, so a unit that boots before NTP lands
    # can honestly believe it is 1970-01-01. Any timestamp from the Unix epoch
    # onward is therefore accepted (and flagged). A timestamp *before* the
    # epoch cannot be produced by a UNIX clock however wrong, and one a decade
    # in the future is not skew, it is fabrication.
    clock_reject_future_seconds: float = 315_360_000.0  # 10 years

    version: str = field(default="1.0.0")

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            db_path=os.environ.get("GATEFLAME_FEED_DB_PATH", "/var/lib/gateflame-feed/feed.db"),
            listen_host=os.environ.get("GATEFLAME_FEED_HOST", "0.0.0.0"),
            listen_port=_int("GATEFLAME_FEED_PORT", 8081),
            admin_token=os.environ.get("GATEFLAME_FEED_ADMIN_TOKEN") or None,
            token_pepper=os.environ.get("GATEFLAME_FEED_TOKEN_PEPPER") or None,
            retention_days=_int("GATEFLAME_FEED_RETENTION_DAYS", 90),
            min_interval_seconds=float(_int("GATEFLAME_FEED_MIN_INTERVAL_SECONDS", 60)),
            max_reports_per_hour=_int("GATEFLAME_FEED_MAX_PER_HOUR", 60),
            max_body_bytes=_int("GATEFLAME_FEED_MAX_BODY_BYTES", 8192),
            max_rows_per_node=_int("GATEFLAME_FEED_MAX_ROWS_PER_NODE", 10_000),
        )


config = Config.from_env()
