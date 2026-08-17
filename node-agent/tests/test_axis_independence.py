"""The two axes are independent. This file exists to keep them that way.

THE CLAIM

Choosing not to block a category of legal content must not reduce protection
from ads, trackers, malware or phishing - including ON that content.

Someone who leaves the adult category off is not asking for a less safe
internet. They are asking for one specific list not to be applied. Adult sites
are, if anything, unusually heavy with trackers and malvertising, so quietly
giving them less protection would be the exact opposite of what they chose -
and they would have no way to discover it.

The same holds in reverse: enabling a content category must not smuggle in
extra threat blocking, or the threat dial stops meaning anything and "medium"
protects two households differently depending on unrelated preferences.

WHY A WHOLE FILE FOR THIS

It is currently true because threat lists and category lists are disjoint sets
and `desired_lists` unions them. That is easy to break later - by adopting one
of the combined upstream lists (StevenBlack publishes unified+porn variants
that would collapse both axes into one), or by "tidying" the two code paths
into one. Both would look like cleanups and neither would fail an existing
test.

So the property gets its own tests, named after the promise rather than the
implementation.
"""

import pytest

from gateflame import blocklists
from gateflame import content_categories as cc
from gateflame import threat_level as tl


ALL_CATEGORIES = list(cc.CATEGORIES)
LEVELS = ["low", "medium", "high"]


def settings(level="low", categories=None, enabled=True):
    return {"enabled": enabled, "threat_level": level, "categories": categories or []}


# ------------------------------------------------------- threat is unconditional


@pytest.mark.parametrize("level", LEVELS)
def test_threat_lists_apply_with_no_categories_enabled(level):
    """The default box - every category off - still gets full threat blocking."""
    urls = set(blocklists.desired_lists(settings(level, [])))
    assert set(tl.lists_for(level)) <= urls


@pytest.mark.parametrize("level", LEVELS)
def test_threat_lists_apply_with_every_category_enabled(level):
    urls = set(blocklists.desired_lists(settings(level, ALL_CATEGORIES)))
    assert set(tl.lists_for(level)) <= urls


@pytest.mark.parametrize("level", LEVELS)
@pytest.mark.parametrize("category", ALL_CATEGORIES)
def test_turning_one_category_off_removes_no_threat_protection(level, category):
    """THE test this file is named for.

    Declining to block adult content must not cost you the malware list. Runs
    for every category at every level, because the promise is unconditional.
    """
    others = [c for c in ALL_CATEGORIES if c != category]

    with_it = set(blocklists.desired_lists(settings(level, ALL_CATEGORIES)))
    without_it = set(blocklists.desired_lists(settings(level, others)))

    threat = set(tl.lists_for(level))
    assert threat <= with_it
    assert threat <= without_it, (
        f"disabling '{category}' removed threat protection at level '{level}'"
    )
    # The ONLY difference is that category's own lists.
    assert with_it - without_it == set(cc.CATEGORIES[category]["lists"])


def test_the_difference_between_all_and_no_categories_is_only_content():
    """Nothing in the threat set moves when categories change, in either
    direction."""
    for level in LEVELS:
        none_on = set(blocklists.desired_lists(settings(level, [])))
        all_on = set(blocklists.desired_lists(settings(level, ALL_CATEGORIES)))
        assert none_on <= all_on
        assert all_on - none_on == set(cc.lists_for(ALL_CATEGORIES))


# ------------------------------------------------------- content is unconditional


@pytest.mark.parametrize("category", ALL_CATEGORIES)
def test_a_category_blocks_the_same_at_every_threat_level(category):
    """'Block gambling' must mean the same thing on low as on high.

    Otherwise the two controls are secretly coupled and the customer cannot
    reason about either.
    """
    per_level = {
        level: set(blocklists.desired_lists(settings(level, [category])))
                - set(tl.lists_for(level))
        for level in LEVELS
    }
    assert len(set(map(frozenset, per_level.values()))) == 1, (
        f"'{category}' blocks differently depending on threat level: {per_level}"
    )


@pytest.mark.parametrize("level", LEVELS)
def test_raising_the_threat_level_enables_no_content_category(level):
    """Sliding to 'high' for better malware protection must not silently start
    blocking legal sites."""
    urls = set(blocklists.desired_lists(settings(level, [])))
    for category, entry in cc.CATEGORIES.items():
        for list_url in entry["lists"]:
            assert list_url not in urls, (
                f"threat level '{level}' pulled in the '{category}' list"
            )


# ------------------------------------------------------------- no shared sources


def test_the_two_axes_share_no_list_url():
    """A shared URL would couple them silently: removing a category would try
    to delete a list the threat dial still needs, and set arithmetic in
    apply() would get it wrong in one direction or the other."""
    assert set(tl.lists_for("high")).isdisjoint(set(cc.lists_for(ALL_CATEGORIES)))


def test_no_combined_upstream_list_is_used():
    """StevenBlack publishes unified+porn, unified+gambling and similar
    combined variants. Adopting one would collapse both axes into a single
    control and silently block legal content for everybody.

    Threat lists must not name a content category in their path.
    """
    for url in tl.lists_for("high"):
        tail = url.rsplit("/", 2)[-2:]
        joined = "/".join(tail).lower()
        for term in ("porn", "gambling", "social", "fakenews", "adult"):
            assert term not in joined, (
                f"threat list appears to be a combined variant: {url}"
            )


def test_category_lists_are_single_purpose():
    """Each category must use an '-only' style list, not a combined one that
    would drag in another category the owner did not choose."""
    for category, entry in cc.CATEGORIES.items():
        others = [c for c in ALL_CATEGORIES if c != category]
        for url in entry["lists"]:
            lowered = url.lower()
            for other in others:
                assert f"{other}-only" not in lowered, (
                    f"'{category}' list also covers '{other}': {url}"
                )


# ---------------------------------------------------------------------- pause


def test_pausing_removes_everything_from_both_axes():
    """A pause is unfiltered, and it must be honest about that rather than
    leaving one axis quietly running."""
    urls = blocklists.desired_lists(settings("high", ALL_CATEGORIES, enabled=False))
    assert urls == []


def test_resuming_restores_both_axes_exactly():
    before = blocklists.desired_lists(settings("medium", ["adult"], enabled=True))
    blocklists.desired_lists(settings("medium", ["adult"], enabled=False))
    after = blocklists.desired_lists(settings("medium", ["adult"], enabled=True))
    assert before == after
