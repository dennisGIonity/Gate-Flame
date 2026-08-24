# ========================================================================================
# GATE^FLAME - THE BOX CONFIGURES THE ROUTER, AND FORGETS THE PASSWORD
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# We are asking a customer to type their router's admin password into our app.
# That is a large thing to ask and it is only defensible if four properties hold
# absolutely, on every path, including the ones nobody anticipated:
#
#   1. The password dies. Always. Success, failure, or an exception from a
#      vendor library we have never seen.
#   2. It cannot be logged. Log lines and tracebacks call str()/repr() on
#      whatever they are handed - that is exactly how this project put an API
#      key into fourteen files and two zip archives.
#   3. We change two settings and nothing else, on someone else's equipment.
#   4. We never claim success without re-reading. "Saved" is a claim by the
#      router. A household believed its DNS cutover was done for days while the
#      router quietly answered from its own upstream.
# ========================================================================================

from __future__ import annotations

import pytest

from gateflame.router_handshake import (
    SETTING_IPV6_RA_DNS,
    SETTING_UPSTREAM_DNS,
    CredentialLeak,
    RouterIdentity,
    Secret,
    perform_handshake,
)


class FakeRouter:
    """A router that behaves, unless told otherwise."""

    vendor = "fake"

    def __init__(self, settings=None, *, known=True, persist=True, fail_on=None):
        self.settings = settings if settings is not None else {
            SETTING_UPSTREAM_DNS: "192.168.0.1",
            SETTING_IPV6_RA_DNS: "self",
        }
        self.known = known
        self.persist = persist
        self.fail_on = fail_on
        self.seen_password = None
        self.logged_out = False
        self.writes = []

    def identify(self, address):
        if not self.known:
            return RouterIdentity(address=address)
        return RouterIdentity(vendor="fake", model="FK-1", firmware="1.0", address=address)

    def login(self, address, username, password):
        if self.fail_on == "login":
            raise ConnectionError("nope")
        self.seen_password = password
        return {"session": "s1"}

    def read_settings(self, session):
        return dict(self.settings)

    def write_settings(self, session, changes):
        if self.fail_on == "write":
            raise RuntimeError("device busy")
        self.writes.append(dict(changes))
        if self.persist:
            self.settings.update(changes)

    def logout(self, session):
        self.logged_out = True


def run(router, password="hunter2", **kw):
    kw.setdefault("our_dns", "192.168.0.10")
    return perform_handshake(
        router, "192.168.0.1", "admin", Secret(password), **kw
    )


# ── 1. The password dies, on every path ────────────────────────────────────


@pytest.mark.parametrize(
    "router",
    [
        FakeRouter(),                       # success
        FakeRouter(persist=False),          # router silently discards the write
        FakeRouter(fail_on="login"),        # cannot get in
        FakeRouter(fail_on="write"),        # blows up mid-change
        FakeRouter(known=False),            # refused before login
    ],
    ids=["success", "not-persisted", "login-fails", "write-raises", "unknown-model"],
)
def test_the_password_is_burned_on_every_path(router):
    secret = Secret("hunter2")
    perform_handshake(router, "192.168.0.1", "admin", secret, our_dns="192.168.0.10")
    assert secret.burned
    with pytest.raises(CredentialLeak):
        secret.reveal()


def test_a_secret_cannot_be_logged_or_formatted_into_a_string():
    """The single most common way a credential escapes."""
    secret = Secret("hunter2")
    assert "hunter2" not in str(secret)
    assert "hunter2" not in repr(secret)
    assert "hunter2" not in f"{secret}"
    assert "hunter2" not in "password={}".format(secret)
    assert "hunter2" not in f"login failed for {secret!r}"


def test_a_burned_secret_cannot_be_quietly_reused():
    """Re-prompt the customer rather than silently sending an empty password."""
    secret = Secret("hunter2")
    secret.burn()
    with pytest.raises(CredentialLeak):
        secret.reveal()


def test_burn_is_idempotent_so_finally_blocks_are_safe():
    secret = Secret("hunter2")
    secret.burn()
    secret.burn()
    assert secret.burned


def test_the_password_reaches_the_adapter_exactly_once_and_unmodified():
    """The guardrails must not break the actual job."""
    router = FakeRouter()
    run(router, password="p@ss w0rd!")
    assert router.seen_password == "p@ss w0rd!"


# ── 2. Never claim success without evidence ────────────────────────────────


def test_a_router_that_accepts_a_setting_and_discards_it_is_caught():
    """THE FAULT THAT WAS ACTUALLY IN THE FIELD.

    The household's router took the DNS setting, said nothing, and kept
    answering from its own upstream for days. 'Saved' is a claim; a read-back is
    evidence. Without this test the product repeats that failure at scale.
    """
    router = FakeRouter(persist=False)
    result = run(router)
    assert not result.ok
    assert not result.verified
    assert any("not persisted" in d for d in result.detail)
    assert "did not keep it" in result.message


def test_a_successful_handshake_is_verified_by_re_reading():
    router = FakeRouter()
    result = run(router)
    assert result.ok and result.verified
    assert router.settings[SETTING_UPSTREAM_DNS] == "192.168.0.10"
    assert router.settings[SETTING_IPV6_RA_DNS] == "disabled"


def test_an_already_correct_router_is_left_completely_alone():
    router = FakeRouter(
        settings={SETTING_UPSTREAM_DNS: "192.168.0.10", SETTING_IPV6_RA_DNS: "disabled"}
    )
    result = run(router)
    assert result.ok and result.verified
    assert router.writes == [], "nothing should have been written"
    assert "already set up correctly" in result.message


# ── 3. Restraint on someone else's equipment ───────────────────────────────


def test_an_unrecognised_router_is_never_experimented_on():
    """Guessing endpoints on a stranger's gateway takes a household offline."""
    router = FakeRouter(known=False)
    result = run(router)
    assert not result.ok
    assert router.writes == []
    assert router.seen_password is None, "we must not even log in to an unknown model"
    assert "did not change anything" in result.message


def test_only_the_two_agreed_settings_are_ever_written():
    router = FakeRouter()
    run(router)
    for write in router.writes:
        assert set(write) <= {SETTING_UPSTREAM_DNS, SETTING_IPV6_RA_DNS}


def test_ipv6_advertisement_can_be_left_alone_when_asked():
    router = FakeRouter()
    run(router, disable_ipv6_ra_dns=False)
    for write in router.writes:
        assert SETTING_IPV6_RA_DNS not in write


# ── 4. Uninstall must mean uninstall ───────────────────────────────────────


def test_every_change_can_be_put_back_exactly():
    """A security appliance that permanently alters someone's router with no way
    home is not acceptable. Factory reset has to be able to undo this."""
    router = FakeRouter(settings={SETTING_UPSTREAM_DNS: "8.8.8.8", SETTING_IPV6_RA_DNS: "self"})
    result = run(router)
    assert result.ok

    plan = {c.setting: c for c in result.rollback_plan}
    assert plan[SETTING_UPSTREAM_DNS].now == "8.8.8.8"
    assert plan[SETTING_IPV6_RA_DNS].now == "self"
    assert len(result.rollback_plan) == len(result.applied)


def test_a_partial_failure_still_reports_what_was_changed():
    """If we changed something and then failed, uninstall still has to know."""
    router = FakeRouter(persist=False)
    result = run(router)
    assert not result.ok
    assert result.applied, "a failed verify must not erase the record of the write"


# ── 5. Failure is reported without leaking the request ─────────────────────


def test_an_adapter_exception_never_puts_its_text_in_the_result():
    """Router libraries habitually echo the failing request - credentials and
    all - back in the exception message. Only the type is recorded."""
    class Chatty(FakeRouter):
        def login(self, address, username, password):
            raise ValueError(f"POST failed: user={username}&pass={password}")

    result = run(Chatty(), password="hunter2")
    assert not result.ok
    blob = " ".join(result.detail) + result.message
    assert "hunter2" not in blob
    assert "ValueError" in blob


def test_the_session_is_closed_even_when_the_handshake_fails():
    router = FakeRouter(fail_on="write")
    run(router)
    assert router.logged_out


def test_a_failing_logout_does_not_mask_a_successful_result():
    class BadLogout(FakeRouter):
        def logout(self, session):
            raise OSError("connection reset")

    assert run(BadLogout()).ok


def test_customer_messages_carry_no_jargon():
    """These appear in a pairing wizard, not a terminal."""
    banned = ("RDNSS", "DNS server on LAN", "OID", "JSESSIONID", "adapter", "session")
    for router in (FakeRouter(), FakeRouter(persist=False), FakeRouter(known=False)):
        message = run(router).message
        for word in banned:
            assert word not in message, f"jargon leaked to the customer: {message}"
