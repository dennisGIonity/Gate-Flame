"""Tests for content categories.

The invariants here are mostly about CONSENT rather than correctness. These
lists block legal content, so the product's obligation is that nothing is
blocked unless the household asked for it, and that they knew what they were
asking for.
"""

import pytest

from gateflame import content_categories as cc
from gateflame import threat_level as tl


def test_everything_is_off_by_default():
    """A box out of the carton must not block legal content.

    Doing so would be making a moral decision on the owner's behalf, and from
    the inside it is indistinguishable from a fault.
    """
    assert cc.DEFAULT_ENABLED == []
    assert cc.lists_for(cc.DEFAULT_ENABLED) == []
    assert all(not c["enabled"] for c in cc.describe_all())


def test_the_two_axes_never_overlap():
    """The threat dial must not contain content lists, and vice versa.

    This is the whole reason the module exists: a customer raising protection
    against MALWARE must never silently lose access to legal sites.
    """
    threat_urls = set(tl.lists_for("high"))
    content_urls = set(cc.lists_for(list(cc.CATEGORIES)))
    assert threat_urls.isdisjoint(content_urls)


def test_no_content_category_leaks_into_the_threat_dial():
    everything = " ".join(tl.lists_for("high")).lower()
    for term in ("porn", "adult", "gambling", "social", "fakenews"):
        assert term not in everything, f"'{term}' found in the security dial"


@pytest.mark.parametrize("category_id", list(cc.CATEGORIES))
def test_every_category_is_explained(category_id):
    """A switch with no explanation is a mystery switch."""
    entry = cc.CATEGORIES[category_id]
    assert entry["label"]
    assert entry["description"]
    assert entry["lists"], f"{category_id} enables nothing"


def test_categories_that_break_things_say_so():
    """Social blocks WhatsApp. If we do not say it, we get the support call."""
    social = cc.CATEGORIES["social"]
    assert social["caution"], "social must warn about collateral blocking"
    assert "whatsapp" in social["caution"].lower()


def test_misinformation_category_admits_it_is_a_judgement():
    """Unlike malware, this list encodes an editorial position. Say so."""
    caution = cc.CATEGORIES["fakenews"]["caution"] or ""
    assert "judgement" in caution.lower() or "judgment" in caution.lower()


def test_enabling_one_category_does_not_enable_another():
    urls = cc.lists_for(["adult"])
    assert urls == cc.CATEGORIES["adult"]["lists"]
    assert set(urls).isdisjoint(cc.CATEGORIES["gambling"]["lists"])


def test_enabled_categories_are_reported_accurately():
    described = {c["id"]: c["enabled"] for c in cc.describe_all(["gambling"])}
    assert described["gambling"] is True
    assert described["adult"] is False


@pytest.mark.parametrize("bad", [None, [], ["nonsense"], ["ADULT"], [""], ["adult", "nope"]])
def test_unknown_ids_are_ignored_not_fatal(bad):
    """Reached from stored state that may predate a rename.

    A bad value must not take the filtering path down with it.
    """
    urls = cc.lists_for(bad)
    assert isinstance(urls, list)
    for url in urls:
        assert url.startswith("https://")


def test_unknown_ids_never_enable_anything():
    assert cc.lists_for(["nonsense", "ADULT", ""]) == []


def test_sanitise_drops_unknown_and_duplicates_preserving_order():
    assert cc.sanitise(["gambling", "nope", "adult", "gambling"]) == ["gambling", "adult"]
    assert cc.sanitise(None) == []


def test_all_urls_are_https():
    """Fetched by the appliance on a schedule. Plain HTTP would let a network
    attacker choose what the box blocks."""
    for url in cc.lists_for(list(cc.CATEGORIES)):
        assert url.startswith("https://"), url


def test_describe_all_is_stable_in_order():
    """The control must not reshuffle itself between renders."""
    first = [c["id"] for c in cc.describe_all()]
    second = [c["id"] for c in cc.describe_all(["adult"])]
    assert first == second


def test_no_category_can_be_forced_on():
    """There is no 'always enabled' flag anywhere. Every one is opt-in."""
    for entry in cc.CATEGORIES.values():
        assert "forced" not in entry
        assert entry.get("default_enabled") in (None, False)
