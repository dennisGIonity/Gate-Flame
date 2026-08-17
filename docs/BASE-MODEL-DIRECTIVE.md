```
========================================================================================
GATE^FLAME — BASE MODEL DIRECTIVE
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-016-BASE | Version: 1.0 | Updated: 2026-08-16 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# The product, in one paragraph

A customer buys a Gate^Flame box. They plug it in, connect it to their home
network by entering Wi-Fi credentials on the device or plugging in a cable, and
from that moment every device on that network is protected by DNS filtering.
They install one app, scan a code, and see what their box is doing for them.
The only control they have is a threat-blocking level from low to high. Nothing
else is adjustable, because they are a retail buyer with no technical
knowledge, and the box must be impossible to break.

---

# PART 1 — WHAT IS SETTLED

Sourced from the product documents, not inferred.

## 1.1 The hardware

**Base model: Orange Pi Zero 2W, 2 GB.** R380. Cap is 2 GB for cost, and every
feature decision is made inside that.

`Model-Specs&Descriptions_v0.1` (2026-05-30) revised the whole A/B/C line onto
the Orange Pi Zero 2W. The earlier `Plug&Play_Methods` document still says
Raspberry Pi Zero 2 W — **that document is superseded on hardware** and should
be re-issued.

| Model | Build | BOM |
|---|---|---|
| **A** Minimalist | Zero 2W, headless | **R755.70** |
| **B** Wired | + Ethernet expansion board | **R927.60** |
| **C** Visual | + 3.5" touch display | **R1,198.78** |
| **C-Econ** | UNIHIKER K10, screen built in | **R947.20** |
| **D** AI Sentinel | Pi 5 16GB + AI HAT+ 26 TOPS | **R8,297.37** |

## 1.2 The memory budget — measured, not estimated

From `Resource_Consumption` (2026-06-09):

| Component | RAM |
|---|---|
| Pi-hole, 6.7M-domain gravity | **463 MB** |
| Headless Linux | 80–100 MB |
| Unbound | ~50 MB |
| **Baseline total** | **550–623 MB** |

CPU idles 8–15% on a Cortex-A53 at ~500 queries/sec.

**On 2 GB that leaves roughly 1.3 GB.** This is the single number every feature
decision is measured against.

That document also records why the Pi Zero 2 W was abandoned: 512 MB is
saturated by the baseline alone, forcing ZRAM/swap and hardware lockups. Its
recommendation — *"only if the residential tiers are upgraded to alternative SBC
hardware containing at least 1 GB to 2 GB of RAM"* — is exactly the 2 GB cap.

## 1.3 The software stack

Pi-hole (DNS sinkholing) · Unbound (recursive DNS, so queries go to root
servers rather than Google) · Fail2Ban · UFW.

## 1.4 Onboarding — already designed

`network_autopilot.sh`, from `Plug&Play_Methods` Part 2:

1. On boot, wait 15 seconds for a wired or known Wi-Fi connection.
2. Found → client mode.
3. Not found → broadcast SSID `PiHole_Config_Setup`, serve a **captive portal**,
   customer joins from their phone and enters their Wi-Fi credentials.

**This is the answer to credential entry, and it needs no screen.** It is
better than a touchscreen for a retail box: no display cost, no display driver,
and every customer already owns the input device.

---

# PART 2 — WHAT MUST CHANGE

Three things in the current codebase contradict the base model. All three are
consequences of having built against a Pi 5 without reading these documents.

## 2.1 🔴 The Chromium kiosk cannot ship on the base model

Chromium plus a compositor is 300–500 MB and needs a GPU stack. Against a
550–623 MB baseline on a 2 GB board, that is most of the remaining headroom
spent on a screen the base model does not have.

**Base model has no Chromium.** Model C uses **PADD** on TTY1 — the documents
already specify this, and PADD is a shell script costing single-digit MB.

The React display built on 2026-08-16 is **Model D**. It is not wasted: Model D
is the tier with the 7" touchscreen. It is simply not the base.

## 2.2 🔴 The base model is Armbian, not Raspberry Pi OS

Allwinner H618, not Broadcom. Consequences for `node-agent`:

- **`vcgencmd` does not exist** → throttle flags must come from
  `/sys/class/thermal` and Allwinner sysfs paths
- Thermal zone paths differ
- The `SupplementaryGroups=video` fix for `/dev/vcio` is Pi-specific
- `validate-on-pi.sh` needs an Armbian branch

The agent's honest-gap design handles this correctly — it will report a named
gap rather than a wrong number — but it should report a *real* Armbian reading
instead.

## 2.3 🔴 DNS delivery is still unsolved, and it is the whole product

**A box on the LAN does not filter anything by itself.** Other devices query
the router for DNS and never touch the box. For "every device on the network"
to be true, one of these must happen:

| Option | Customer effort | Risk |
|---|---|---|
| **A.** Router's DHCP hands out the box as DNS | Must log into their router | Breaks plug-and-play. Every router differs. High support load |
| **B.** Box runs DHCP itself | Must disable router DHCP | Two DHCP servers fight; worse failure than A |
| **C.** Box inline between router and network | Needs two interfaces | Not possible on a single-NIC Zero 2W |
| **D.** Per-device DNS setting | Per device, manually | Not "the whole network" |

**There is no fifth option.** The captive portal can *instruct* the customer
through option A with router-specific guidance, and the app can *verify* it
worked — but a human still has to change one setting on their router.

**This must be decided before anything else is built.** It determines the
quick-start card, the support model, and the return rate.

## 2.4 Failure mode

If the box is the network's DNS server and it dies, the house loses internet.
For a retail product that is a support call and probably a return.

**Requirement: the box must fail open.** Router DHCP should hand out the box as
primary DNS and a public resolver as secondary, or a watchdog must restore the
router's own DNS. Unfiltered internet is a degraded product; no internet is a
broken one.

---

# PART 3 — THE BASE MODEL SPEC

## 3.1 In scope

| | |
|---|---|
| Board | Orange Pi Zero 2W 2 GB, Armbian |
| DNS filtering | Pi-hole + Unbound recursive |
| Firewall | UFW + Fail2Ban |
| Onboarding | `network_autopilot.sh` + captive portal |
| Agent | `node-agent`, Armbian-adapted |
| Pairing | Loopback/physical-presence code, shown via app or portal |
| Display | **None** on A/B. PADD on TTY1 for C |
| App | Read-only stats, full eye candy |
| User control | **One**: threat level low → high |
| History | Telemetry table so "yesterday" survives reboot |

## 3.2 Explicitly out of scope for base

Deferred to Model D, with extension points left in place:

DPI/ntopng (~1.3 GB) · NetAlertX SIEM (1–2 GB) · Prometheus + Grafana (~500 MB)
· active Nmap scanning · AI blocklists · the React touchscreen display.

`Resource_Consumption` measures that stack at **3.3–3.8 GB additional**. It is
not a 2 GB conversation.

## 3.3 The sockets to leave open

So nothing is rebuilt later:

1. **Module registry** — already correct. New modules register, declare
   requirements, report honest gaps. Model D modules simply appear.
2. **`/api/v1/threats/recent`** already returns `source` — today `"none"`,
   later `"pihole"` or `"suricata"`. Contract unchanged.
3. **`/api/v1/services`** — the app renders whatever modules exist. No app
   change needed when the premium tier adds seven.
4. **Feed receiver** — outbound-only, health-fields-only, off by default. The
   channel for fleet telemetry when it is wanted.
5. **`GATEFLAME_WAN_INTERFACES`, `GATEFLAME_PIHOLE_URL`** — configuration, not
   code changes.

The 2026-08-09 Node stack in `E:\_ARCHIVE-2026-08-16\App-antigravity-workspace`
(Suricata, Prometheus, MQTT, `arp-scan`) is the Model D prior art. Read it when
that tier is specified.

---

# PART 4 — DECISIONS NEEDED FROM YOU

Everything else can proceed. These cannot.

| # | Decision | Why it blocks |
|---|---|---|
| 1 | **DNS delivery — A, B or C from §2.3** | Determines onboarding, quick-start card, support model. The biggest call in the product |
| 2 | **Fail open or fail closed?** | Decides whether a dead box takes the house offline |
| 3 | **Ship Model A or C first?** | A is cheapest and headless with onboarding already designed. C costs R443 more and needs the display path working |
| 4 | **Confirm Orange Pi Zero 2W 2 GB is orderable** at R380 in the quantity you want |
| 5 | **Does the box phone home?** | POPIA turns on this. Currently the feed is off by default |

## What I would recommend

**Ship Model A first.** R755.70, no screen, no Chromium, no display driver
work, and its onboarding is fully specified in your own documents. It proves
the core value — whole-network DNS filtering with a phone app — with the
smallest surface area. Model C then adds PADD on a screen, which is a small
increment, not a new architecture.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
