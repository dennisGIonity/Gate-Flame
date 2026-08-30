"""Gate^Flame Shield - the free, zero-budget, real-country-picker provider.

WHY THIS FILE EXISTS

vpn.py's Headscale path answers "per-device, per-region, toggleable" honestly,
but list_regions() there returns [] until Ionity stands up its own exit server
in a country - real infrastructure, real budget, one region at a time. Dennis
was explicit: budget is R0, and the point of the feature is that a customer
can actually pick a country TODAY. Headscale alone cannot do that yet.

VPN Gate (https://www.vpngate.net) is a public, free, real-time list of
volunteer-run relay servers spread across dozens of countries, published by
the University of Tsukuba as an ongoing academic research project. It answers
"pick a country, for free, right now" completely - hundreds of servers, no
signup, no account, no infrastructure this repo has to run or pay for. The
API this module reads (http://www.vpngate.net/api/iphone/) is public and has
been stable for over a decade; it is not something Ionity operates or can
break.

THE HONEST PART - READ THIS BEFORE PUTTING THIS IN FRONT OF A CUSTOMER

VPN Gate is an academic experiment, not audited privacy infrastructure, and
its own operators say so in public:

  - VPN Gate's own published policy is that connection metadata (timestamps,
    source/destination IPs, protocol, traffic volume, destination hostnames -
    not packet payloads) is logged centrally for a period measured in months,
    for abuse prevention, as a condition of the project existing at all on
    donated volunteer bandwidth.
  - Peer-reviewed research ("On Man-in-the-Middle Attack Risks of the VPN
    Gate Relay System") has documented that because VPN Gate volunteer nodes
    can share TLS material, a malicious node operator has a theoretical path
    to intercept a session. This is a real, published finding about the
    network this module talks to, not a hypothetical.

Given that safety and privacy is this product's actual sales pitch, this
module and everything downstream of it must NEVER be marketed, labelled, or
described as "audited", "no-logs", "anonymous", or "private" - that claim
would be false about the network underneath it, and this file is exactly
where that promise would quietly become a lie if nobody stopped it. The
customer-facing framing this repo uses is "community region access" - real,
free, useful for a geography-restricted site or a quick country change, and
described as best-effort convenience rather than a trust guarantee. The
premium, verified-and-controlled equivalent is the Headscale path in vpn.py,
once Ionity's own exit servers exist - see docs/VPN-SHIELD-DESIGN.md for the
two-tier design this split produces.

WHAT THIS MODULE ACTUALLY TOUCHES

Only a public leaderboard of volunteer servers (IP, country, ping, speed,
score, an OpenVPN config blob) - the same file anyone's browser can fetch.
Gate^Flame's box is never in the path of the tunnelled traffic itself: this
module fetches metadata and hands back a ready-to-import OpenVPN config
string for the DEVICE's own OS-level OpenVPN client to use, exactly the same
"box never carries the tunnel" shape ADR-001 and vpn.py's Headscale path both
already commit to.
"""

from __future__ import annotations

import base64
import binascii
import threading
import time

import httpx

_TIMEOUT = 12.0
_CACHE_TTL = 600.0  # 10 minutes - VPN Gate's list churns; no need to hammer it.

VPNGATE_CSV_URL = "http://www.vpngate.net/api/iphone/"

_lock = threading.Lock()
_cache: list[dict] = []
_cache_at: float = 0.0
_last_error: str | None = None

# Friendly names for the ISO-ish country codes VPN Gate's CSV actually uses.
# Unknown codes still work - they just show as their own code, honest rather
# than broken, same convention as vpn.py's _REGION_LABELS.
_COUNTRY_LABELS = {
    "JP": "Japan", "US": "United States", "KR": "South Korea", "GB": "United Kingdom",
    "DE": "Germany", "FR": "France", "NL": "Netherlands", "CA": "Canada",
    "AU": "Australia", "SG": "Singapore", "IN": "India", "BR": "Brazil",
    "RU": "Russia", "CN": "China", "TW": "Taiwan", "HK": "Hong Kong",
    "VN": "Vietnam", "TH": "Thailand", "ID": "Indonesia", "MY": "Malaysia",
    "ZA": "South Africa", "IT": "Italy", "ES": "Spain", "SE": "Sweden",
    "CH": "Switzerland", "PL": "Poland", "UA": "Ukraine", "TR": "Turkey",
    "MX": "Mexico", "AR": "Argentina", "PH": "Philippines", "AE": "United Arab Emirates",
}


def _country_label(code: str) -> str:
    return _COUNTRY_LABELS.get(code.upper(), code.upper())


# Continent grouping - lets the mobile screen offer "Europe" instead of
# making someone pick between fifteen individual European countries. Static
# geography, not something that goes stale the way server lists do. Any code
# missing from this map still works - it just falls back to "Other", grouped
# rather than dropped, so a country VPN Gate adds tomorrow is never silently
# excluded from the picker.
_CONTINENT_MAP = {
    "DZ": "Africa", "AO": "Africa", "EG": "Africa", "ET": "Africa", "GH": "Africa",
    "KE": "Africa", "MA": "Africa", "NG": "Africa", "ZA": "Africa", "TN": "Africa",
    "TZ": "Africa", "UG": "Africa",
    "CA": "North America", "US": "North America", "MX": "North America",
    "CR": "North America", "PA": "North America", "CU": "North America",
    "AR": "South America", "BR": "South America", "CL": "South America",
    "CO": "South America", "PE": "South America", "VE": "South America",
    "EC": "South America", "UY": "South America",
    "GB": "Europe", "DE": "Europe", "FR": "Europe", "NL": "Europe", "IT": "Europe",
    "ES": "Europe", "SE": "Europe", "CH": "Europe", "PL": "Europe", "UA": "Europe",
    "RU": "Europe", "PT": "Europe", "BE": "Europe", "AT": "Europe", "IE": "Europe",
    "NO": "Europe", "DK": "Europe", "FI": "Europe", "GR": "Europe", "RO": "Europe",
    "CZ": "Europe", "HU": "Europe", "BG": "Europe", "SK": "Europe", "HR": "Europe",
    "LT": "Europe", "LV": "Europe", "EE": "Europe", "IS": "Europe", "LU": "Europe",
    "JP": "Asia", "KR": "Asia", "CN": "Asia", "TW": "Asia", "HK": "Asia",
    "IN": "Asia", "VN": "Asia", "TH": "Asia", "ID": "Asia", "MY": "Asia",
    "SG": "Asia", "PH": "Asia", "TR": "Asia", "IL": "Asia", "AE": "Asia",
    "SA": "Asia", "PK": "Asia", "BD": "Asia", "KZ": "Asia", "MN": "Asia",
    "AU": "Oceania", "NZ": "Oceania",
}


def _continent(code: str) -> str:
    return _CONTINENT_MAP.get(code.upper(), "Other")


def last_fetch_ok() -> bool:
    """False until the first successful fetch, or if the most recent one failed
    AND there is no earlier good cache to fall back on."""
    return bool(_cache) and _last_error is None


def last_error() -> str | None:
    return _last_error


def _parse_csv(text: str) -> list[dict]:
    """VPN Gate's own format: `*`-prefixed comment/footer lines, one `#`-prefixed
    header line, comma-separated data rows. The base64 config column uses only
    the base64 alphabet (no commas), so a plain split(",") per line is safe -
    this is the same format the project has published for over a decade.
    """
    header: list[str] | None = None
    rows: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("*"):
            continue
        if line.startswith("#"):
            header = line.lstrip("#").split(",")
            continue
        if header is None:
            continue
        parts = line.split(",")
        if len(parts) < len(header):
            continue  # malformed row - skip it, don't let it take the batch down
        row = dict(zip(header, parts))
        rows.append(row)
    return rows


def _refresh(force: bool = False) -> None:
    global _cache, _cache_at, _last_error
    with _lock:
        stale = (time.time() - _cache_at) > _CACHE_TTL
        if not (force or stale):
            return
    try:
        r = httpx.get(VPNGATE_CSV_URL, timeout=_TIMEOUT)
        if r.status_code != 200:
            with _lock:
                _last_error = f"VPN Gate answered with HTTP {r.status_code}"
            return
        rows = _parse_csv(r.text)
        if not rows:
            with _lock:
                _last_error = "VPN Gate's list came back empty or unparseable"
            return
        with _lock:
            _cache = rows
            _cache_at = time.time()
            _last_error = None
    except httpx.HTTPError as exc:
        # Keep whatever cache already exists - a network hiccup should not
        # blank out a list that was working a minute ago.
        with _lock:
            _last_error = f"could not reach VPN Gate: {exc}"


def list_countries() -> list[dict]:
    """Every country currently offered, one entry per country, picked as the
    best-scoring server VPN Gate currently reports for it.

    Returns [] honestly if the feed has never been reached successfully - same
    "nothing to offer today, not a fault" shape as vpn.list_regions().
    """
    _refresh()
    with _lock:
        rows = list(_cache)

    best: dict[str, dict] = {}
    for row in rows:
        code = (row.get("CountryShort") or "").strip().upper()
        if not code or len(code) > 3:
            continue
        try:
            score = float(row.get("Score") or 0)
        except ValueError:
            score = 0.0
        existing = best.get(code)
        if existing is None or score > existing["_score"]:
            best[code] = {"_score": score, "row": row}

    countries = []
    for code, entry in best.items():
        row = entry["row"]
        countries.append({
            "code": code,
            "label": _country_label(code),
            "provider": "vpngate",
            "available": True,
            "serverCount": sum(
                1 for r in rows if (r.get("CountryShort") or "").strip().upper() == code
            ),
        })
    return sorted(countries, key=lambda c: c["code"])


def list_continents() -> list[dict]:
    """One tile per continent that currently has at least one server, each
    naming the single best-scoring country within it right now.

    This exists because asking someone to pick the right one of fifteen
    European countries is a worse product than asking them to pick "Europe" -
    Dennis's own ask. It resolves to a concrete country immediately rather
    than inventing a new stored concept: the mobile screen calls
    apply_device_region with `bestCountryCode` exactly as if the owner had
    picked that country directly, so nothing downstream (storage, the config
    endpoint) needs to know "continent" exists at all - it is a display and
    selection convenience only, resolved once at pick time.
    """
    _refresh()
    with _lock:
        rows = list(_cache)

    def _score(r: dict) -> float:
        try:
            return float(r.get("Score") or 0)
        except ValueError:
            return 0.0

    groups: dict[str, list[dict]] = {}
    for row in rows:
        code = (row.get("CountryShort") or "").strip().upper()
        if not code:
            continue
        groups.setdefault(_continent(code), []).append(row)

    continents = []
    for name, group_rows in groups.items():
        best = max(group_rows, key=_score)
        best_code = (best.get("CountryShort") or "").strip().upper()
        countries = sorted({(r.get("CountryShort") or "").strip().upper() for r in group_rows})
        continents.append({
            "code": name.lower().replace(" ", "-"),
            "label": name,
            "provider": "vpngate",
            "available": True,
            "bestCountryCode": best_code,
            "bestCountryLabel": _country_label(best_code),
            "countryCount": len(countries),
            "serverCount": len(group_rows),
        })
    return sorted(continents, key=lambda c: c["label"])


def get_ovpn_config(country_code: str) -> dict | None:
    """The best available server for one country, config decoded and ready to
    hand to the device's own OS-level OpenVPN client.

    Returns None if the feed is unreachable or the country isn't currently
    offered - never a stale/guessed config, since VPN Gate's volunteer list
    genuinely rotates and an expired entry is worse than an honest failure.
    """
    _refresh()
    code = country_code.strip().upper()
    with _lock:
        rows = list(_cache)

    candidates = [r for r in rows if (r.get("CountryShort") or "").strip().upper() == code]
    if not candidates:
        return None

    def _score(r: dict) -> float:
        try:
            return float(r.get("Score") or 0)
        except ValueError:
            return 0.0

    best = max(candidates, key=_score)
    blob = (best.get("OpenVPN_ConfigData_Base64") or "").strip()
    if not blob:
        return None
    try:
        config_text = base64.b64decode(blob, validate=False).decode("utf-8", errors="replace")
    except (binascii.Error, ValueError):
        return None

    def _num(key: str) -> float | None:
        try:
            return float(best.get(key))
        except (TypeError, ValueError):
            return None

    return {
        "countryCode": code,
        "countryName": _country_label(code),
        "hostname": best.get("HostName"),
        "ip": best.get("IP"),
        "score": _num("Score"),
        "pingMs": _num("Ping"),
        "speedMbps": (_num("Speed") or 0) / 1_000_000 if _num("Speed") else None,
        "configText": config_text,
    }
