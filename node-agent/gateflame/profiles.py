"""Owner profiles and accessibility preferences, persisted under `.DUMP/profiles/`.

A PROFILE is a named bundle of the two filtering choices the box already
exposes - threat level (threat_level.py) and content categories
(content_categories.py) - so a household can say "Family" once instead of
setting five toggles. Applying a profile writes those two settings through the
same `Store` methods the individual controls use and then triggers the same
`blocklists.apply_async`, so a profile can never put the box in a state the
individual controls could not. There is no third source of truth.

Four presets ship. A fifth, "custom", is whatever the owner last set by hand;
it is recorded automatically whenever the individual controls diverge from
every preset, so the picker never shows a preset as selected when it is not.

ACCESSIBILITY preferences are per-surface display settings - reduced motion,
high contrast, larger text, screen-reader hints - stored on the box so the
wall panel remembers them across a reboot (the panel has no browser profile
worth relying on). The phone keeps its own copy locally and may mirror it
here. These never affect filtering.

Both files are plain JSON, written atomically (temp + rename) so a power cut
mid-write - weekly, here - leaves the previous file intact rather than a
truncated one.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from . import content_categories, datadir, threat_level

PRESETS: dict[str, dict[str, Any]] = {
    "standard": {
        "label": "Standard",
        "description": "Trackers, ads and malware blocked. Nothing legal is filtered.",
        "threatLevel": "low",
        "categories": [],
    },
    "family": {
        "label": "Family",
        "description": "Standard, plus adult content and gambling blocked for every device.",
        "threatLevel": "medium",
        "categories": ["adult", "gambling"],
    },
    "strict": {
        "label": "Strict",
        "description": "Every threat list, plus adult, gambling and social media.",
        "threatLevel": "high",
        "categories": ["adult", "gambling", "social"],
    },
    "focus": {
        "label": "Focus",
        "description": "Standard threat protection with social media off. Nothing else changes.",
        "threatLevel": "low",
        "categories": ["social"],
    },
}

CUSTOM_ID = "custom"

ACCESSIBILITY_DEFAULTS: dict[str, Any] = {
    # Honoured by the splash and every motion component. The UI ALSO reads
    # prefers-reduced-motion from the OS; this is the box-side override so the
    # wall panel can be set once by the owner.
    "reducedMotion": False,
    "highContrast": False,
    # 1.0 = default. The kiosk clamps to 0.8-1.6; the phone to 0.9-1.4.
    "textScale": 1.0,
    # Extra spoken/visible labels on icon-only controls.
    "verboseLabels": False,
    # Kiosk only: keep the screen from dimming while someone is reading it.
    "keepAwakeMinutes": 0,
    "updatedAt": 0,
}

_ACTIVE_FILE = "active.json"
_ACCESS_FILE = "accessibility.json"


# ---------------------------------------------------------------------------
# file helpers
# ---------------------------------------------------------------------------

def _read_json(p: str, default: dict) -> dict:
    try:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return dict(default)


def _write_json(p: str, data: dict) -> bool:
    """Atomic write. Returns False (never raises) when the root is unwritable."""
    tmp = f"{p}.tmp-{os.getpid()}"
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, p)
        return True
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return False


# ---------------------------------------------------------------------------
# profiles
# ---------------------------------------------------------------------------

def match_preset(threat: str, categories: list[str]) -> str:
    """Which preset the given settings equal, or CUSTOM_ID when none does."""
    cats = sorted(content_categories.sanitise(categories))
    for pid, preset in PRESETS.items():
        if preset["threatLevel"] == threat and sorted(preset["categories"]) == cats:
            return pid
    return CUSTOM_ID


def describe(settings: dict) -> dict:
    """The profile payload for the API, computed from the live filter settings.

    `settings` is `Store.get_filter_settings()`. The active profile is DERIVED
    from what the box is actually doing, not read back from a file - so if
    someone changes a category through the individual control, the picker
    moves to "custom" on the next read instead of lying that "Family" is on.
    """
    threat = settings["threat_level"]
    cats = list(settings["categories"])
    active = match_preset(threat, cats)
    stored = _read_json(datadir.path("profiles", _ACTIVE_FILE), {})
    return {
        "active": active,
        "activeLabel": PRESETS[active]["label"] if active in PRESETS else "Custom",
        "threatLevel": threat,
        "categories": cats,
        "appliedAt": stored.get("appliedAt"),
        "appliedBy": stored.get("appliedBy"),
        "presets": [
            {
                "id": pid,
                **preset,
                "threatLevelDescription": threat_level.describe(preset["threatLevel"])["description"],
                "blocklistCount": threat_level.describe(preset["threatLevel"])["blocklistCount"],
            }
            for pid, preset in PRESETS.items()
        ],
        "storageWritable": datadir.status()["subdirs"]["profiles"]["writable"],
    }


def valid(profile_id: str) -> bool:
    return profile_id in PRESETS


def settings_for(profile_id: str) -> tuple[str, list[str]]:
    """(threat_level, categories) a preset resolves to. Raises KeyError if unknown."""
    preset = PRESETS[profile_id]
    return preset["threatLevel"], list(preset["categories"])


def record_applied(profile_id: str, applied_by: str | None) -> bool:
    """Remember who applied which preset and when. Informational only."""
    return _write_json(
        datadir.path("profiles", _ACTIVE_FILE),
        {"profile": profile_id, "appliedAt": time.time(), "appliedBy": applied_by},
    )


# ---------------------------------------------------------------------------
# accessibility
# ---------------------------------------------------------------------------

_TEXT_SCALE_MIN, _TEXT_SCALE_MAX = 0.8, 1.6
_KEEP_AWAKE_MAX = 240


def get_accessibility() -> dict:
    data = _read_json(datadir.path("profiles", _ACCESS_FILE), ACCESSIBILITY_DEFAULTS)
    # Fill any key a newer agent added since the file was written.
    return {**ACCESSIBILITY_DEFAULTS, **data}


def validate_accessibility(patch: dict) -> dict:
    """Coerce and bound an incoming patch. Unknown keys are dropped, not stored."""
    out: dict[str, Any] = {}
    for key in ("reducedMotion", "highContrast", "verboseLabels"):
        if key in patch:
            out[key] = bool(patch[key])
    if "textScale" in patch:
        try:
            v = float(patch["textScale"])
        except (TypeError, ValueError):
            raise ValueError("textScale must be a number")
        out["textScale"] = round(min(_TEXT_SCALE_MAX, max(_TEXT_SCALE_MIN, v)), 2)
    if "keepAwakeMinutes" in patch:
        try:
            m = int(patch["keepAwakeMinutes"])
        except (TypeError, ValueError):
            raise ValueError("keepAwakeMinutes must be an integer")
        out["keepAwakeMinutes"] = min(_KEEP_AWAKE_MAX, max(0, m))
    return out


def set_accessibility(patch: dict) -> tuple[dict, bool]:
    """Merge a validated patch into the stored prefs. Returns (prefs, persisted)."""
    current = get_accessibility()
    merged = {**current, **validate_accessibility(patch), "updatedAt": time.time()}
    ok = _write_json(datadir.path("profiles", _ACCESS_FILE), merged)
    return merged, ok
