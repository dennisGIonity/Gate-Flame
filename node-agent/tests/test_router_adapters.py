# ========================================================================================
# GATE^FLAME - IDENTIFYING A ROUTER WITHOUT TOUCHING IT
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# The real UPnP description from the live unit on 2026-08-19 is used verbatim as
# the fixture. A synthetic fixture would have been tidier and would have proved
# nothing about the router actually in the house.
#
# What these guard: identification must never over-claim. A model we cannot drive
# with credentials has to route the customer to the guided flow, and the only way
# that stays true is if login support is keyed on the exact model rather than on
# "it is a TP-Link, it will probably work".
# ========================================================================================

from __future__ import annotations

import pytest

from gateflame.router_adapters import (
    LOGIN_SUPPORTED_MODELS,
    TPLinkAginetAdapter,
    login_supported,
    parse_upnp_description,
)
from gateflame.router_handshake import RouterIdentity, Secret, perform_handshake

# Verbatim from http://192.168.0.1:1900/jubzkc/gatedesc.xml
LIVE_EX511 = """<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
<device>
    <presentationURL>http://192.168.0.1:80/</presentationURL>
    <friendlyName>EX511</friendlyName>
    <manufacturer>TP-Link</manufacturer>
    <manufacturerURL>http://www.tp-link.com</manufacturerURL>
    <modelDescription>AX3000 Dual-Band Wi-Fi 6 Router</modelDescription>
    <modelName>EX511</modelName>
    <modelNumber>2.0</modelNumber>
    <serialNumber>1.0</serialNumber>
</device>
</root>"""

LOC = "http://192.168.0.1:1900/jubzkc/gatedesc.xml"


def adapter(body=LIVE_EX511, location=LOC):
    return TPLinkAginetAdapter(
        fetch=lambda url: body if url == location else None,
        discover=lambda addr: location,
    )


# ── 1. It reads the real router correctly ──────────────────────────────────


def test_the_live_router_is_identified_exactly():
    identity = adapter().identify("192.168.0.1")
    assert identity.vendor == "tplink"
    assert identity.model == "EX511"
    assert identity.firmware == "2.0"
    assert identity.known


def test_the_fields_come_out_of_the_real_description():
    fields = parse_upnp_description(LIVE_EX511)
    assert fields["manufacturer"] == "TP-Link"
    assert fields["modelName"] == "EX511"
    assert fields["modelDescription"] == "AX3000 Dual-Band Wi-Fi 6 Router"


# ── 2. It never over-claims ────────────────────────────────────────────────


def test_identifying_a_model_is_not_the_same_as_being_able_to_drive_it():
    """THE ONE THAT MATTERS.

    We know exactly what the EX511 is and we still cannot log into it. If
    login_supported ever returns True for a model whose handshake has not been
    exercised on hardware, the box will tell a customer it configured their
    router when it did not.
    """
    identity = adapter().identify("192.168.0.1")
    assert identity.known
    assert not login_supported(identity)


def test_the_supported_list_starts_empty_and_that_is_correct():
    assert LOGIN_SUPPORTED_MODELS == frozenset()


def test_an_unknown_model_is_never_login_supported():
    assert not login_supported(RouterIdentity(address="192.168.0.1"))


def test_a_non_tplink_router_is_not_claimed():
    other = """<root><device>
        <manufacturer>Huawei Technologies</manufacturer>
        <modelName>HG8245H</modelName>
    </device></root>"""
    identity = adapter(body=other).identify("192.168.0.1")
    assert not identity.known
    assert identity.vendor == "unknown"


# ── 3. It degrades instead of exploding ────────────────────────────────────


def test_no_ssdp_response_means_unknown_not_a_crash():
    """The description path is per-unit and randomised, so it cannot be guessed.
    No SSDP reply must mean 'unknown', never an exception in the pairing flow."""
    a = TPLinkAginetAdapter(fetch=lambda u: None, discover=lambda addr: None)
    assert not a.identify("192.168.0.1").known


def test_an_unreachable_description_url_means_unknown():
    a = TPLinkAginetAdapter(fetch=lambda u: None, discover=lambda addr: LOC)
    assert not a.identify("192.168.0.1").known


def test_a_truncated_description_does_not_raise():
    truncated = "<root><device><manufacturer>TP-Link</manufa"
    fields = parse_upnp_description(truncated)
    assert isinstance(fields, dict)


def test_an_empty_field_is_treated_as_absent():
    fields = parse_upnp_description("<modelName></modelName><manufacturer>TP-Link</manufacturer>")
    assert "modelName" not in fields
    assert fields["manufacturer"] == "TP-Link"


# ── 4. It plugs into the handshake safely ──────────────────────────────────


def test_the_handshake_refuses_before_login_when_login_is_unbuilt():
    """perform_handshake must not reach login() and hit NotImplementedError.

    It refuses unknown models before logging in. Here the model IS known, so the
    guard that matters is login_supported - which is why the caller checks it
    rather than discovering the gap by exception.
    """
    identity = adapter().identify("192.168.0.1")
    assert not login_supported(identity), (
        "if this becomes True, perform_handshake will call login() and raise - "
        "the caller must gate on login_supported first"
    )


def test_login_raises_with_an_explanation_rather_than_a_bare_error():
    with pytest.raises(NotImplementedError) as exc:
        adapter().login("192.168.0.1", "admin", "x")
    assert "not built yet" in str(exc.value)


def test_an_unknown_model_still_burns_the_password():
    """Belt and braces across module boundaries."""
    secret = Secret("hunter2")
    a = TPLinkAginetAdapter(fetch=lambda u: None, discover=lambda addr: None)
    result = perform_handshake(a, "192.168.0.1", "admin", secret, our_dns="192.168.0.10")
    assert secret.burned
    assert not result.ok
