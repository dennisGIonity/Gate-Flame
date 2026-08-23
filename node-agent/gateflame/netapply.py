"""Turning a plan into actions - the half that actually changes something.

`netclaim.assess()` decides. This applies. They are separate modules on purpose:
a decision that cannot be tested without a LAN is a decision nobody checks, and
an actuator that also decides can act on a state it inferred rather than one it
was given.

THE FOUR RULES

  1. A BLOCKED REMEDY PRODUCES NO ACTION. Ever. `netclaim` blocks things for
     reasons like "taking an interface down could cut the only path this box is
     reachable on" - if that could still be executed because it appeared in the
     list, the block would be decoration.

  2. AN UNKNOWN REMEDY IS RECORDED, NOT DROPPED. If someone adds a remedy to
     netclaim and forgets to add its action here, the plan would quietly do
     less than it says. That fails loudly instead.

  3. WEAKEST FIRST. heal, then offer, then claim. Suppressing AAAA costs
     nothing and may be enough on its own; announcing ourselves to other
     devices is a bigger step and should not happen before the cheap fix has.

  4. A FAILURE STOPS THE SEQUENCE. Half-applying a network change is worse than
     not starting - the box would be in a state no test covers and no operator
     expects.

Nothing here shells out by itself. The caller supplies a runner, so the whole
sequencer is exercised in tests with no root, no docker and no network.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Protocol

from gateflame.netclaim import TIER_ORDER, Plan


@dataclass(frozen=True)
class Action:
    """One concrete thing to run. argv, never a shell string.

    A shell string is an injection surface and an unreadable log line. argv is
    neither, and it survives a network name with a space in it.
    """

    remedy_id: str
    tier: str
    argv: tuple[str, ...]
    description: str
    requires_root: bool = True


@dataclass(frozen=True)
class Outcome:
    action: Action
    rc: int
    output: str = ""

    @property
    def ok(self) -> bool:
        return self.rc == 0


@dataclass
class ApplyResult:
    outcomes: tuple[Outcome, ...] = ()
    skipped_blocked: tuple[str, ...] = ()
    unsupported: tuple[str, ...] = ()
    dry_run: bool = True
    stopped_early: bool = False
    notes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        return all(o.ok for o in self.outcomes) and not self.unsupported

    @property
    def applied_ids(self) -> tuple[str, ...]:
        return tuple(o.action.remedy_id for o in self.outcomes if o.ok)


class Runner(Protocol):
    def __call__(self, argv: tuple[str, ...]) -> tuple[int, str]: ...


# How each remedy is carried out. Keyed by remedy id so a missing entry is
# detectable rather than invisible.
#
# STACK is substituted at build time so the compose directory is never guessed.
def _builders(stack: str, lan_ip: str, lan_ip6: str | None) -> dict[str, Callable[[], Action]]:
    def env_set(key: str, value: str, why: str, remedy: str, tier: str) -> Action:
        # A tiny helper script on the box owns the .env edit. Doing it here would
        # mean this module needed write access to a root-owned credential file.
        return Action(
            remedy_id=remedy,
            tier=tier,
            argv=("gateflame-env-set", stack, key, value),
            description=why,
        )

    return {
        "suppress_aaaa": lambda: env_set(
            "GATEFLAME_DNSMASQ_LINES", "filter-AAAA",
            "stop answering AAAA while IPv6 has no route out",
            "suppress_aaaa", "heal",
        ),
        "disable_rate_limit": lambda: Action(
            remedy_id="disable_rate_limit", tier="heal",
            argv=("docker", "exec", "gateflame-pihole",
                  "pihole-FTL", "--config", "dns.rateLimit.count", "0"),
            description="remove the query ceiling shared by the whole house",
            requires_root=False,
        ),
        "rebind_lan_listener": lambda: Action(
            remedy_id="rebind_lan_listener", tier="heal",
            argv=("docker", "compose", "--project-directory", stack, "up", "-d"),
            description="rebind the household-facing resolver socket",
        ),
        "serve_dns_on_ipv6": lambda: env_set(
            "GATEFLAME_LAN_IP6", lan_ip6 or "",
            "publish the resolver on IPv6 as well as IPv4",
            "serve_dns_on_ipv6", "heal",
        ),
        "advertise_self_as_dns": lambda: Action(
            remedy_id="advertise_self_as_dns", tier="offer",
            argv=("gateflame-ra-advertiser", "--enable", "--dns", lan_ip6 or lan_ip),
            description="advertise this box as a DNS server (RDNSS, router lifetime 0)",
        ),
    }


def plan_actions(
    plan: Plan,
    *,
    stack: str = "/home/wabapi/node-agent/dns-stack",
    lan_ip: str = "",
    lan_ip6: str | None = None,
) -> tuple[tuple[Action, ...], tuple[str, ...], tuple[str, ...]]:
    """(actions, blocked_ids, unsupported_ids), weakest tier first.

    `single_home` is intentionally absent from the builder table AND excluded
    here: netclaim always blocks it, so it can never reach this function, but if
    a future edit unblocked it we would rather see it as unsupported than have
    an interface taken down by a table lookup.
    """
    builders = _builders(stack, lan_ip, lan_ip6)

    blocked = tuple(r.id for r in plan.blocked)
    actions: list[Action] = []
    unsupported: list[str] = []

    for remedy in plan.automatic:
        builder = builders.get(remedy.id)
        if builder is None:
            unsupported.append(remedy.id)
            continue
        actions.append(builder())

    actions.sort(key=lambda a: TIER_ORDER.index(a.tier))
    return tuple(actions), blocked, tuple(unsupported)


def apply(
    plan: Plan,
    runner: Runner | None = None,
    *,
    dry_run: bool = True,
    stack: str = "/home/wabapi/node-agent/dns-stack",
    lan_ip: str = "",
    lan_ip6: str | None = None,
) -> ApplyResult:
    """Run the plan. Defaults to dry run, deliberately.

    An actuator whose default is to act is one that acts by accident. The caller
    has to say so.
    """
    actions, blocked, unsupported = plan_actions(
        plan, stack=stack, lan_ip=lan_ip, lan_ip6=lan_ip6
    )
    notes: list[str] = []

    if unsupported:
        notes.append(
            "remedy has no action defined - netclaim promised something netapply "
            f"cannot do: {', '.join(unsupported)}"
        )
    if blocked:
        notes.append(f"not attempted because netclaim blocked them: {', '.join(blocked)}")

    if dry_run:
        return ApplyResult(
            outcomes=tuple(Outcome(action=a, rc=0, output="(dry run)") for a in actions),
            skipped_blocked=blocked,
            unsupported=unsupported,
            dry_run=True,
            notes=tuple(notes + [f"{len(actions)} action(s) would run"]),
        )

    if runner is None:
        raise ValueError("a runner is required when dry_run is False")

    outcomes: list[Outcome] = []
    stopped = False
    for action in actions:
        rc, output = runner(action.argv)
        outcomes.append(Outcome(action=action, rc=rc, output=output))
        if rc != 0:
            # Half-applying a network change leaves the box in a state no test
            # covers. Stop and report rather than pressing on.
            notes.append(
                f"stopped after {action.remedy_id} failed (rc={rc}) - "
                f"{len(actions) - len(outcomes)} action(s) not attempted"
            )
            stopped = True
            break

    return ApplyResult(
        outcomes=tuple(outcomes),
        skipped_blocked=blocked,
        unsupported=unsupported,
        dry_run=False,
        stopped_early=stopped,
        notes=tuple(notes),
    )
