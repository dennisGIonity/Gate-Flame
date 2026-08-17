"""Tests for the threat-level control.

This is the ONLY setting a customer can change, on a device sold to people with
no networking knowledge. So the invariants that matter are not really about
blocklists - they are about the control being impossible to misuse:

  - it is cumulative, so raising the level can never UNBLOCK something
  - a corrupt or unknown stored value degrades to protected, never to an
    exception or to unfiltered
  - the safest level is the default, because a box that breaks a streaming
    service on day one gets returned
"""

import pytest

from gateflame import threat_level as tl


def test_default_is_the_safest_level():
    """A new box must not break anything on day one."""
    assert tl.DEFAULT_LEVEL == "low"


def test_levels_are_cumulative():
    """Raising the level can only ever ADD blocking.

    If a higher level dropped a list, turning protection UP would let something
    through that was previously blocked - the opposite of what the customer
    asked for, and impossible to explain.
    """
    low = set(tl.lists_for("low"))
    medium = set(tl.lists_for("medium"))
    high = set(tl.lists_for("high"))

    assert low < medium, "medium must be a strict superset of low"
    assert medium < high, "high must be a strict superset of medium"


def test_each_level_adds_something():
    counts = [len(tl.lists_for(level)) for level in ("low", "medium", "high")]
    assert counts == sorted(counts), "list counts must not decrease as level rises"
    assert len(set(counts)) == 3, "every level must differ from its neighbours"


def test_low_still_blocks_something():
    """The safest setting is not 'off'. There is no off."""
    assert len(tl.lists_for("low")) >= 1


@pytest.mark.parametrize("bad", ["", "LOW", "extreme", "off", "none", "0", "null"])
def test_unknown_level_degrades_to_the_default_rather_than_raising(bad):
    """Reached from stored state, which can be corrupt or from an older build.

    An exception here would leave the box unfiltered - a crash in the blocklist
    path must never be the reason a household loses protection.
    """
    assert tl.lists_for(bad) == tl.lists_for(tl.DEFAULT_LEVEL)
    assert tl.describe(bad)["level"] == tl.DEFAULT_LEVEL


def test_none_is_handled():
    assert tl.lists_for(None) == tl.lists_for(tl.DEFAULT_LEVEL)


def test_no_threat_level_is_secretly_an_off_switch():
    """Filtering CAN be turned off - but not here, and never by accident.

    An earlier version of this test asserted filtering could not be disabled at
    all. That was the product deciding for its owner, and it was wrong: it is
    their network, and wanting DNS filtering off for ten minutes to find out
    whether the box broke a website is entirely reasonable.

    Disabling now lives in filtering_state, as an explicit, loudly-reported,
    auto-expiring pause. What must remain true HERE is narrower: choosing a
    threat LEVEL is choosing how much to block, and none of those choices - or
    any malformed value that lands in this function - may quietly mean 'none'.

    The distinction is between an owner deciding to stop filtering, which is
    theirs to make, and a stored value silently degrading into no protection,
    which is a bug.
    """
    for level in ("low", "medium", "high", "off", "", None, "disabled", "none"):
        assert len(tl.lists_for(level)) > 0, f"{level!r} produced no blocklists"


def test_every_level_is_described_for_the_customer():
    """The app renders these. A level with no explanation is a mystery switch."""
    for entry in tl.all_levels():
        assert entry["description"], f"{entry['level']} has no description"
        assert entry["blocklistCount"] > 0


def test_descriptions_warn_where_risk_is_real():
    """`high` may break sites. The customer must be told BEFORE choosing it."""
    high = tl.describe("high")["description"].lower()
    assert "break" in high or "may" in high, "high must carry a false-positive warning"


def test_all_levels_returns_them_in_order():
    assert [e["level"] for e in tl.all_levels()] == ["low", "medium", "high"]


def test_no_parental_control_lists_are_smuggled_in():
    """Adult-content and social-media blocking are political, not technical.

    They belong behind their own explicit setting, not hidden inside a security
    dial where a customer would enable them without realising.
    """
    everything = " ".join(tl.lists_for("high")).lower()
    for term in ("porn", "adult", "nsfw", "social", "gambling"):
        assert term not in everything, f"'{term}' list present in the security dial"


def test_all_urls_are_https():
    """These are fetched by the appliance on a schedule. Plain HTTP would let a
    network attacker choose what the box does and does not block."""
    for level in ("low", "medium", "high"):
        for url in tl.lists_for(level):
            assert url.startswith("https://"), f"non-HTTPS blocklist: {url}"


def test_no_duplicate_urls_across_levels():
    """A duplicate would make the cumulative subset assertions pass by accident."""
    urls = tl.lists_for("high")
    assert len(urls) == len(set(urls))
