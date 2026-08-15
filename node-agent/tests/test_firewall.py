"""Adversarial tests for module_firewall_bounce.

The first implementation of this module interpolated a caller-supplied IP
into an `nft` command, so a crafted path parameter could reach
`nft flush ruleset`. These tests exist primarily to prove that class of bug
is gone and cannot come back unnoticed — the injection corpus below is the
regression test for the actual historical defect, not a hypothetical.

The fake runner records every argv it is handed, so assertions can be made
about the exact command that *would* have run, without nftables, root, or a
network stack being present.
"""

from __future__ import annotations

import subprocess

import pytest

from gateflame import firewall as fw
from gateflame.firewall import (
    Firewall,
    FirewallRefusal,
    FirewallUnavailable,
    LocalContext,
)

OWN = "192.168.1.10"
GATEWAY = "192.168.1.1"
VICTIM = "192.168.1.55"


class FakeNft:
    """Records argv lists. Never executes anything."""

    available = True

    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.calls: list[list[str]] = []
        self.stdins: list[str | None] = []
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr

    def run(self, args, stdin_text=None):
        self.calls.append(list(args))
        self.stdins.append(stdin_text)
        return subprocess.CompletedProcess(
            args=args, returncode=self.returncode, stdout=self.stdout, stderr=self.stderr
        )

    @property
    def flat(self) -> str:
        """Every argument of every call, joined. Used to prove a string never
        reached nft in ANY position."""
        return " | ".join(" ".join(c) for c in self.calls)


def mutations(nft: FakeNft) -> list[list[str]]:
    """Calls that change state: the ruleset install and set-element edits.

    capability() legitimately probes `--version` and `list ruleset` first, so
    tests must select the call they mean rather than index into the sequence.
    """
    return [c for c in nft.calls if c[:1] in (["-f"], ["add"], ["delete"])]


def elements(nft: FakeNft) -> list[list[str]]:
    return [c for c in nft.calls if c[:1] in (["add"], ["delete"]) and "element" in c]


class Permissive(FakeNft):
    """Probes succeed; the mutating call returns `returncode`."""

    def run(self, args, stdin_text=None):
        self.calls.append(list(args))
        self.stdins.append(stdin_text)
        probing = args[:1] == ["--version"] or args[:2] == ["list", "ruleset"] or args[:1] == ["-f"]
        rc = 0 if probing else self.returncode
        return subprocess.CompletedProcess(args, rc, self.stdout, self.stderr)


def ctx() -> LocalContext:
    return LocalContext(own_addresses=frozenset({OWN}), gateways=frozenset({GATEWAY}))


def make(runner: FakeNft | None = None) -> tuple[Firewall, FakeNft]:
    nft = runner or FakeNft()
    return Firewall(runner=nft, context_provider=ctx), nft


# ── 1. Injection: the historical defect ────────────────────────────────────

INJECTION_CORPUS = [
    # The original shape: a trailing command after a valid-looking address.
    "192.168.1.55; nft flush ruleset",
    "192.168.1.55 && nft flush ruleset",
    "192.168.1.55 | nft flush ruleset",
    "192.168.1.55\nflush ruleset",
    "192.168.1.55\n\ndelete table inet gateflame",
    # Closing the element brace and starting a new nft statement — the shape
    # that matters most here, because this one needs no shell at all.
    "192.168.1.55 }; flush ruleset; add element inet gateflame bounced_v4 { 192.168.1.56",
    "192.168.1.55 timeout 1s }; delete table inet gateflame; #",
    # Command substitution, backticks, globs.
    "$(nft flush ruleset)",
    "`nft flush ruleset`",
    "192.168.1.*",
    # Null byte and control characters.
    "192.168.1.55\x00; flush ruleset",
    "192.168.1.55\r\nflush ruleset",
    # Argument smuggling: trying to become a separate nft flag.
    "--help",
    "-f /etc/passwd",
    "; -f -",
    # Non-strings and empties.
    "",
    "   ",
    "x" * 500,
]


@pytest.mark.parametrize("payload", INJECTION_CORPUS)
def test_injection_payloads_are_refused_before_nft_is_touched(payload):
    f, nft = make()
    with pytest.raises(FirewallRefusal) as exc:
        f.bounce(payload)
    assert exc.value.reason == "invalid_address"
    # The critical assertion: nft was never invoked at all. Validation
    # happens before any subprocess exists, so there is no window.
    assert nft.calls == []


@pytest.mark.parametrize("payload", INJECTION_CORPUS)
def test_injection_payloads_never_appear_in_any_argv(payload):
    """Belt and braces: even if a future refactor let a payload past the
    refusal, prove the raw text never reaches nft in any argument."""
    f, nft = make()
    try:
        f.bounce(payload)
    except (FirewallRefusal, FirewallUnavailable):
        pass
    assert "flush" not in nft.flat
    assert "/etc/passwd" not in nft.flat


@pytest.mark.parametrize("bad", [None, 42, 3.14, [], {}, object(), b"192.168.1.55"])
def test_non_string_addresses_are_refused(bad):
    f, nft = make()
    with pytest.raises(FirewallRefusal) as exc:
        f.bounce(bad)
    assert exc.value.reason == "invalid_address"
    assert nft.calls == []


def test_error_message_does_not_echo_attacker_input():
    """An error string ends up in logs, the kiosk console and the phone UI.
    Echoing caller text back into it just moves the injection target."""
    f, _ = make()
    payload = "192.168.1.55; nft flush ruleset"
    with pytest.raises(FirewallRefusal) as exc:
        f.bounce(payload)
    assert payload not in str(exc.value)
    assert payload not in exc.value.advisory


# ── 2. Deny-by-default on what may be bounced ──────────────────────────────


@pytest.mark.parametrize(
    "address,reason",
    [
        ("127.0.0.1", "refused_loopback"),
        ("::1", "refused_loopback"),
        ("224.0.0.1", "refused_multicast"),
        ("ff02::1", "refused_multicast"),
        ("0.0.0.0", "refused_unspecified"),
        ("::", "refused_unspecified"),
        ("8.8.8.8", "refused_not_lan"),
        ("1.1.1.1", "refused_not_lan"),
        ("2606:4700:4700::1111", "refused_not_lan"),
        (OWN, "refused_self"),
        (GATEWAY, "refused_gateway"),
    ],
)
def test_dangerous_targets_are_refused(address, reason):
    f, nft = make()
    with pytest.raises(FirewallRefusal) as exc:
        f.bounce(address)
    assert exc.value.reason == reason
    assert nft.calls == []


def test_bouncing_the_gateway_is_refused_even_though_it_is_a_valid_lan_host():
    """The gateway passes every syntactic and RFC1918 check. Refusing it is
    a product decision — it is the single address whose bounce takes the
    entire customer network offline, including the phone issuing the call."""
    f, _ = make()
    with pytest.raises(FirewallRefusal) as exc:
        f.bounce(GATEWAY)
    assert "whole network offline" in exc.value.advisory


# ── 3. The happy path produces exactly one, exactly correct, argv ──────────


def test_bounce_emits_expected_argv():
    f, nft = make()
    result = f.bounce(VICTIM, 600)
    assert result == {"address": VICTIM, "seconds": 600}
    assert mutations(nft)[0] == ["-f", "-"]
    assert elements(nft)[0] == [
        "add",
        "element",
        "inet",
        "gateflame",
        "bounced_v4",
        "{ 192.168.1.55 timeout 600s }",
    ]


def test_ipv6_targets_go_to_the_v6_set():
    f, nft = make()
    f.bounce("fd00::5", 60)
    assert elements(nft)[0][4] == "bounced_v6"
    assert elements(nft)[0][5] == "{ fd00::5 timeout 60s }"


def test_address_is_canonicalised_not_passed_through():
    """The value handed to nft is the stdlib's rendering of a parsed object,
    so equivalent spellings converge and caller text stops existing."""
    f, nft = make()
    f.bounce("fd00:0000:0000:0000:0000:0000:0000:0005", 60)
    assert "fd00::5" in elements(nft)[0][5]


def test_release_emits_expected_argv():
    f, nft = make()
    f.release(VICTIM)
    assert elements(nft)[0] == [
        "delete",
        "element",
        "inet",
        "gateflame",
        "bounced_v4",
        "{ 192.168.1.55 }",
    ]


def test_releasing_an_unbounced_host_is_not_an_error():
    """The caller's intent is 'this host must not be bounced'. If it already
    is not, that intent is satisfied — and an element may have expired in the
    kernel a moment earlier through no fault of anyone."""
    f, _ = make(Permissive(returncode=1, stderr="No such file or directory"))
    assert f.release(VICTIM) == {"address": VICTIM, "released": False}


# ── 4. Every bounce expires ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "requested,expected",
    [
        (0, fw.MIN_SECONDS),
        (-99999, fw.MIN_SECONDS),
        (1, fw.MIN_SECONDS),
        (600, 600),
        (10**9, fw.MAX_SECONDS),
    ],
)
def test_duration_is_clamped(requested, expected):
    f, nft = make()
    assert f.bounce(VICTIM, requested)["seconds"] == expected
    assert f"timeout {expected}s" in elements(nft)[0][5]


def test_there_is_no_way_to_express_a_permanent_bounce():
    """Every code path that adds an element goes through _clamp_seconds, so
    an element without a timeout cannot be constructed through this API."""
    f, nft = make()
    for value in (0, -1, 10**12, fw.MAX_SECONDS + 1):
        nft.calls.clear()
        f.bounce(VICTIM, value)
        element = elements(nft)[-1][5]
        assert "timeout" in element
        seconds = int(element.split("timeout ")[1].split("s")[0])
        assert fw.MIN_SECONDS <= seconds <= fw.MAX_SECONDS


@pytest.mark.parametrize("bad", [None, "600", 6.5, True, False])
def test_non_integer_durations_are_refused(bad):
    f, nft = make()
    with pytest.raises(FirewallRefusal) as exc:
        f.bounce(VICTIM, bad)
    assert exc.value.reason == "invalid_duration"
    assert nft.calls == []


# ── 5. The ruleset is a constant ───────────────────────────────────────────


def test_ruleset_contains_no_interpolation_markers():
    assert "{}" not in fw._RULESET
    assert "%s" not in fw._RULESET
    assert "$" not in fw._RULESET
    assert "format(" not in fw._RULESET


def test_ruleset_is_policy_accept_so_a_failure_cannot_black_hole_the_lan():
    """If every other assumption in this module is wrong, the failure mode
    must be 'the bouncer does nothing', never 'the network goes dark'."""
    assert "policy accept" in fw._RULESET
    assert "policy drop" not in fw._RULESET


def test_ruleset_drops_both_directions():
    for line in ("ip saddr @bounced_v4", "ip daddr @bounced_v4",
                 "ip6 saddr @bounced_v6", "ip6 daddr @bounced_v6"):
        assert line in fw._RULESET


def test_install_passes_the_constant_on_stdin_not_as_an_argument():
    f, nft = make()
    f.ensure_installed()
    assert mutations(nft)[-1] == ["-f", "-"]
    assert fw._RULESET in nft.stdins


def test_ruleset_is_installed_only_once():
    f, nft = make()
    f.bounce(VICTIM)
    f.bounce("192.168.1.56")
    assert nft.calls.count(["-f", "-"]) == 1


# ── 6. Capability is reported honestly ─────────────────────────────────────


def test_no_nft_binary_reports_a_named_gap_not_a_crash():
    class NoNft(FakeNft):
        available = False

    f, _ = make(NoNft())
    usable, gap = f.capability()
    assert usable is False
    assert "nftables" in gap


def test_no_cap_net_admin_reports_the_remedy():
    class Denied(FakeNft):
        def run(self, args, stdin_text=None):
            self.calls.append(list(args))
            rc = 0 if args[:1] == ["--version"] else 1
            return subprocess.CompletedProcess(args, rc, "", "Operation not permitted")

    f, _ = make(Denied())
    usable, gap = f.capability()
    assert usable is False
    assert "CAP_NET_ADMIN" in gap
    assert "never run as root" in gap


def test_capability_never_raises():
    class Exploding(FakeNft):
        def run(self, args, stdin_text=None):
            raise OSError("boom")

    f, _ = make(Exploding())
    usable, gap = f.capability()
    assert usable is False
    assert "boom" in gap


def test_bounce_without_capability_refuses_rather_than_pretending():
    class Denied(FakeNft):
        def run(self, args, stdin_text=None):
            self.calls.append(list(args))
            rc = 0 if args[:1] == ["--version"] else 1
            return subprocess.CompletedProcess(args, rc, "", "Operation not permitted")

    f, _ = make(Denied())
    with pytest.raises(FirewallUnavailable):
        f.bounce(VICTIM)


# ── 7. Discovery fails closed ──────────────────────────────────────────────


def test_discovery_failure_refuses_rather_than_leaving_the_gateway_unprotected():
    """An empty protected-set would silently make 'never bounce the gateway'
    stop being true. Refusing to bounce anything is the safe direction."""

    def broken_context():
        raise FirewallUnavailable("cannot enumerate local addresses")

    f = Firewall(runner=FakeNft(), context_provider=broken_context)
    with pytest.raises(FirewallUnavailable):
        f.bounce(VICTIM)


def test_teardown_removes_the_table():
    f, nft = make()
    f.bounce(VICTIM)
    f.teardown()
    assert nft.calls[-1] == ["delete", "table", "inet", "gateflame"]


def test_teardown_lets_the_ruleset_be_reinstalled():
    f, nft = make()
    f.ensure_installed()
    f.teardown()
    f.ensure_installed()
    assert nft.calls.count(["-f", "-"]) == 2


# ── 8. Reading the live set ────────────────────────────────────────────────


def test_bounced_reads_from_the_kernel():
    payload = (
        '{"nftables":[{"set":{"elem":['
        '{"elem":{"val":"192.168.1.55","expires":420}},'
        '"192.168.1.56"'
        "]}}]}"
    )
    f, _ = make(FakeNft(stdout=payload))
    found = f.bounced()
    assert {"address": "192.168.1.55", "expiresInSeconds": 420} in found
    assert {"address": "192.168.1.56", "expiresInSeconds": None} in found


@pytest.mark.parametrize("garbage", ["", "not json", "{}", '{"nftables":"wrong type"}', "null"])
def test_unparseable_nft_output_degrades_to_empty_not_an_exception(garbage):
    """This feeds a read-only status route. It must never throw."""
    f, _ = make(FakeNft(stdout=garbage))
    assert f.bounced() == []


def test_bounced_returns_empty_when_the_firewall_is_unavailable():
    class NoNft(FakeNft):
        available = False

    f, _ = make(NoNft())
    assert f.bounced() == []


# ── 9. No shell, ever ──────────────────────────────────────────────────────


def test_module_never_enables_a_shell():
    """A grep-level guard. If someone adds shell=True or os.system in a
    future edit, this fails immediately and says why."""
    import pathlib

    source = pathlib.Path(fw.__file__).read_text()
    assert "shell=True" not in source
    assert "os.system" not in source
    assert "os.popen" not in source
    # subprocess.run appears exactly once, in _run_argv.
    assert source.count("subprocess.run(") == 1  # only in _run_argv


def test_the_single_subprocess_call_sets_shell_false_explicitly():
    import pathlib

    source = pathlib.Path(fw.__file__).read_text()
    assert "shell=False" in source
    assert "timeout=_NFT_TIMEOUT_SECONDS" in source


# ── 10. Refusal ordering ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "address,reason",
    [
        ("8.8.8.8", "refused_not_lan"),
        ("127.0.0.1", "refused_loopback"),
        ("224.0.0.1", "refused_multicast"),
        ("0.0.0.0", "refused_unspecified"),
    ],
)
def test_context_free_refusals_beat_a_failing_discovery(address, reason):
    """Local context discovery fails CLOSED, so if it ran first every one of
    these would answer 'cannot identify the gateway' on a host without the
    `ip` binary. Both refuse — but only one tells the caller what is actually
    wrong with their request."""

    def broken_context():
        raise FirewallUnavailable("cannot identify the gateway")

    f = Firewall(runner=FakeNft(), context_provider=broken_context)
    with pytest.raises(FirewallRefusal) as exc:
        f.bounce(address)
    assert exc.value.reason == reason


def test_a_lan_address_still_fails_closed_when_discovery_is_broken():
    """The safety property survives the reordering: a plausible LAN target
    cannot be bounced while the gateway is unknown."""

    def broken_context():
        raise FirewallUnavailable("cannot identify the gateway")

    f = Firewall(runner=FakeNft(), context_provider=broken_context)
    with pytest.raises(FirewallUnavailable):
        f.bounce(VICTIM)
