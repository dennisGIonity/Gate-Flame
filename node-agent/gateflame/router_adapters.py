"""Per-vendor router adapters for the one-time handshake.

WHAT IS PROVEN AND WHAT IS NOT

Identification works and is solid. A router's UPnP device description is
unauthenticated, standards-defined, and returns the exact model - no scraping, no
guessing. Verified against the live unit on 2026-08-19:

    SERVER: Linux/4.4.60, UPnP/1.0, Portable SDK for UPnP devices/1.6.19
    LOCATION: http://192.168.0.1:1900/jubzkc/gatedesc.xml
      <manufacturer>TP-Link</manufacturer>
      <friendlyName>EX511</friendlyName>
      <modelName>EX511</modelName>
      <modelNumber>2.0</modelNumber>
      <modelDescription>AX3000 Dual-Band Wi-Fi 6 Router</modelDescription>

Logging in does NOT work yet, and the reason is recorded here so nobody spends a
second evening on it. The EX511's web UI returns `406 Not Acceptable` to every
path unless the `Accept` header matches what its own JavaScript sends, and the
scripts the login page references (`../js/tpEncrypt.js`) are not served at the
paths the page names. Establishing the login flow therefore means
reverse-engineering TP-Link's private RSA/AES handshake by probing a live
household gateway.

That is deliberately not done here, for two reasons:

  1. router_handshake.perform_handshake refuses unknown models before login
     precisely so we never experiment on a stranger's gateway. Doing it during
     development and calling it research does not make it safer.

  2. It would be a treadmill. TP-Link changes the login crypto between firmware
     revisions. An adapter built by reverse-engineering breaks on an overnight
     auto-update, in a customer's house, silently - and the failure mode is that
     protection stops applying while the box still says it is fine.

So identification ships, and the credentialed step is left to be built against a
unit whose owner is present. `identify()` returning a known model with
`login_supported=False` is what routes the customer to the guided flow instead -
which is a worse experience but an honest one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

from gateflame.router_handshake import RouterIdentity

# Read from the UPnP device description. Order matters: modelName is the precise
# one, friendlyName is what the vendor shows a human and is sometimes renamed.
_FIELDS = ("manufacturer", "modelName", "modelNumber", "friendlyName", "modelDescription")


def parse_upnp_description(xml: str) -> dict[str, str]:
    """Pull the vendor fields out of a UPnP device description.

    Tolerant by design: a truncated or namespaced document should yield whatever
    it does contain rather than raising. An unparseable router must degrade to
    'unknown model' - which is a refusal - not to an exception that takes the
    pairing flow down with it.
    """
    out: dict[str, str] = {}
    for field in _FIELDS:
        m = re.search(rf"<{field}>(.*?)</{field}>", xml, re.S | re.I)
        if m:
            value = m.group(1).strip()
            if value:
                out[field] = value
    return out


# Models whose credentialed handshake has been built AND exercised against real
# hardware. Empty is the correct current state, and it must stay honest: adding a
# model here without having driven it end to end turns a refusal into a silent
# failure in someone's house.
LOGIN_SUPPORTED_MODELS: frozenset[str] = frozenset()


@dataclass
class TPLinkAginetAdapter:
    """TP-Link Aginet / Archer family.

    `fetch` is injected so identification is testable without a router: it takes
    a URL and returns the body, or None.
    """

    fetch: Callable[[str], str | None]
    discover: Callable[[str], str | None] | None = None
    vendor: str = "tplink"

    def identify(self, address: str) -> RouterIdentity:
        location = None
        if self.discover is not None:
            location = self.discover(address)
        if not location:
            # The path is per-unit and randomised (…/jubzkc/gatedesc.xml on the
            # live unit), so it cannot be guessed - SSDP has to supply it.
            return RouterIdentity(address=address)

        body = self.fetch(location)
        if not body:
            return RouterIdentity(address=address)

        fields = parse_upnp_description(body)
        manufacturer = fields.get("manufacturer", "")
        if "tp-link" not in manufacturer.lower():
            # Not ours to handle. Say so rather than half-claiming it.
            return RouterIdentity(address=address)

        model = fields.get("modelName") or fields.get("friendlyName") or "unknown"
        return RouterIdentity(
            vendor="tplink",
            model=model,
            firmware=fields.get("modelNumber", "unknown"),
            address=address,
        )

    def login(self, address: str, username: str, password: str) -> object:
        raise NotImplementedError(
            "the TP-Link credentialed handshake is not built yet - see this "
            "module's docstring. Identification works; the login flow needs a "
            "unit whose owner is present."
        )

    def read_settings(self, session: object) -> dict[str, str]:
        raise NotImplementedError

    def write_settings(self, session: object, changes: dict[str, str]) -> None:
        raise NotImplementedError

    def logout(self, session: object) -> None:  # pragma: no cover - nothing to close
        return None


def login_supported(identity: RouterIdentity) -> bool:
    """Can we drive this model with credentials, or must the customer be guided?

    Keyed on the model, not the vendor. 'It is a TP-Link so it will probably
    work' is exactly the assumption that produces a box which claims to have
    configured a router it did not touch.
    """
    return identity.known and identity.model in LOGIN_SUPPORTED_MODELS
