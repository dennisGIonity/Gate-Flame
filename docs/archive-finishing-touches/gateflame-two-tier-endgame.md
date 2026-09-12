```
========================================================================================
GATE^FLAME — TWO-TIER ENDGAME: 0-HASSLE BASE / MAXIMUM-SECURITY FLAGSHIP
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-020-TIER | Version: 1.0 | Updated: 2026-08-22 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Source

Built directly from `GATEFLAMEFUNCTIONDEPENDENCYMAP20260819.md.docx` (DOC-2026-08-002,
compiled against commit `031a5bc` / tag `v1.0.2`). That document is the hard evidence;
this one is the product decision built on top of it. Nothing here contradicts it —
where they overlap, the dependency map is the source of truth.

---

# The one sentence that drives both tiers

The dependency map proved a fact that can't be engineered around (its Part 5): with
one box on the network, **100% filtering** and **the household surviving the box dying**
are mutually exclusive. Every function on the device sorts into Class A (breaks the
internet if the box dies), Class B (feature stops, internet fine), or Class C (no
external effect). The dependency map's recommendation was a single config — this
doc turns that single config into two shippable products, because you don't have
one customer, you have two:

- **The 0-Hassle Base tier** — sold on "you will never think about this box again."
  Optimises for Class A count = zero.
- **The Maximum-Security flagship** — sold on "this is the strongest filter money
  can buy for your house." Optimises for filtering strength, accepts Class A risk,
  and pays for that acceptance with hardware and a support relationship.

Same codebase, same node-agent, same app. The split is **which modules run and
which install-time choices get made**, not a fork.

---

# PART 1 — What changes between tiers

Mapped directly to the dependency map's module list (its Part 1/2/3 numbering kept
alongside, so this stays traceable to source).

## 1.1 The base-tier config (Option 2 from the dependency map)

| Dependency-map item | Base tier setting | Why |
|---|---|---|
| A1 Router handshake | Writes the router's **upstream DNS**, not the LAN DHCP option | Router keeps serving clients from itself; forwards to us. A dead box means the router's own fallback resolver kicks in with nothing to reset — this is what makes "unplug it and nothing breaks" structurally true rather than watchdog-defended |
| A2 Network claim | **HEAL and OFFER only. CLAIM is never shipped.** | CLAIM takes the default gateway, not just DNS — a dead box means total connectivity loss, not just filtering loss. Dropping it is the single highest-leverage decision in the whole map |
| A3 Pi-hole as resolver | Same Pi-hole/Unbound stack, but now positioned as the router's **forwarder target**, not the household's primary resolver | Removes the "client holds a dead resolver for the DHCP lease duration" failure entirely — the router is what clients actually query |
| A4 IPv6 AAAA suppression | Router's IPv6 is **fixed or disabled permanently at install**, not masked at runtime | The mask is exactly what turned a router misconfiguration into a box dependency. Fix it once, at pairing, and stop carrying it as runtime state |
| A5 Pi-hole rate limiting | `FTLCONF_dns_rateLimit_count=0`, enforced by installer + reasserted on every stack recreate | Still needed — the router (or box) is still a concentrator point for the household's queries |
| A6 Dual-homing | Installer **refuses to complete** on two same-subnet addresses, or binds port 53 to both | Structural fix, not tier-specific — this is a bug fix, ships to both tiers |
| A7 Firewall bounce | **Not shipped.** Depends on CLAIM; ships dead without it | No claim = no traffic crossing the box = nothing to bounce |
| B13 DPI | **Not shipped** | Same reasoning as A7 — heavyweight-appliance-only capability |

**Net effect on the base tier: Class A count drops from seven to zero**, exactly as
the dependency map's recommendation states. Everything else — threat dial, content
categories, pause/resume, blocklist rebuild, watchdog, bypass mode, netcheck,
pairing, client list, threat log, WAN audit, posture audit, telemetry, health feed,
kiosk console, the app — ships unchanged. They're all Class B or C already; the base
tier doesn't need to touch them.

**Cost accepted:** a small DNS leak rate (most router resolvers use the fastest
upstream and fall back only on failure), and per-client attribution lost in Pi-hole
under router-forwarding mode (B9's own complication, worse without CLAIM). Both are
named, both are the trade for zero support calls.

## 1.2 The flagship config (Option 3 from the dependency map, hardened)

| Dependency-map item | Flagship setting | Why |
|---|---|---|
| A1 Router handshake | Writes the **LAN DHCP DNS option** — clients point at the box directly | Maximum filtering: nothing bypasses the box while it's alive |
| A2 Network claim | **CLAIM is available and can be enabled** | This is the tier that's allowed to take the default gateway, because it ships with the hardware and support relationship that makes the trade-off acceptable |
| A7 Firewall bounce | **Shipped, enabled by default** | Meaningful now that CLAIM routes real traffic through the box |
| B13 DPI | **Shipped, enabled by default (SNI/Host only, as already built — no MITM, no decryption)** | Full nine-module security story |
| B1 Threat level | **Default: medium**, not low | Flagship customer explicitly bought maximum security; base tier defaults to low precisely to avoid a day-one Netflix breakage |
| Hardware (dependency map's Option 3) | **Industrial SD/eMMC or NVMe, brownout-tolerant PSU, read-only rootfs**, printed recovery card in the box | This tier accepts Class A risk and pays for it by making the box itself extremely unlikely to die, rather than by architecting the risk away |

**Net effect on the flagship: Class A count stays where the code already puts it**,
but the box is engineered so the "box dies" branch of the fault tree is rare rather
than eliminated — the dependency map's Option 3, taken seriously instead of as a
fallback.

## 1.3 What never differs between tiers

Everything the dependency map marks Class C, plus the honest-reporting architecture
(B14 module registry, B16 health feed) — these are the product's integrity
guarantees and apply regardless of which hardware tier someone bought. A base-tier
customer's dashboard is exactly as honest about what's real and what's a gap as a
flagship customer's.

---

# PART 2 — What this means for the roadmap you already have

This doesn't replace `GATEFLAME-STATUS-AND-ROADMAP-2026-08-18.md` — it reshapes two
sprints in it.

**Sprint 0.8** ("settle the address conflict and the Pi 5 vs Orange Pi Zero 2W
base-model contradiction") is now answered structurally rather than as a single
choice: **Orange Pi Zero 2W (or equivalent low-cost board) is the base-tier board;
Pi 5 is the flagship board.** That contradiction in the docs wasn't a mistake to
resolve — it was two products described as one.

**Sprint 6 ("Plug and play")** forks:
- Base tier: install-time router handshake writes the upstream-forward setting; no
  CLAIM/bounce/DPI to provision at all; pairing UX can stay simple (button+display)
  since there's less to configure.
- Flagship: same pairing UX, but first-boot provisioning also needs to surface the
  CLAIM/bounce/DPI opt-ins and the printed-card recovery instructions physically in
  the box.

**New line item for Sprint 0 (add before BOM freeze):** run
`gateflame-netcheck.sh` check 4 on your actual home router **now** — the dependency
map's own open item. It tells you whether your router currently hands out the box
directly (DHCP option 6) or already forwards, which determines whether Option 2 is
a router settings change or a code change on your specific hardware. Do this before
committing the base-tier design to code.

**New CI/test item:** the dependency map's A6 (dual-homing) and A5 (rate limit) are
bugs today, not tier decisions — fix them in `node-agent` regardless of tier, and
add the installer refusal (A6) and the reassert-on-recreate (A5) as tests, the same
way `provisioned`/revoke-all got a regression test after it bit once.

---

# PART 3 — The offline in-app chatbot (concept + feasibility)

You raised this as a side note; here's a first pass grounded in what's actually on
the box.

## What it would need to do

Two jobs, not one, and they have very different difficulty:

1. **Guided setup** — walk a customer through pairing, router configuration
   (if the flagship's LAN-DHCP path needs a manual step on an unsupported router
   model — dependency map A1's "unknown router models are refused... falls back to
   a guided manual flow"), and threat-level/category choices.
2. **Minor issue repair** — read the box's own diagnostic output
   (`gateflame-netcheck.sh --json`, the module registry's `not_implemented`/`degraded`
   gaps, the posture audit's named remedies) and turn it into plain-language
   troubleshooting steps a non-technical customer can follow.

## Why "offline" is the right constraint, and also the reason job 2 is easy and job 1 is hard

Job 2 doesn't need a language model at all. Every diagnostic already on the box —
`netcheck`, `services.py`'s honest capability reporting, `posture.py`'s
"every finding carries a remedy" — is **already structured, deterministic data**.
A rules-based decision tree ("netcheck check 1 failed → here's what dual-homing
means and here's the fix") is more reliable than an LLM here, fully offline, and
costs no additional compute on a 2 GB Orange Pi Zero 2W. This is worth building
regardless of what happens with job 1.

Job 1 (open-ended "guide me through setup, answer my question") is where "offline
chatbot" usually implies an on-device LLM, and that's a genuinely different
engineering commitment:

| Approach | On-device feasibility | Trade-off |
|---|---|---|
| Scripted decision tree (job 2's approach, extended to cover common setup questions) | **Runs today, zero new dependencies** | Can't answer anything outside its script; needs maintenance as the product changes |
| Small on-device LLM (1-3B class, quantized) in the **phone app** | Feasible — phones have far more RAM/compute than an Orange Pi Zero 2W | App binary size grows significantly (hundreds of MB to a few GB); battery/thermal cost on the handset, not the box; quality ceiling is real at that size |
| Small on-device LLM **on the box itself** | **Not feasible on the base-tier board.** Orange Pi Zero 2W (2 GB RAM) is already budgeted for Pi-hole + Unbound + node-agent. Even the flagship Pi 5 would need to dedicate RAM/CPU headroom the WAN audit and DPI already contend for | Rejected for now — recommend the phone, not the box, if this goes ahead |
| Cloud LLM, gated behind connectivity | Contradicts "offline" and contradicts the health-feed's privacy posture (B16) — would need its own consent screen and data-flow story | Only worth it if you're willing to reopen the POPIA conversation for this specific feature |

**Recommendation:** build job 2 first — it's cheap, deterministic, matches the
product's existing honesty architecture, and directly reduces the support-call
count the whole tier split exists to minimize. Treat job 1 (open-ended guidance) as
a separate, later decision, and if you want it, put the model in the phone app, not
the box, using a small on-device model via whatever the Android inference story
looks like at that point (e.g. MediaPipe/LiteRT on-device LLM inference) — that
keeps "offline" true without taking RAM the base-tier board doesn't have to give.

## What I'd need from you to spec this further

- Do you want job 1 at all, or is job 2 (diagnostic-driven repair guidance) actually
  the whole ask? Re-reading your message, "guide setup and all minor issue
  functionality repair" reads like job 2 is the real target and "chatbot" is the
  framing, not a requirement for open-ended conversation.
- If job 1 is wanted: is it acceptable for it to live in the phone app only (not
  the kiosk), given the base-tier board's RAM budget?

---

# PART 4 — Decisions needed from you before this becomes code

1. **Confirm the base-tier board.** Dependency map assumes Orange Pi Zero 2W (2 GB)
   is already the target for the no-CLAIM config — confirming this locks Sprint 0.8.
2. **Confirm Option 2's router-forward setting is achievable on your actual router.**
   Run `gateflame-netcheck.sh` check 4 against it — see Part 2 above. This is a
   10-minute task that unblocks the rest of the base-tier design.
3. **Chatbot scope** — job 2 only, or job 1 as well (see Part 3).
4. **Naming** — do the two tiers get separate product names, or one name with a
   "/Pro" or "/Max" suffix? Affects the app (does it need to detect and label which
   tier it's talking to?) and the store listing work in Sprint 8.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
