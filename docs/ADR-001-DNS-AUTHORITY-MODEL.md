```
========================================================================================
GATE^FLAME — ADR-001: HOW THE BOX GETS DNS AUTHORITY
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-024-ADR001 | Version: 1.0 | Updated: 2026-08-24 SAST
Status: ACCEPTED — decided by Dennis, 2026-08-24
Supersedes: the closing guidance of install-dns-stack.sh prior to this date
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# 1 — THE DECISION

**The router forwards to us as its upstream DNS. Devices are never pointed at
this box directly.**

```
  device  ──asks──▶  router  ──forwards──▶  Gate^Flame  ──▶  Unbound  ──▶  root servers
                       │
                       └──falls back to its own resolver the moment we go quiet
```

This is **Option 2** of `GATEFLAME-FUNCTION-DEPENDENCY-MAP-2026-08-19.md` Part 5.
The three rejected alternatives are recorded there and are not re-opened here.

## What changes on the router — exactly two fields, once

| Field | Value |
|---|---|
| Internet / WAN / **Upstream** DNS | the box's LAN address |
| IPv6 advertisement (RDNSS) | off, or made to actually work |
| **DHCP / LAN DNS handed to devices** | **left alone — this is the point** |

# 2 — WHY

## 2.1 The constraint that decided it: the power goes off

Load shedding is weekly, not an edge case. Any design that points *devices* at
the box makes the box a single point of failure for the whole household:

```
  T+0s      box loses power
  T+0s      no name lookups anywhere in the house
  T+5-30s   phones fail connectivity validation, drop to mobile data,
            and remember the network as bad
  T+5min    the bypass rule does NOT fire — nothing is running to fire it
  T+hours   DHCP leases renew and the router hands out the SAME dead resolver
  NEVER     no automatic recovery exists at any point on this timeline
```

That is one support call per household per outage, and Gate^Flame is sold on
having no support burden.

As an **upstream**, the same power cut costs the household its filtering and
nothing else. The router falls back on its own, instantly, with no rule to fire
and nothing to reset — **because nothing was taken away from it.**

## 2.2 The distinction that makes it work

A watchdog can only defend against failures that happen while the box is
running. `dns-watchdog.sh` is good at that and stays. It was never able to cover
the power being off, and it no longer has to pretend to.

**Being structurally safe beats being defended.**

# 3 — WHAT THIS COSTS, ACCEPTED KNOWINGLY

| Cost | Detail |
|---|---|
| **Filtering is not 100%** | Most router resolvers learn their fastest upstream and use it, falling back only on failure. The leak is small but real. |
| **Per-client attribution is lost** | Pi-hole sees the router, not each device. The query log cannot say which phone asked for what. Any feature promising per-device history is off the table for the standard box. |
| **The kiosk must not overstate** | "Protected" cannot mean "every query filtered". Copy has to match the architecture. |

Both were weighed against "unplug it and nothing breaks" and lost. That trade is
the product.

# 4 — WHAT THIS ALSO DECIDES

- **CLAIM is dropped from the standard box.** Already enforced in code:
  `netclaim.Capabilities.max_tier` caps a standard box at `OFFER` regardless of
  hardware. Nothing to change.
- **Firewall bounce and DPI go with it.** Both need to be in the traffic path.
  They are premium features. *Removing the code is a separate, scheduled step —
  not done as part of this decision.*
- **`claim_gateway` stays unimplemented** in `netapply`, reported as
  `unsupported` rather than silently skipped. That is now the correct end state
  for the standard box, not a gap.
- **AAAA masking becomes the fallback, not the plan.** Fix the router's IPv6
  properly at install. `autoheal_ipv6()` already reverts itself the moment a real
  IPv6 route appears, so it is compatible as a safety net for routers we cannot
  fix. It must not become the permanent answer.
- **Ionibot shrinks.** Five screens are flagged `architectureDependent`; they
  exist only because of the old dependency. `IB-205` is deleted outright,
  `IB-204` becomes reassurance instead of an emergency, `IB-605` loses its
  warning. Filter on the flag — the rewrite is a search, not an excavation.

# 5 — WHO CHANGES THE SETTING

**The customer, once, guided by one screen — and the box verifies it took.**

Not by credentials. The identification half works and is tested (TP-Link EX511
v2.0, read from its own UPnP description), but the credentialed login is
deliberately unbuilt: it needs reverse-engineering TP-Link's private login crypto,
which changes between firmware revisions. That breaks in a customer's house, on an
overnight auto-update, silently, while the box still reports itself healthy —
the worst failure shape this product has. See `router_adapters.py`.

The guided flow is stronger than it sounds because two pieces already exist:

1. **Model detection works** — the box knows exactly which router it is talking
   to, so it can show that router's real screen with the one field circled.
2. **Verification works** — `router_handshake.perform_handshake` never reports
   success without re-reading, and `gateflame-netcheck.sh` check 4 independently
   proves whether the router is actually forwarding. The customer gets "✓ done"
   or "that didn't save, try again" within seconds.

That verification is what makes 30 seconds feel like a wizard step instead of
homework. Without it, guided is a support article.

`LOGIN_SUPPORTED_MODELS` is empty and a test asserts that is correct. If a
per-model adapter is ever built, it is for the top one or two ISP routers by
volume, once the customer base says which those are — never speculatively.

# 6 — CODE ALREADY ALIGNED WITH THIS DECISION

Nothing below needs revisiting; it was built this way.

| Already correct | Why |
|---|---|
| `netclaim.Capabilities.max_tier` | Standard box capped at `OFFER`. Capability is not permission. |
| `netapply` reporting `claim_gateway` as unsupported | Correct end state, not a gap |
| `dns-watchdog.sh` probing **both** listeners | Covers software failure while alive — its actual job |
| `autoheal_ipv6()` self-reverting | Compatible as a fallback; must not become the plan |
| `gateflame-netcheck.sh` check 4 | Tests exactly the thing this decision depends on |
| `router_handshake` read-back before success | The mechanism that makes the guided flow trustworthy |
| Rate limiting set to `0` | Mandatory once a router forwards — the whole house is one source address |
| `FTLCONF_dhcp_active: 'false'` | The box must never be a DHCP server. Consistent with this decision. |

## Changed by this decision

- `install-dns-stack.sh` closing guidance — was "Router DHCP > DNS servers =
  box", which was Option 1. Now names the upstream field and says explicitly to
  leave the DHCP field alone, with the reasoning.
- `router_handshake.SETTING_LAN_DNS` → **`SETTING_UPSTREAM_DNS`**. The old name
  described the wrong field, which is exactly how a wrong field gets changed.

# 7 — OPEN ITEM CLOSED

The dependency map asked whether the router currently hands clients the box
directly or forwards to it as an upstream.

**Answered on the live box, 2026-08-19:** *neither.* `gateflame-netcheck.sh`
check 4 found `doubleclick.net` resolving to a real address via `192.168.0.1`
and to `0.0.0.0` via the box. The router was never forwarding at all — so
nothing on the network taking DNS from DHCP has been filtered, which is exactly
consistent with the phones.

# 8 — NEXT

Two agent routes are required and do not exist:

- `GET /api/v1/posture/netcheck` — a route over a script that already exists, so
  the app and the box can never disagree about whether the household is protected
- `POST /api/v1/pair/router/revert` — without it, Ionibot `IB-605` cannot protect
  the customer and uninstall-while-dead stays untested

Then: make `gateflame-netcheck.sh` run on a timer and surface on the kiosk rather
than only when a human remembers to run it.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
