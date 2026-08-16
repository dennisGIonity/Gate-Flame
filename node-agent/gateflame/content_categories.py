"""Content categories - opt-in filtering that is a preference, not a threat.

WHY THIS IS SEPARATE FROM threat_level

The threat dial (low / medium / high) is about DANGER. Every list behind it
blocks something actively hostile to the household: malware, phishing,
command-and-control, tracking. Nobody has to be asked whether they want less
malware.

These categories are different. Adult content and gambling are not attacking
anyone. Blocking them is a household's choice about what belongs on their
network, and reasonable households answer differently. Burying that choice
inside a security dial would mean a customer sliding to "high" for better
malware protection and silently losing access to legal sites they never asked
to block - and being unable to work out why.

So: two axes, two questions, both explicit.

    threat_level   how much DANGER do you want blocked?   (always on, 3 levels)
    categories     what CONTENT do you want blocked?      (all off by default)

DEFAULT OFF, ALWAYS

Every category ships disabled. A box that silently blocked legal content out of
the carton would be making a moral decision on the owner's behalf and would be
indistinguishable, from the inside, from a fault.

NAMING

Each category states plainly what it blocks and what it can break. A customer
turning one on should not be surprised afterwards - "Social Media" that also
blocks WhatsApp is a support call.
"""

from __future__ import annotations

CategoryId = str

CATEGORIES: dict[CategoryId, dict] = {
    "adult": {
        "label": "Adult content",
        "description": "Blocks pornography and explicit sites.",
        "caution": None,
        "lists": [
            "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts",
        ],
    },
    "gambling": {
        "label": "Gambling",
        "description": "Blocks online casinos, betting and lottery sites.",
        "caution": None,
        "lists": [
            "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/gambling-only/hosts",
        ],
    },
    "social": {
        "label": "Social media",
        "description": "Blocks social networks.",
        # Said out loud because it is the single most common cause of "the box
        # broke my phone". Meta's messaging shares domains with its social
        # products, so blocking one blocks the other.
        "caution": "Also blocks WhatsApp and Messenger, which share domains with Facebook.",
        "lists": [
            "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/social-only/hosts",
        ],
    },
    "fakenews": {
        "label": "Misinformation sites",
        "description": "Blocks sites widely identified as publishing fabricated news.",
        # An honest caution: unlike malware, this list encodes an editorial
        # judgement made by its maintainers, and the customer is adopting that
        # judgement by enabling it. Say so rather than implying it is objective.
        "caution": "This list reflects its maintainers' editorial judgement, not a technical measurement.",
        "lists": [
            "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-only/hosts",
        ],
    },
}

# Everything off. The customer opts in, one category at a time.
DEFAULT_ENABLED: list[CategoryId] = []


def known(category_id: CategoryId) -> bool:
    return category_id in CATEGORIES


def lists_for(enabled: list[CategoryId] | None) -> list[str]:
    """Blocklist URLs for the enabled categories.

    Unknown ids are ignored rather than raising. This is reached from stored
    state that may predate a rename or come from an older build, and a bad
    value must not take the filtering path down with it.
    """
    if not enabled:
        return []
    urls: list[str] = []
    for category_id in enabled:
        entry = CATEGORIES.get(category_id)
        if entry:
            urls.extend(entry["lists"])
    # Deduplicate while preserving order - two categories could legitimately
    # share a source later.
    seen: set[str] = set()
    return [u for u in urls if not (u in seen or seen.add(u))]


def describe_all(enabled: list[CategoryId] | None = None) -> list[dict]:
    """Every category with its current state, for the app and the display.

    Returns them in a fixed order so the control does not reshuffle itself
    between renders.
    """
    active = set(enabled or [])
    return [
        {
            "id": category_id,
            "label": entry["label"],
            "description": entry["description"],
            "caution": entry["caution"],
            "enabled": category_id in active,
        }
        for category_id, entry in CATEGORIES.items()
    ]


def sanitise(enabled: list[CategoryId] | None) -> list[CategoryId]:
    """Drop unknown ids and duplicates, preserving order.

    Used before persisting, so stored state never accumulates ids that no
    longer mean anything.
    """
    if not enabled:
        return []
    seen: set[CategoryId] = set()
    return [
        c for c in enabled
        if known(c) and not (c in seen or seen.add(c))
    ]
