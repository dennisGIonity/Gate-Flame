"""Gate^Flame feed receiver — the server side of the §4 support feed.

Receives health reports from `node-agent/gateflame/health_feed.py`. Health
fields only, per `docs/PAIRING-AND-TELEMETRY.md` §4.1 — see `schema.py` and
`storage.py` for how that promise is enforced rather than merely stated.
"""

__version__ = "1.0.0"
