"""The one-time router handshake: the box configures the router, not the customer.

WHY THIS EXISTS

Gate^Flame is a side-car. It never carries household traffic, which is the whole
performance guarantee - nothing it does can slow the connection down. But a
side-car cannot COMPEL a device to use it. On a real household network measured
on 2026-08-18 the router advertised itself as the IPv6 DNS server, so every phone
asked the router and nothing we did could change that. Advertising ourselves does
not help: RDNSS has no preference field, and clients simply keep every server
they are told about.

So exactly one setting on the router has to change, exactly once, ever. The
choice is who does it. Making the customer do it turns a product into a support
article, so the box does it: the app asks for the router's admin password during
pairing, the box logs in, changes the minimum, verifies it took, and forgets the
password.

THE RULES THIS MODULE ENFORCES

  1. The password is never written to disk, never logged, never in a repr, and
     is overwritten in memory the moment the handshake ends - success or
     failure. This project has already leaked one API key into fourteen files
     and two zip archives. A customer's router password is worse.

  2. Change the minimum and nothing else. Two settings: the LAN DNS server, and
     the router's IPv6 DNS advertisement. We are a guest on someone's network.

  3. NEVER report success without re-reading. A router web UI that says "saved"
     and did not save is the single most common failure in this class, and it is
     precisely what happened here - the DNS cutover was believed done for days
     while the router was still answering from its own upstream.

  4. Everything changed is recorded so it can be put back. A security appliance
     that permanently alters someone's router with no way home is not
     acceptable, and uninstall has to mean uninstall.

  5. An unknown router model is a refusal, not a guess. Poking unknown endpoints
     on someone's gateway to see what happens is how you brick a household's
     internet. Unknown models fall back to the guided screenshot flow.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class CredentialLeak(Exception):
    """Raised when something tries to persist or render a secret."""


class Secret:
    """A password that resists being written down.

    Python cannot truly zero a str - the interpreter may have interned or copied
    it - so this holds a bytearray, which CAN be overwritten in place, and
    refuses to render itself in the two places secrets actually escape from:
    log lines and exception tracebacks. Both of those call repr()/str() on
    whatever they are handed, which is exactly how the Gemini key ended up in
    fourteen files.

    This is not cryptography. It is a guardrail against the ordinary accident.
    """

    __slots__ = ("_buf", "_burned")

    def __init__(self, value: str) -> None:
        self._buf = bytearray(value.encode("utf-8"))
        self._burned = False

    def __repr__(self) -> str:  # pragma: no cover - trivially delegated
        return self.__str__()

    def __str__(self) -> str:
        return "<Secret: redacted>"

    def __format__(self, spec: str) -> str:
        return self.__str__()

    def reveal(self) -> str:
        """The only way out. Call as late as possible, keep the result briefly."""
        if self._burned:
            raise CredentialLeak("this secret was already burned - re-prompt the customer")
        return self._buf.decode("utf-8")

    def burn(self) -> None:
        """Overwrite in place. Idempotent, so `finally:` blocks are safe."""
        for i in range(len(self._buf)):
            self._buf[i] = 0
        self._buf = bytearray()
        self._burned = True

    @property
    def burned(self) -> bool:
        return self._burned

    def __enter__(self) -> "Secret":
        return self

    def __exit__(self, *exc) -> None:
        self.burn()


# The only two things we are ever allowed to touch. Anything outside this set is
# a bug, and the handshake asserts it rather than trusting the adapter author.
#
# UPSTREAM, NOT LAN. This was `lan_dns` until the architecture decision of
# 2026-08-24, and the old name described the wrong field.
#
# We change where the ROUTER forwards its queries. We deliberately do NOT change
# what the router hands to devices over DHCP - devices keep asking the router,
# and the router asks us. That one distinction is what makes "unplug the box and
# nothing breaks" structurally true: the router falls back to its own resolver
# the instant we stop answering, because nothing was taken away from it.
#
# Point devices straight at us instead and this box becomes a single point of
# failure for the whole household - which, on a South African power grid, fails
# weekly. See docs/ADR-001-DNS-AUTHORITY-MODEL.md.
SETTING_UPSTREAM_DNS = "upstream_dns"
SETTING_IPV6_RA_DNS = "ipv6_ra_dns"
PERMITTED_SETTINGS = frozenset({SETTING_UPSTREAM_DNS, SETTING_IPV6_RA_DNS})


@dataclass(frozen=True)
class RouterIdentity:
    vendor: str = "unknown"
    model: str = "unknown"
    firmware: str = "unknown"
    address: str = ""

    @property
    def known(self) -> bool:
        return self.vendor != "unknown" and self.model != "unknown"


@dataclass(frozen=True)
class Change:
    """One setting, with the value needed to put it back."""

    setting: str
    was: str
    now: str


@dataclass
class HandshakeResult:
    identity: RouterIdentity
    applied: tuple[Change, ...] = ()
    verified: bool = False
    ok: bool = False
    # Plain English, shown to the customer. No vendor jargon, no blame.
    message: str = ""
    # Engineering detail. Never rendered in the app.
    detail: tuple[str, ...] = field(default_factory=tuple)

    @property
    def rollback_plan(self) -> tuple[Change, ...]:
        """Exactly what uninstall has to undo, in reverse order of application."""
        return tuple(
            Change(setting=c.setting, was=c.now, now=c.was) for c in reversed(self.applied)
        )


class RouterAdapter(Protocol):
    """What every vendor adapter must provide.

    Deliberately small. An adapter that needs more than this is doing something
    to the customer's router that we have not agreed to do.
    """

    vendor: str

    def identify(self, address: str) -> RouterIdentity: ...
    def login(self, address: str, username: str, password: str) -> object: ...
    def read_settings(self, session: object) -> dict[str, str]: ...
    def write_settings(self, session: object, changes: dict[str, str]) -> None: ...
    def logout(self, session: object) -> None: ...


def perform_handshake(
    adapter: RouterAdapter,
    address: str,
    username: str,
    password: Secret,
    *,
    our_dns: str,
    disable_ipv6_ra_dns: bool = True,
) -> HandshakeResult:
    """Log in, change the minimum, prove it took, and forget the password.

    The password is burned in a `finally:` so it dies on every path out of this
    function - success, failure, exception, or an adapter that raises something
    nobody anticipated.
    """
    identity = adapter.identify(address)
    detail: list[str] = [f"adapter={adapter.vendor} identified={identity.model}"]

    if not identity.known:
        # Refuse rather than experiment. Guessing endpoints on a stranger's
        # gateway is how a household loses its internet at 22:00 on a Sunday.
        password.burn()
        return HandshakeResult(
            identity=identity,
            message=(
                "Gate^Flame could not recognise this router, so it did not change "
                "anything. It will show you the one setting to change instead."
            ),
            detail=tuple(detail + ["unknown model - refusing to write; fall back to guided flow"]),
        )

    session = None
    applied: list[Change] = []
    try:
        session = adapter.login(address, username, password.reveal())
        before = adapter.read_settings(session)

        wanted: dict[str, str] = {}
        if before.get(SETTING_UPSTREAM_DNS) != our_dns:
            wanted[SETTING_UPSTREAM_DNS] = our_dns
        if disable_ipv6_ra_dns and before.get(SETTING_IPV6_RA_DNS) not in ("", "disabled", None):
            wanted[SETTING_IPV6_RA_DNS] = "disabled"

        if not wanted:
            return HandshakeResult(
                identity=identity,
                verified=True,
                ok=True,
                message="Your router was already set up correctly. Nothing was changed.",
                detail=tuple(detail + ["no changes required"]),
            )

        # An adapter that tries to write anything else is a bug, and a bug here
        # means we altered a customer's router in a way we never disclosed.
        stray = set(wanted) - PERMITTED_SETTINGS
        if stray:
            raise CredentialLeak(f"refusing to write settings outside the agreed set: {stray}")

        adapter.write_settings(session, wanted)
        applied = [
            Change(setting=k, was=before.get(k, ""), now=v) for k, v in wanted.items()
        ]

        # RE-READ. This is the whole point of the function.
        #
        # The 2026-08-18 household believed its router had been pointed at the
        # box for days. It had not. The web UI accepted the setting and kept
        # answering from its own upstream, and nothing anywhere disagreed.
        # "Saved" is a claim by the router; only a re-read is evidence.
        after = adapter.read_settings(session)
        mismatched = {k: (v, after.get(k)) for k, v in wanted.items() if after.get(k) != v}

        if mismatched:
            return HandshakeResult(
                identity=identity,
                applied=tuple(applied),
                verified=False,
                ok=False,
                message=(
                    "Gate^Flame changed a setting on your router but the router did "
                    "not keep it. Nothing is broken - protection is just not active "
                    "for every device yet."
                ),
                detail=tuple(
                    detail
                    + [f"write not persisted: {k} wanted={w!r} readback={r!r}" for k, (w, r) in mismatched.items()]
                ),
            )

        return HandshakeResult(
            identity=identity,
            applied=tuple(applied),
            verified=True,
            ok=True,
            message=(
                "Your router now sends every device to Gate^Flame for protection. "
                "This was a one-time change and your password was not kept."
            ),
            detail=tuple(detail + [f"verified {len(applied)} change(s) by read-back"]),
        )

    except CredentialLeak:
        raise
    except Exception as exc:  # noqa: BLE001 - the reason is reported, not swallowed
        return HandshakeResult(
            identity=identity,
            applied=tuple(applied),
            verified=False,
            ok=False,
            message=(
                "Gate^Flame could not finish setting up your router. It will show "
                "you the one setting to change instead."
            ),
            # The exception type, never its text: router libraries have a habit
            # of echoing the request - credentials included - back in the message.
            detail=tuple(detail + [f"handshake failed: {type(exc).__name__}"]),
        )
    finally:
        # Every path. Including the ones nobody thought of.
        password.burn()
        if session is not None:
            try:
                adapter.logout(session)
            except Exception:  # noqa: BLE001 - a failed logout must not mask the result
                pass
