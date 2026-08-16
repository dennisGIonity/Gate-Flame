"""Filtering state - whether protection is on, and if not, why and until when.

WHY THIS EXISTS SEPARATELY FROM threat_level

An earlier version made filtering impossible to disable. A test asserted it,
and the reasoning felt sound: a security appliance that can be switched off is
a security appliance that will be switched off and forgotten.

That was the product deciding for its owner. It is their network, they paid for
the box, and there are entirely legitimate reasons to want filtering off for a
while:

  - a site is broken and they need to know whether the box is the cause
  - a work VPN or captive portal fights with DNS filtering
  - they are debugging their own network
  - they simply want it off

Refusing that does not keep anyone safer. It makes the box a suspect whenever
anything on the network misbehaves, and the customer's only remaining option is
to unplug it - which loses the filtering AND the telemetry AND leaves the
household with no DNS at all until they change the router back.

So filtering can be paused. The design work is in making it safe rather than
in forbidding it:

  PAUSED IS LOUD.      Every surface reports protection OFF while it lasts. The
                       product must never look like it is working when it isn't.

  PAUSED IS TEMPORARY  by default. Almost every real reason to pause is a
                       five-minute diagnostic, so the durations are short and
                       the box resumes on its own. Forgetting to re-enable is
                       the actual risk, and an auto-resume removes it.

  INDEFINITE IS        available, because "until I say otherwise" is a real
  POSSIBLE             need - but it is a deliberate separate choice, not the
                       default, and it survives reboot so the box does not
                       quietly re-enable something the owner turned off.

  THE LEVEL IS         Pausing does not reset the threat level or the content
  REMEMBERED           categories. Resuming restores exactly what they had.

This mirrors what Pi-hole itself does, and for the same reason: the people who
built the thing found that users needed it.
"""

from __future__ import annotations

import time
from typing import Literal

PauseDuration = Literal["5m", "30m", "2h", "until_reboot", "indefinite"]

# Seconds. `indefinite` and `until_reboot` are not durations and are handled
# separately - see resume_at().
DURATION_SECONDS: dict[str, int] = {
    "5m": 5 * 60,
    "30m": 30 * 60,
    "2h": 2 * 60 * 60,
}

DURATION_LABELS: dict[str, str] = {
    "5m": "5 minutes",
    "30m": "30 minutes",
    "2h": "2 hours",
    "until_reboot": "Until the box restarts",
    "indefinite": "Until I turn it back on",
}

# Offered in this order. Short first, because the common case is a quick
# diagnostic and the dangerous case is the one nobody comes back from.
DURATION_ORDER: list[PauseDuration] = ["5m", "30m", "2h", "until_reboot", "indefinite"]

DEFAULT_DURATION: PauseDuration = "5m"


def valid_duration(duration: str | None) -> bool:
    return duration in DURATION_LABELS


def resume_at(duration: str, now: float | None = None) -> float | None:
    """Unix time when filtering should resume, or None if it should not.

    None means 'no scheduled resume' - both `indefinite` and `until_reboot`
    return it. They differ in persistence, not in scheduling: `until_reboot` is
    held in memory only, so a restart clears it; `indefinite` is written to
    storage and survives.
    """
    if duration in DURATION_SECONDS:
        return (now if now is not None else time.time()) + DURATION_SECONDS[duration]
    return None


def is_expired(resume_time: float | None, now: float | None = None) -> bool:
    """True when a timed pause has run out and filtering should resume itself."""
    if resume_time is None:
        return False
    return (now if now is not None else time.time()) >= resume_time


def seconds_remaining(resume_time: float | None, now: float | None = None) -> int | None:
    """Seconds until auto-resume, for a countdown. None when there is no timer.

    Never negative - an expired pause reads as 0 rather than as a negative
    number a UI would have to special-case.
    """
    if resume_time is None:
        return None
    remaining = resume_time - (now if now is not None else time.time())
    return max(0, int(remaining))


def describe(
    *,
    enabled: bool,
    duration: str | None = None,
    resume_time: float | None = None,
    reason: str | None = None,
    now: float | None = None,
) -> dict:
    """The full protection state, for the app, the display and the API.

    `protectionStatus` is the field every surface should render from. It has
    three values and they are deliberately blunt:

        active   filtering, household protected
        paused   OFF because the OWNER asked - their choice, clearly shown
        bypass   OFF because the box FAILED - see dns-watchdog.sh

    'paused' and 'bypass' are both unprotected, and both must look unprotected.
    They are distinguished because the remedy differs completely: one is a
    button the owner presses, the other is a fault.
    """
    if enabled:
        return {
            "protectionStatus": "active",
            "enabled": True,
            "pausedUntil": None,
            "secondsRemaining": None,
            "durationLabel": None,
            "reason": None,
        }

    return {
        "protectionStatus": "paused",
        "enabled": False,
        "pausedUntil": resume_time,
        "secondsRemaining": seconds_remaining(resume_time, now),
        "durationLabel": DURATION_LABELS.get(duration or "", "Unknown"),
        # Free text the owner may have typed, echoed back so a household member
        # who finds it off can see why rather than assuming a fault.
        "reason": reason,
    }


def all_durations() -> list[dict]:
    """Every pause option, for rendering the control."""
    return [
        {
            "id": duration,
            "label": DURATION_LABELS[duration],
            # Flagged so the UI can style it differently and ask once more.
            # Not forbidden - just not something to tap through by accident.
            "requiresConfirmation": duration in ("until_reboot", "indefinite"),
        }
        for duration in DURATION_ORDER
    ]
