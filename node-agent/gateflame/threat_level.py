"""Threat level - the single control a customer is given.

WHY ONLY ONE CONTROL

Gate^Flame is sold retail to people with no networking knowledge. Every
additional switch is a way for someone to break their own internet and then
call support. So there is exactly one setting, it has three positions, and
none of them can leave the network unprotected or unusable.

WHAT EACH LEVEL MEANS

The level selects which blocklists are active. Higher levels block more and
carry more risk of a false positive - a site the household actually wanted.
That trade-off is the whole reason this is a user decision rather than a
constant.

    low      Ads and trackers only. The safest setting: essentially zero
             chance of breaking a site someone needs. This is the default,
             because a box that breaks Netflix on day one gets returned.

    medium   The above, plus malware and phishing domains. Real security
             value, still very low false-positive risk - these lists contain
             domains that are actively hostile, not merely annoying.

    high     The above, plus aggressive tracking, telemetry and known-shady
             TLDs. Blocks the most; will occasionally break something. For
             households that want it and can tolerate the odd site failing.

Deliberately NOT offered: adult-content or social-media blocking. Those are
parental-control features, they are political rather than technical, and they
belong behind their own explicit setting - not smuggled into a security dial.

LIST SOURCES

Every list is a public, well-maintained blocklist with a stable URL. They are
fetched by Pi-hole, not by us, and never vendored into this repo - their
licences govern redistribution and we have no need to take on that question.

2026-08-30: added zachlagden/Pi-hole-Optimized-Blocklists (Unlicense - public
domain, redistribution is fine) alongside the existing sources at each level,
same category, broader coverage - not a replacement, since the incumbent lists
each cover slightly different ground. Deliberately NOT using
dennisGIonity/Pi-hole-Optimized-Blocklists (the org's own fork): it is roughly
ten months behind upstream and stored via Git LFS, which a plain clone or
fetch cannot read past pointer stubs anyway - point at the maintained repo
directly. Deliberately NOT including that repo's nsfw.txt at any level, same
reason `content_categories.py` keeps adult-content blocking out of this dial
entirely: it is a parental-control choice, not a security one.
"""

from __future__ import annotations

from typing import Literal

ThreatLevel = Literal["low", "medium", "high"]

DEFAULT_LEVEL: ThreatLevel = "low"

# Ordered lowest to highest. Each level INCLUDES every list from the levels
# below it - the dial is cumulative, not a set of alternatives, so raising it
# can never unblock something that was blocked before.
LEVEL_LISTS: dict[ThreatLevel, list[str]] = {
    "low": [
        # StevenBlack unified: the de-facto standard ads + trackers list.
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
        # zachlagden/Pi-hole-Optimized-Blocklists, ads + tracking categories -
        # broader coverage than StevenBlack alone, same low-risk category.
        "https://media.githubusercontent.com/media/zachlagden/Pi-hole-Optimized-Blocklists/refs/heads/main/lists/advertising.txt",
        "https://media.githubusercontent.com/media/zachlagden/Pi-hole-Optimized-Blocklists/refs/heads/main/lists/tracking.txt",
    ],
    "medium": [
        # Phishing domains, updated continuously.
        "https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-domains-ACTIVE.txt",
        # Malware command-and-control and distribution domains.
        "https://urlhaus.abuse.ch/downloads/hostfile/",
        # zachlagden/Pi-hole-Optimized-Blocklists, malicious category - broader
        # malware coverage, same category as the two lists above.
        "https://media.githubusercontent.com/media/zachlagden/Pi-hole-Optimized-Blocklists/refs/heads/main/lists/malicious.txt",
    ],
    "high": [
        # Aggressive tracking and telemetry - higher false-positive risk.
        "https://raw.githubusercontent.com/crazy-max/WindowsSpyBlocker/master/data/hosts/spy.txt",
        # Additional advertising and tracking coverage.
        "https://adaway.org/hosts.txt",
        # zachlagden/Pi-hole-Optimized-Blocklists, suspicious category - their
        # own "aggressive" tier, matching this level's higher-risk posture.
        "https://media.githubusercontent.com/media/zachlagden/Pi-hole-Optimized-Blocklists/refs/heads/main/lists/suspicious.txt",
    ],
}

LEVEL_DESCRIPTIONS: dict[ThreatLevel, str] = {
    "low": "Blocks ads and trackers. Safest - very unlikely to break a website.",
    "medium": "Adds malware and phishing protection. Recommended for most homes.",
    "high": "Adds aggressive tracking and telemetry blocking. May occasionally break a site.",
}


def lists_for(level: ThreatLevel) -> list[str]:
    """Every blocklist URL active at `level`, cumulative from `low` upward.

    An unknown level falls back to the default rather than raising. This is
    called on a path that can be reached from stored state, and a corrupt or
    old value must degrade to "protected but conservative", never to an
    exception that leaves the box unfiltered.
    """
    order: list[ThreatLevel] = ["low", "medium", "high"]
    if level not in order:
        level = DEFAULT_LEVEL

    urls: list[str] = []
    for step in order:
        urls.extend(LEVEL_LISTS[step])
        if step == level:
            break
    return urls


def describe(level: ThreatLevel) -> dict:
    """Level plus its human explanation and list count, for the app and display."""
    if level not in LEVEL_DESCRIPTIONS:
        level = DEFAULT_LEVEL
    return {
        "level": level,
        "description": LEVEL_DESCRIPTIONS[level],
        "blocklistCount": len(lists_for(level)),
    }


def all_levels() -> list[dict]:
    """Every level, for rendering the control. Ordered low to high."""
    return [describe(level) for level in ("low", "medium", "high")]
