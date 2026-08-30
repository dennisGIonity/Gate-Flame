"""Known public DNS-over-HTTPS / DNS-over-TLS endpoints, blocked at every level.

WHY THIS EXISTS

`threat_level.py` is the one dial a customer gets, and raising it trades more
blocking for more false-positive risk - that's a real choice, so it stays
theirs. This list is different in kind: a device that hardcodes a resolver
like `dns.google` or `cloudflare-dns.com` isn't making a content choice, it's
routing straight past Pi-hole entirely, silently un-doing whatever level the
household picked. Blocking the well-known DoH/DoT endpoints closes that hole
without touching the level dial - so it applies unconditionally, the same way
`content_categories` layers on top of the level rather than gating it.

This does not make the box a bypass-proof firewall. A device can still use an
DoH endpoint we don't yet know about, or DoT on a non-standard port we don't
filter at the DNS layer at all. It closes the common case - browsers and OSes
shipping with a short, well-known list of default DoH providers - cheaply and
with essentially zero false-positive risk, since nothing a household wants to
reach lives at these hostnames.

Source: compiled from the encrypted-DNS provider list documented in
dennisGIonity/PiHole-Ultimate-DNS-Firewall (surveyed 2026-08-30) plus the
providers Firefox and Chrome ship as built-in DoH options, since a
household's phones and PCs are the realistic bypass path, not just this one
repo's author's own setup.
"""

from __future__ import annotations

# Hostnames only - Pi-hole blocks these as exact/subdomain matches the same
# way it does any adlist domain. Not URLs, so no https:// prefix and no path.
BYPASS_DOMAINS: list[str] = [
    # Google Public DNS
    "dns.google",
    "dns.google.com",
    "8888.google",
    # Cloudflare
    "cloudflare-dns.com",
    "one.one.one.one",
    "mozilla.cloudflare-dns.com",
    # Quad9
    "dns.quad9.net",
    "dns9.quad9.net",
    "dns10.quad9.net",
    "dns11.quad9.net",
    # OpenDNS / Cisco
    "doh.opendns.com",
    "doh.familyshield.opendns.com",
    # NextDNS (per-user subdomains vary; the shared apex still catches the
    # default client config most devices ship with)
    "dns.nextdns.io",
    # AdGuard DNS
    "dns.adguard.com",
    "dns-family.adguard.com",
    "dns-unfiltered.adguard.com",
    # CleanBrowsing
    "doh.cleanbrowsing.org",
    # Comcast / Xfinity (some US devices default here)
    "doh.xfinity.com",
]


def desired_lines() -> list[str]:
    """Hostnames to add to Pi-hole's exact-domain denylist, unconditionally.

    Returned as plain hostnames, not a hosted list URL, because this list is
    short, curated here, and reviewed by us - not fetched from a third party
    like the threat-level and content-category lists are. `blocklists.py`
    wires this in via Pi-hole's domain-list API rather than the adlist API
    those use.
    """
    return list(BYPASS_DOMAINS)
