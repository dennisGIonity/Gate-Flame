"""How much of the network this box takes, and why.

THE PROBLEM THIS SOLVES

Gate^Flame is plugged into a network it does not own, configured by someone
else, often badly. On 2026-08-18 a live household lost mobile connectivity for
days while every check the box ran on itself passed. The router advertised IPv6
with itself as DNS server on a LAN with no IPv6 route to the internet; phones
prefer IPv6, so they asked the router (unfiltered), stalled on every AAAA, and
dropped the Wi-Fi. The box was blameless and useless at the same time.

The instinct is to write that up as a support instruction - "turn IPv6 off on
your router". That is not a product. A customer who can be told to reconfigure
their router did not need us.

So the box fixes it. This module decides how far it is allowed to go.

THE THREE TIERS

  HEAL   Changes only this box. Suppress AAAA, bind another socket, turn off a
         rate limit, rebind a lost listener. Invisible to every other device,
         instantly reversible, costs nothing. Always automatic.

  OFFER  Adds something to the network that is standard and additive - a Router
         Advertisement naming this box as a DNS server. Other devices see it,
         but nothing is taken away from them and nothing is impersonated. Safe
         to do automatically; it cannot break a device that ignores it.

  CLAIM  Takes the gateway. The box answers ARP for the router's address, so
         clients send it their traffic and it forwards what it does not filter.
         Nothing on the router is ever touched, which is the only way to be
         genuinely plug-and-play on an unknown router.

         This is the one with a real price. Once clients send everything to us
         we are routing the entire household, so it is gated on two things that
         are NOT negotiable:

           1. Headroom. A Pi 5 forwards at line rate on part of one core. An
              Orange Pi Zero 2W has no wired uplink - routing a house through a
              single Wi-Fi radio halves its throughput and adds latency to every
              packet. Claiming on that board makes the product worse than not
              being there, which fails the only rule that matters.

           2. A PROVEN fail-safe. If we claim the gateway and then die, every
              client keeps sending traffic to a MAC address that no longer
              answers, and the house is offline until ARP entries expire -
              minutes, not seconds. A claim without a tested withdrawal is not a
              feature, it is an outage with extra steps.

WHAT THIS MODULE IS NOT

It does not touch the network. It observes facts and returns a plan. Deciding
and doing are separate so the decision can be tested exhaustively without a
LAN, and so a bad decision can never be a side effect of reading the state.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field

# Ordered weakest to strongest. A tier is only reached if the box can pay for it.
TIER_HEAL = "heal"
TIER_OFFER = "offer"
TIER_CLAIM = "claim"

TIER_ORDER = (TIER_HEAL, TIER_OFFER, TIER_CLAIM)

# Forwarding the whole household needs a wired uplink with real headroom.
#
# The number is deliberately conservative. It is not "can this board move
# packets" - a Zero 2W can move packets - it is "can this board move the
# household's packets without the customer noticing that it is in the way". The
# moment a customer can feel us, we have broken the only rule.
MIN_FORWARDING_MBIT = 500


@dataclass(frozen=True)
class NetworkFacts:
    """What was observed. No judgements, no derived state."""

    lan_ip: str | None = None
    # (interface, cidr) for every global IPv4 address on this box.
    lan_addresses: tuple[tuple[str, str], ...] = ()
    gateway_ip: str | None = None
    # True  = the router forwards DNS to us (a blocked name came back blocked)
    # False = the router answered from its own upstream
    # None  = not determined; never treat unknown as either
    gateway_forwards_to_us: bool | None = None

    ipv6_global_addresses: tuple[str, ...] = ()
    ipv6_default_route: bool = False
    # RDNSS servers seen advertised on the wire, whoever sent them.
    ra_dns_servers: tuple[str, ...] = ()
    our_ipv6_lan_address: str | None = None
    serves_dns_on_ipv6: bool = False
    aaaa_suppressed: bool = False

    rate_limit_count: int | None = None
    loopback_listener_ok: bool = True
    lan_listener_ok: bool = True


# The product split, and it is a hard line, not a marketing one.
#
# STANDARD is a side-car. It sits beside the network and never carries the
# household's traffic. That is not a limitation to be apologised for - it is the
# guarantee. Nothing it does can make the connection slower, because nothing
# flows through it. It wins by making the network FASTER than not having it:
# a warm local cache answers in under a millisecond where the ISP resolver takes
# twenty to forty, and every blocked tracker is a request the device never makes
# and a response it never downloads.
#
# PREMIUM carries traffic and can therefore inspect and block things DNS cannot
# reach. It also owns the risk that comes with being in the path.
#
# A standard box must never reach TIER_CLAIM, no matter how fast its uplink is.
# Capability is not permission.
PRODUCT_STANDARD = "standard"
PRODUCT_PREMIUM = "premium"


@dataclass(frozen=True)
class Capabilities:
    """What this box can afford, and what it is allowed to spend it on."""

    product: str = PRODUCT_STANDARD
    uplink_kind: str = "unknown"          # "wired" | "wireless" | "unknown"
    uplink_mbit: int | None = None
    # Has the withdrawal path been exercised on THIS unit? Not "is it written".
    failsafe_proven: bool = False

    @property
    def can_forward_household(self) -> bool:
        if self.uplink_kind != "wired":
            return False
        if self.uplink_mbit is None:
            # Unknown speed on a wired link is still unknown. Refuse.
            return False
        return self.uplink_mbit >= MIN_FORWARDING_MBIT

    @property
    def max_tier(self) -> str:
        """The strongest tier this box may ever reach.

        Three conditions, and all three are required:

          product  - a standard box is a side-car by definition. It stops at
                     OFFER even on hardware that could forward at line rate,
                     because "we never slow your internet down" is a promise the
                     customer was sold, and a promise that holds only while the
                     hardware is generous is not a promise.
          headroom - forwarding a household through a board that cannot keep up
                     makes the product worse than not being installed.
          failsafe - headroom without a proven withdrawal turns a five-second
                     blip into a ten-minute outage, because clients keep sending
                     to a MAC that has stopped answering until ARP expires.
        """
        if self.product != PRODUCT_PREMIUM:
            return TIER_OFFER
        if self.can_forward_household and self.failsafe_proven:
            return TIER_CLAIM
        return TIER_OFFER


@dataclass(frozen=True)
class Remedy:
    """One thing the box will do, or would do if it were allowed."""

    id: str
    tier: str
    summary: str
    # Why it is being done, in the words the customer reads. No jargon, no
    # blame directed at their equipment - it is our job to cope with it.
    customer_sentence: str
    reversible: bool = True
    # Set when a remedy is correct but the box may not perform it.
    blocked_reason: str | None = None

    @property
    def automatic(self) -> bool:
        return self.blocked_reason is None


@dataclass(frozen=True)
class Plan:
    """Everything the box intends to do, and everything it cannot."""

    remedies: tuple[Remedy, ...] = ()
    posture: str = "protected"            # protected | partial | unprotected
    headline: str = ""
    tier_reached: str = TIER_HEAL
    notes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def automatic(self) -> tuple[Remedy, ...]:
        return tuple(r for r in self.remedies if r.automatic)

    @property
    def blocked(self) -> tuple[Remedy, ...]:
        return tuple(r for r in self.remedies if not r.automatic)

    @property
    def ids(self) -> set[str]:
        return {r.id for r in self.remedies}


def _is_ours(address: str, facts: NetworkFacts) -> bool:
    """Is this advertised DNS server us?

    Compared as parsed addresses, not strings: '192.168.0.10' and
    '192.168.000.010' are the same server, and an abbreviated IPv6 address is
    the same server as its expanded form. String comparison here would silently
    conclude that we are not advertising ourselves and start a second RA.
    """
    candidates = [facts.lan_ip, facts.our_ipv6_lan_address]
    try:
        parsed = ipaddress.ip_address(address.split("%")[0])
    except ValueError:
        return False
    for candidate in candidates:
        if not candidate:
            continue
        try:
            if ipaddress.ip_address(candidate.split("%")[0]) == parsed:
                return True
        except ValueError:
            continue
    return False


def _ipv6_remedies(facts: NetworkFacts) -> list[Remedy]:
    """IPv6 is where phones are lost, so it is handled first and hardest."""
    out: list[Remedy] = []
    has_v6 = bool(facts.ipv6_global_addresses)

    if has_v6 and not facts.ipv6_default_route and not facts.aaaa_suppressed:
        # Addressing without a route. Every AAAA we answer honestly sends a
        # phone down a path that cannot complete, and after enough of those the
        # handset decides the Wi-Fi is broken and leaves.
        #
        # Suppressing AAAA is normally something to be uneasy about - we are
        # withholding a true record. Here the record is true and useless: there
        # is no route to any address it contains. Answering it is the dishonest
        # option, because it implies a path that does not exist.
        out.append(
            Remedy(
                id="suppress_aaaa",
                tier=TIER_HEAL,
                summary="stop answering AAAA while IPv6 has no route out",
                customer_sentence=(
                    "Your network offers IPv6 but has no working IPv6 connection, "
                    "which makes phones drop off Wi-Fi. Gate^Flame is steering "
                    "devices to the connection that works."
                ),
            )
        )

    if has_v6 and facts.ipv6_default_route and not facts.serves_dns_on_ipv6:
        # Working IPv6 and we only answer on IPv4 means every phone on this LAN
        # is unfiltered, because it will prefer a v6 resolver and we are not one.
        out.append(
            Remedy(
                id="serve_dns_on_ipv6",
                tier=TIER_HEAL,
                summary="bind the resolver on IPv6 as well as IPv4",
                customer_sentence=(
                    "Gate^Flame is now protecting IPv6 traffic as well, so phones "
                    "are covered the same way computers are."
                ),
            )
        )

    foreign = tuple(a for a in facts.ra_dns_servers if not _is_ours(a, facts))
    if foreign:
        out.append(
            Remedy(
                id="advertise_self_as_dns",
                tier=TIER_OFFER,
                summary=f"advertise this box as a DNS server (competing with {len(foreign)})",
                customer_sentence=(
                    "Gate^Flame is telling devices on your network that it can "
                    "protect them, so new devices are covered automatically."
                ),
            )
        )
    return out


def _local_remedies(facts: NetworkFacts) -> list[Remedy]:
    """Faults entirely inside this box. All free, all reversible, all automatic."""
    out: list[Remedy] = []

    if facts.rate_limit_count not in (0, None):
        # Per SOURCE address. Behind a forwarding router the household is one
        # source address, so this ceiling is shared by every device in the house
        # and, when it trips, FTL refuses everything until the window rolls.
        out.append(
            Remedy(
                id="disable_rate_limit",
                tier=TIER_HEAL,
                summary=f"remove the {facts.rate_limit_count}-query ceiling shared by the whole house",
                customer_sentence=(
                    "Gate^Flame removed a limit that was briefly cutting off "
                    "everyone's internet at busy moments."
                ),
            )
        )

    if facts.loopback_listener_ok and not facts.lan_listener_ok:
        out.append(
            Remedy(
                id="rebind_lan_listener",
                tier=TIER_HEAL,
                summary="rebind the household-facing resolver socket",
                customer_sentence=(
                    "Gate^Flame lost the connection your devices use and has "
                    "restored it."
                ),
            )
        )

    subnets: dict[str, list[str]] = {}
    for iface, cidr in facts.lan_addresses:
        try:
            net = str(ipaddress.ip_interface(cidr).network)
        except ValueError:
            continue
        subnets.setdefault(net, []).append(iface)
    crowded = {net: ifs for net, ifs in subnets.items() if len(ifs) > 1}
    if crowded:
        # Deliberately NOT automatic, and this is the one place restraint is
        # right rather than timid: the fix is to take an interface down, and the
        # box cannot know which of them a human is currently reaching it on. Get
        # that wrong and we have disconnected ourselves from the only network
        # that could tell us we did. A support call beats a bricked appliance.
        ifaces = ", ".join(sorted({i for ifs in crowded.values() for i in ifs}))
        out.append(
            Remedy(
                id="single_home",
                tier=TIER_HEAL,
                summary=f"two interfaces share one subnet ({ifaces})",
                customer_sentence=(
                    "Gate^Flame is connected to your network twice, which can make "
                    "protection come and go. This one needs a person."
                ),
                blocked_reason=(
                    "taking an interface down could cut the only path this box is "
                    "reachable on - a human has to choose which link stays"
                ),
            )
        )
    return out


def _gateway_remedy(facts: NetworkFacts, caps: Capabilities) -> Remedy | None:
    """The router is not sending us the household's DNS. Take it, or explain why not.

    `gateway_forwards_to_us is None` means undetermined, and undetermined is not
    False. Claiming a gateway on a guess is the single most destructive thing
    this product could do, so silence is never taken as permission.
    """
    if facts.gateway_forwards_to_us is not False:
        return None

    summary = "answer for the router's address so devices reach protection without router changes"
    customer_sentence = (
        "Your router was sending devices past Gate^Flame. It is now protecting "
        "them directly - nothing on your router was changed."
    )

    if not caps.can_forward_household:
        why = (
            f"this board's uplink is {caps.uplink_kind}"
            f"{f' at {caps.uplink_mbit} Mbit' if caps.uplink_mbit else ''}; "
            f"claiming the gateway means forwarding the whole household and "
            f"below {MIN_FORWARDING_MBIT} Mbit wired the customer would feel us"
        )
        return Remedy(
            id="claim_gateway",
            tier=TIER_CLAIM,
            summary=summary,
            customer_sentence=customer_sentence,
            reversible=True,
            blocked_reason=why,
        )

    if not caps.failsafe_proven:
        return Remedy(
            id="claim_gateway",
            tier=TIER_CLAIM,
            summary=summary,
            customer_sentence=customer_sentence,
            reversible=True,
            blocked_reason=(
                "the withdrawal path has not been proven on this unit - if we claim "
                "the gateway and then die, clients keep sending to a MAC that no "
                "longer answers and the house is offline until ARP expires"
            ),
        )

    return Remedy(
        id="claim_gateway",
        tier=TIER_CLAIM,
        summary=summary,
        customer_sentence=customer_sentence,
        reversible=True,
    )


def assess(facts: NetworkFacts, caps: Capabilities | None = None) -> Plan:
    """Decide what the box will do about the network it finds itself on.

    Pure. Observes nothing, changes nothing, so every branch is reachable from a
    unit test and no decision can be a side effect of a read.
    """
    caps = caps if caps is not None else Capabilities()

    remedies: list[Remedy] = []
    remedies.extend(_local_remedies(facts))
    remedies.extend(_ipv6_remedies(facts))

    gateway = _gateway_remedy(facts, caps)
    if gateway is not None:
        remedies.append(gateway)

    # A remedy above the board's ceiling is recorded, never silently dropped. A
    # capability we chose not to have is a fact about the product, and hiding it
    # is how a limitation becomes a mystery.
    allowed = TIER_ORDER[: TIER_ORDER.index(caps.max_tier) + 1]
    for i, remedy in enumerate(remedies):
        if remedy.tier not in allowed and remedy.automatic:
            remedies[i] = Remedy(
                **{
                    **remedy.__dict__,
                    "blocked_reason": (
                        f"tier '{remedy.tier}' is above this board's ceiling "
                        f"'{caps.max_tier}'"
                    ),
                }
            )

    plan = Plan(remedies=tuple(remedies))
    return Plan(
        remedies=plan.remedies,
        posture=_posture(facts, plan),
        headline=_headline(facts, plan),
        tier_reached=_tier_reached(plan),
        notes=_notes(facts, caps),
    )


def _tier_reached(plan: Plan) -> str:
    reached = TIER_HEAL
    for remedy in plan.automatic:
        if TIER_ORDER.index(remedy.tier) > TIER_ORDER.index(reached):
            reached = remedy.tier
    return reached


def _posture(facts: NetworkFacts, plan: Plan) -> str:
    """What the customer is actually getting, right now.

    The rule this encodes: a device that is not being filtered must never be
    reported as protected. Everything else is detail.
    """
    # Nothing can be filtered if the household cannot reach the resolver at all.
    if not facts.lan_listener_ok and not plan.automatic:
        return "unprotected"

    leaks = plan.ids & {"claim_gateway", "advertise_self_as_dns"}
    if "claim_gateway" in plan.ids:
        claim = next(r for r in plan.remedies if r.id == "claim_gateway")
        # A blocked claim means the router is bypassing us and we cannot stop it.
        return "unprotected" if not claim.automatic else "partial"
    if leaks:
        return "partial"
    if plan.blocked:
        return "partial"
    return "protected"


def _headline(facts: NetworkFacts, plan: Plan) -> str:
    """One sentence, no jargon. This is what appears on the kiosk."""
    if not plan.remedies:
        return "Your network is protected."

    acted = plan.automatic
    blocked = plan.blocked

    if acted and not blocked:
        if len(acted) == 1:
            return f"Gate^Flame fixed something automatically. {acted[0].customer_sentence}"
        return (
            f"Gate^Flame fixed {len(acted)} things on your network automatically. "
            f"{acted[0].customer_sentence}"
        )
    if acted and blocked:
        return (
            f"Gate^Flame fixed {len(acted)} thing(s) automatically, and {len(blocked)} "
            f"need attention. {blocked[0].customer_sentence}"
        )
    return blocked[0].customer_sentence


def _notes(facts: NetworkFacts, caps: Capabilities) -> tuple[str, ...]:
    """Engineering-facing context. Never shown to a customer.

    These are the sentences an operator needs when a box behaves differently
    from an identical box in another house. Every one of them answers "why did
    it decide that", which is the question a support call actually opens with.
    """
    notes: list[str] = []

    notes.append(
        f"product={caps.product} uplink={caps.uplink_kind}"
        f"{f'/{caps.uplink_mbit}Mbit' if caps.uplink_mbit else ''} "
        f"ceiling={caps.max_tier}"
    )

    if caps.product == PRODUCT_STANDARD:
        notes.append(
            "side-car: household traffic does not pass through this box, so no "
            "action it takes can reduce throughput"
        )
    elif not caps.can_forward_household:
        notes.append(
            f"premium board but uplink is {caps.uplink_kind}"
            f"{f' at {caps.uplink_mbit} Mbit' if caps.uplink_mbit else ''} - "
            f"below the {MIN_FORWARDING_MBIT} Mbit wired floor for forwarding"
        )
    elif not caps.failsafe_proven:
        notes.append("premium board with headroom, but withdrawal is unproven on this unit")

    if facts.gateway_forwards_to_us is None:
        notes.append(
            "router forwarding UNDETERMINED - not treated as either answer; "
            "no gateway action will be taken on a guess"
        )

    if facts.ipv6_global_addresses and not facts.ipv6_default_route:
        notes.append(
            f"IPv6 advertised ({len(facts.ipv6_global_addresses)} address(es)) with no "
            f"default route - this is the configuration that drops handsets"
        )

    foreign = tuple(a for a in facts.ra_dns_servers if not _is_ours(a, facts))
    if foreign:
        notes.append(
            f"competing RDNSS on the wire: {', '.join(foreign)} - clients may keep "
            f"both resolvers, so some queries can still bypass filtering"
        )

    return tuple(notes)
