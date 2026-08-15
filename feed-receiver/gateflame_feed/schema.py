"""The §4 wire contract, expressed as a closed allowlist.

`docs/PAIRING-AND-TELEMETRY.md` §4.1 is a written promise to the customer:
the support feed carries health fields and **never** domains, client IPs,
MACs, hostnames, threat log entries, per-client DNS volumes, DPI/SNI output,
Wi-Fi SSIDs or geolocation. §4.2 explains why — those fields are personal
information under POPIA and receiving them changes what Ionity legally is.

A promise that lives only in a document is broken by the first careless agent
build. These models are the enforcement, and they are built on four rules:

1. **`extra="forbid"` on every model, including the nested ones.** An unknown
   key anywhere in the object — top level, inside `host`, inside a module
   entry, inside `counters` — is a hard 422. Pydantic's default is to *drop*
   unknown keys, which is the dangerous behaviour here: a buggy agent that
   started attaching `clientIps` would be silently accepted, the field would
   quietly vanish, and nobody would learn for months that the fleet had been
   posting personal information at Ionity's endpoint. A 422 lands in the
   agent's own logs (`health_feed._send_once` treats >=300 as failure) the
   same day. Loud and broken beats quiet and leaking.

2. **Typed, bounded scalars.** Every accepted field has a type, a range and,
   for strings, a maximum length. There is no `dict`, no `Any`, no
   `list[str]` of free text, and no field anywhere that could hold a log line.

3. **Identifier shapes that cannot express the forbidden data.** `nodeId`
   matches the §3.3 `GF-` + base32 shape; a module `id` is
   `^[a-z][a-z0-9_]{0,63}$`. Neither pattern can contain a dot or a colon, so
   neither can smuggle a domain, an FQDN or an IP even as a value.

4. **Free-text hygiene on the two fields §4.1 does allow to be free text.**
   `gap` and `remedy` are prose written by the module registry ("the named
   gap" is explicitly on the *send* side of the §4.1 table). They are capped
   at 200 characters and scanned for IP literals and MAC addresses, because a
   gap string that names a client address is exactly the leak §4 forbids and
   no legitimate gap in `node-agent/gateflame/services.py` or `firewall.py`
   contains one. Note deliberately that we do **not** try to detect
   domain-shaped text here: the real firewall gap says "AmbientCapabilities=
   CAP_NET_ADMIN in gateflame.service", and `gateflame.service` is
   domain-shaped. A check that rejected it would break a legitimate report,
   and a validator that cries wolf gets disabled. Scope the check to what is
   unambiguous.

The fifth rule is not in this file at all: `storage.py` has no column, and no
JSON blob, that could hold a domain or an address even if this module were
bypassed entirely. Validation and storage independently make the same promise.
"""

from __future__ import annotations

import ipaddress
import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# §3.3: `GF-` + 8 base32 characters, generated on the node at first boot.
#
# Two documented inconsistencies are absorbed here rather than enforced, both
# noted because a stricter pattern would reject real traffic:
#
#  * Grouping. `storage._gen_node_id()` emits it ungrouped ("GF-FVYRMQVX");
#    the §4.4 worked example prints it grouped ("GF-A7K2-9QX4"). Both accepted.
#  * Alphabet. §3.3 says base32, whose alphabet is A-Z2-7, and
#    `base64.b32encode` duly produces only those characters — but §4.4's own
#    example contains a `9`, which base32 cannot emit. Rather than 422 the
#    identifier printed in the contract, the class is widened to uppercase
#    alphanumerics.
#
# The security-relevant property survives either way: uppercase alphanumerics
# and a single hyphen cannot express a dot, a colon or a lowercase label, so a
# hostname or an IP cannot be smuggled through as a nodeId.
NODE_ID_PATTERN = r"^GF-[A-Z0-9]{4,8}(-[A-Z0-9]{4,8})?$"

# Module ids come from a fixed registry on the node. Lowercase + underscore
# only — structurally incapable of holding a domain or an address.
MODULE_ID_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"

AGENT_VERSION_PATTERN = r"^[0-9A-Za-z][0-9A-Za-z.+_\-]{0,31}$"

# `vcgencmd get_throttled` output, e.g. "0x50000".
THROTTLE_FLAGS_PATTERN = r"^0x[0-9a-fA-F]{1,16}$"

FREE_TEXT_MAX = 200

_DOTTED_QUAD = re.compile(r"\d{1,3}(?:\.\d{1,3}){3}")
_MAC = re.compile(r"\b[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}\b")
_TOKEN_SPLIT = re.compile(r"[\s,;()\[\]<>\"'=]+")
_TRIM = "`\"'()[]<>,;!?"


def _looks_like_ip(candidate: str) -> bool:
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return False
    return True


def contains_network_identifier(text: str) -> bool:
    """True if `text` contains an IP literal or a MAC address.

    Used only on the two free-text fields §4.1 permits. Confirms every
    candidate through `ipaddress` rather than trusting a regex, so version
    strings ("1.0.6", "0.1.0") and unit names ("gateflame.service") do not
    trip it — only something that genuinely parses as an address does.
    """
    if _MAC.search(text):
        return True
    if any(_looks_like_ip(m) for m in _DOTTED_QUAD.findall(text)):
        # Catches embedded forms the token scan would miss, e.g. "10.0.0.5:53".
        return True
    for raw in _TOKEN_SPLIT.split(text):
        token = raw.strip(_TRIM)
        if token and _looks_like_ip(token):
            return True
    return False


def _clean_free_text(value: str | None) -> str | None:
    if value is None:
        return None
    if contains_network_identifier(value):
        # 422, not a scrub. A scrub would hide from Ionity that one of its own
        # units is emitting addresses in its status text; the rejection puts it
        # in that node's log where a support engineer will see it.
        raise ValueError(
            "free-text field contains an IP or MAC address; "
            "PAIRING-AND-TELEMETRY.md §4.1 forbids client identifiers in the health feed"
        )
    return value


class StrictModel(BaseModel):
    """Base for every model on the wire. `extra="forbid"` is the whole point."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class HostMetrics(StrictModel):
    """§4.1 row: "CPU / RAM / disk / thermal, SoC throttle flags".

    Every field is optional because `telemetry.host_snapshot()` legitimately
    omits `throttleFlags` on a host without `vcgencmd` and sets `tempC` to
    None where no thermal zone is exposed. Optional-with-bounds, never
    free-form: a machine with no sensor sends nothing, not a plausible fake.
    """

    cpuPercent: float | None = Field(default=None, ge=0, le=100)
    memUsedMB: int | None = Field(default=None, ge=0, le=1_048_576)
    memTotalMB: int | None = Field(default=None, ge=0, le=1_048_576)
    diskUsedPercent: float | None = Field(default=None, ge=0, le=100)
    tempC: float | None = Field(default=None, ge=-90, le=200)
    throttleFlags: str | None = Field(default=None, pattern=THROTTLE_FLAGS_PATTERN)


class ModuleHealth(StrictModel):
    """§4.1 row: "Per-module status ... and the named gap"."""

    id: str = Field(pattern=MODULE_ID_PATTERN)
    # The §4.4 example shows running/degraded/stopped. The real registry in
    # node-agent/gateflame/services.py also emits `not_implemented` (its
    # honest-gaps design) and `unknown` (for an id not in MODULE_DEFS), so
    # both are accepted here — see the README "Client/server mismatches" note.
    status: Literal["running", "stopped", "degraded", "not_implemented", "unknown"]
    gap: str | None = Field(default=None, max_length=FREE_TEXT_MAX)
    # Present in the §4.4 example, not currently emitted by build_payload().
    remedy: str | None = Field(default=None, max_length=FREE_TEXT_MAX)
    restarts24h: int | None = Field(default=None, ge=0, le=1_000_000)

    @field_validator("gap", "remedy")
    @classmethod
    def _no_identifiers(cls, v: str | None) -> str | None:
        return _clean_free_text(v)


class Counters(StrictModel):
    """§4.1 rows: error counts, restart count, data-budget consumption."""

    errors24h: int | None = Field(default=None, ge=0, le=100_000_000)
    restarts24h: int | None = Field(default=None, ge=0, le=1_000_000)
    # build_payload() sends None until module_wan_audit exists; §4.4 shows 41.
    wanBudgetUsedPercent: float | None = Field(default=None, ge=0, le=1000)


class HealthReport(StrictModel):
    """The complete accepted payload. Anything not listed here is a 422.

    This is the entire §4.1 left column and nothing else. There is no
    `clients`, no `queries`, no `threats`, no `dns`, no `interfaces` — and
    because of `extra="forbid"`, adding one to the agent without adding it
    here (which would mean arguing it past §4.1 in review) fails closed.
    """

    nodeId: str = Field(pattern=NODE_ID_PATTERN)
    agentVersion: str = Field(pattern=AGENT_VERSION_PATTERN)
    sentAt: str = Field(max_length=64)
    uptimeSeconds: int = Field(ge=0, le=3_155_760_000)  # 100 years
    host: HostMetrics
    # 32 is ~4x the nine-module registry; bounds the row count one report can
    # create, which is half of the disk-fill story (rate limiting is the other).
    modules: list[ModuleHealth] = Field(default_factory=list, max_length=32)
    counters: Counters = Field(default_factory=Counters)
    piholeReachable: bool | None = None

    @field_validator("sentAt")
    @classmethod
    def _parseable_timestamp(cls, v: str) -> str:
        parse_sent_at(v)  # raises ValueError -> 422
        return v


def parse_sent_at(value: str) -> datetime:
    """Parse the agent's `sentAt` into an aware UTC datetime.

    `health_feed.build_payload()` formats it as "%Y-%m-%dT%H:%M:%SZ".
    Python 3.11's `fromisoformat` accepts the trailing "Z" directly; an
    explicit offset is accepted too and normalised to UTC. A naive timestamp
    is *assumed* UTC rather than rejected, because the field is documented as
    UTC and rejecting it would lose a node's health over a formatting nit.

    What this function deliberately does not do is decide whether the value is
    *plausible*. `sentAt` is node-controlled, so plausibility is a policy
    decision made in main.py, and nothing that matters (ordering, last-seen,
    retention) is derived from it in the first place.
    """
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


# The exact field list, for the README, the /api/v1/contract route and the
# test that asserts the two never drift apart.
ACCEPTED_FIELDS: dict[str, list[str]] = {
    "": sorted(HealthReport.model_fields),
    "host": sorted(HostMetrics.model_fields),
    "modules[]": sorted(ModuleHealth.model_fields),
    "counters": sorted(Counters.model_fields),
}

# Named in §4.1's "Never send" column. Nothing in this list is a field name in
# any model above; the test suite asserts that, so the promise is checked by
# CI rather than by whoever last read the document.
FORBIDDEN_FIELD_NAMES: tuple[str, ...] = (
    "clientIps",
    "clients",
    "domains",
    "hostnames",
    "hostname",
    "macs",
    "macAddresses",
    "threats",
    "threatLog",
    "queries",
    "queryLog",
    "dnsQueries",
    "sni",
    "dpi",
    "ssid",
    "ssids",
    "wifiSsid",
    "geolocation",
    "location",
    "gravity",
    "blocklist",
)
