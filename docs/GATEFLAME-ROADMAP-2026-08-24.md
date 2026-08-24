```
========================================================================================
GATE^FLAME — REVISED ROADMAP TO THE FINISHED STANDARD MODEL
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-024-ROADMAP | Version: 2.0 | Updated: 2026-08-24 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

Supersedes `GATEFLAME-STATUS-AND-ROADMAP-2026-08-18.md`. Scope is the **STANDARD
side-car model only** — the premium in-path box is deliberately out of scope
until this one is finished and in customers' homes.

Effort is **working days for one person**. Phases marked ⏳ are lead-time-bound
and must start early regardless of what else is happening.

---

# 0 — WHAT CHANGED SINCE THE LAST ROADMAP

Three things reshaped the plan:

1. **ADR-001 was accepted.** The router forwards to us as its upstream; devices
   are never pointed at the box. That removes the whole class of "box dies,
   house loses internet" work, and with it the emergency-revert UX.
2. **The mobile app was scrapped and rebuilt** on the console's engine. Sprint 5
   in the old plan ("finish the front end") is largely done, and what remains is
   different work.
3. **The box was found never to have filtered.** Every layer reported healthy.
   This roadmap therefore treats *proving* things as first-class work rather
   than as something that happens implicitly.

---

# SPRINT A — CLOSE OUT THE HOUSEHOLD · **2 days** · do first

The box filters one workstation. Nothing else in this plan is worth doing until
it filters the house, because every later phase inherits the assumption that it
does.

| # | Action | Done when |
|---|---|---|
| A.1 | `sudo bash deploy-agent.sh` — the two staged modules | `/api/v1/filtering` reports `active` with no stale error |
| A.2 | **Rotate the Pi-hole admin password** (exposed today) | New value in `.env`, drop-in rewritten, agent reads stats |
| A.3 | Point the **router's upstream DNS** at `192.168.0.10` | `nslookup doubleclick.net <router-ip>` → `0.0.0.0` |
| A.4 | **Settle the second-DNS question** on the EX511 | Documented: does the router fall back when its only static upstream dies? |
| A.5 | Fix **dual-homing** — one interface, or two subnets | `gateflame-netcheck.sh` check 1 passes |
| A.6 | Turn **IPv6 off on the router**, or make it work end to end | netcheck `ipv6` passes; phones stop dropping Wi-Fi |
| A.7 | Revoke the two GitHub PATs and the `GEMINI_API_KEY`; delete `TempGateFlameBuild\.env.local` | Tokens dead at GitHub and Google |
| A.8 | **Back up the release keystore twice, record its SHA-256** | Two encrypted copies, fingerprint in a sealed document |

**🚪 GATE A — every device in your house is filtered, and no credential in this
project is one you have ever pasted anywhere.**

> A.4 is small and load-bearing. ADR-001's promise that a dead box costs only
> filtering assumes the router has a fallback. If the EX511 uses only its
> configured statics, an empty secondary plus a dead primary is the outage the
> ADR says it removed — and IB-110's copy is wrong.

---

# SPRINT B — THE HISTORY DATABASE · **15 days** · the largest single item

Right now every chart is instantaneous polling and a reboot is amnesia. The app
tells the customer so honestly, which is correct and also a poor product.

**Where the data lives: on the box, in SQLite. Not in a cloud.**

That is a deliberate architectural choice, not a default. The privacy story —
"almost nothing leaves your LAN" — is the strongest thing this product has, and
it is worth more than the convenience of a hosted database. It also makes the
POPIA position simple: personal information is not exported, so s72 does not
engage for the box itself.

| # | Action |
|---|---|
| B.1 | Design the schema: `telemetry_samples`, `query_rollup_hourly`, `query_rollup_daily`, `threat_events`, `client_seen`. **Decide retention per table up front — retention is a POPIA input, not an afterthought** |
| B.2 | Stay on SQLite/WAL. One file, no daemon, already in use, already backed up by the same mechanism as node identity |
| B.3 | Sampler: async, 60 s cadence. A Pi-hole outage is a `NULL` row, **never an interpolation** |
| B.4 | Rollup job hourly → daily. Idempotent and resumable after power loss |
| B.5 | Retention + vacuum enforced by a job. **Bounded disk is a hard requirement** — an appliance that fills its own card is a returned unit |
| B.6 | Routes: `GET /api/v1/history/summary?range=24h\|7d\|30d\|90d`, `/history/threats`, `/history/clients` |
| B.7 | **Type the contract in `src/types/` first.** The interface is the seam — widening `ProtectionStatus` today immediately found a bug the compiler could not otherwise have seen |
| B.8 | Batched writes + WAL checkpoint strategy. **1 Hz fsync for two years kills an SD card** |
| B.9 | Export / restore / factory reset that wipes history but keeps node identity |
| B.10 | Wire the app's Activity screen to real ranges; delete the "starts when you open the app" caveat |
| B.11 | Tests: rollup across midnight and DST, retention actually deletes, restart mid-rollup, disk full |

**🚪 GATE B — unplug the box for a minute, plug it back in, and yesterday is
still there.**

---

# SPRINT C — PLAY STORE ⏳ · **starts NOW, runs 30–45 days in parallel**

The Play Console queue is the only thing here that cannot be compressed by
working harder, which is why it starts on day one rather than when the app is
ready.

| # | Action | Note |
|---|---|---|
| C.1 | **Create the Play Console account and start identity verification** | Days to weeks. Start today |
| C.2 | Write `android/keystore.properties`; produce a **signed release build** | The keystore exists; only the passwords are missing |
| C.3 | **Enrol in Play App Signing** at first upload | The only recovery path if the upload key is lost. Cannot be added retroactively |
| C.4 | Settle `versionName` — tag says `v1.0.2`, `version.properties` says `1.0.1` | Play rejects a reused `versionCode`; get the discipline right before the first upload |
| C.5 | **Publish the privacy notice at a public URL** on ionity.today | POPIA s18 needs it anyway; Play will not accept a listing without it |
| C.6 | Data-safety form, matching reality exactly | Our honest answer is unusually strong — almost nothing leaves the LAN. Say so plainly |
| C.7 | Store listing: icon, feature graphic, 4–8 screenshots, short and full description | Screenshots from the new app, on a real portrait device |
| C.8 | **Check the current closed-testing tester-count and duration rule** at account creation | It has added weeks to other launches. Check early, not at submission |
| C.9 | Closed track → open track → production | |

**🚪 GATE C — the app installs from Play onto a phone that has never been
developer-enabled.**

---

# SPRINT D — POPIA AND LEGAL ⏳ · **starts day 2, runs 60 days in parallel**

External review has a queue. Start before you feel ready.

| # | Action |
|---|---|
| D.1 | **POPIA review by a practitioner.** Resolve where `feeds.ionity.today` is hosted first — it decides whether you are exporting personal information (s72) |
| D.2 | Privacy notice (s18) — shared with C.5 |
| D.3 | Breach response plan (s22); appoint and **register an Information Officer** |
| D.4 | Freeze the health-feed contract — health-fields-only, outbound-only, off by default — **with a test** |
| D.5 | `THIRD_PARTY_NOTICES.md`. **Pi-hole is EUPL-1.2** — check redistribution terms before shipping it pre-installed |
| D.6 | Confirm AED 900 / CC BY-NC-SA 4.0 is coherent with *selling hardware* |
| D.7 | Trademark search and filing for "Gate^Flame" — check the `^` is registrable |

---

# SPRINT E — PROVE IT ON HARDWARE · **5 days**

`deploy-on-pi.sh` and `validate-on-pi.sh` have never produced a PASS/FAIL table.
Until they do, "it works" means "it worked on this one box that we hand-fixed".

| # | Action |
|---|---|
| E.1 | Flash a **second board from scratch**, static lease, no hand-fixing |
| E.2 | `sudo bash deploy-on-pi.sh --with-pihole` → exit 0 |
| E.3 | **Read the `validate-on-pi.sh` PASS/FAIL table.** Rows that matter: `/sys/class/thermal`, `vcgencmd get_throttled`, `CAP_NET_ADMIN`, `CAP_NET_RAW`, `ip neigh`, cgroup v2 |
| E.4 | Pair a phone with **no SSH-free shortcut** — record exactly what typing was needed |
| E.5 | Confirm counters move when you browse. **A null is fine; a fabricated number is not** |
| E.6 | 24-hour soak: RSS, temperature, WAL size, log growth |
| E.7 | Write down every surprise — these become Sprint G tests |

**🚪 GATE E — a box nobody has hand-fixed filters a household.**

---

# SPRINT F — PLUG AND PLAY · **30 days** · *this is the product, not a feature*

| # | Action |
|---|---|
| F.1 | Custom OS image (`pi-gen`/Packer): agent + Pi-hole + Unbound + avahi + systemd baked in, boots to serving with zero commands |
| F.2 | First-boot provisioning — **idempotent and resumable. A power cut mid-first-boot must not brick the unit** |
| F.3 | **Pairing without SSH.** Recommended: small display + QR, per the 2026-08-17 mobile plan. The QR carries node id, addresses, code, expiry and a cert fingerprint. Preserves the loopback/physical-presence model, which is already correct |
| F.4 | The **guided router screen** — one screen, upstream DNS, verified by re-read. This is the #1 predicted support ticket |
| F.5 | Status LEDs — power / network / filtering / fault |
| F.6 | OTA updates: signed, staged, **automatic rollback on failed health check. Do not ship without rollback** |
| F.7 | Factory reset (long-press), watchdog self-heal, power-loss resilience, NTP before any timestamped write |
| F.8 | Image built in CI as a checksummed, versioned `.img.xz` |

**🚪 GATE F — hand a sealed box to someone who has never seen it, with a printed
card only. They reach a working dashboard.**

---

# SPRINT G — MAKE GREEN MEAN SOMETHING · **4 days** · runs alongside F

| # | Action |
|---|---|
| G.1 | Add feed-receiver's 83 tests to CI |
| G.2 | Drive ruff to zero, then flip `continue-on-error: false` |
| G.3 | Binary-integrity gate in CI (magic bytes + `EF BF BD` scan) |
| G.4 | Manifest test: `aapt2 dump xmltree` asserts the cleartext policy on the built APK |
| G.5 | **Nightly self-hosted runner on the actual board** running `validate-on-pi.sh` — the only CI that can ever prove filtering works |
| G.6 | **A test that would have caught today's bug**: assert against a live Pi-hole that a blocklist write lands and gravity becomes non-zero |
| G.7 | Coverage baseline published (not yet a gate) |

**🚪 GATE G — a red CI genuinely blocks a broken product.**

---

# SPRINT H — HARDWARE AND MANUFACTURING ⏳ · **starts day 30**

Freeze the BOM. **Base tier is the Orange Pi Zero 2W class; the Pi 5 is the
flagship board** — that contradiction in the old docs was two products described
as one.

- **Prefer NVMe or industrial eMMC over microSD.** Sprint B writes continuously
  and card wear is the likeliest 18-month failure — every one an RMA.
- Brownout-tolerant PSU. Load shedding is weekly, not exceptional.
- Thermal-validate at 35 °C ambient with the case closed.
- Enclosure, asset manifest, packaging, per-unit serial and provisioning record.
- 20-point QA checklist, 24 h burn-in per unit, two suppliers for board and PSU.
- Pricing.

**🚪 GATE H — ten units built to the runbook, all passing QA, boxed.**

---

# SPRINT I — LAUNCH · **30 days**

Deploy `feed-receiver` (hosting location is a POPIA input, see D.1) · public
docs site on ionity.today · monitored support inbox · RMA process ·
**ten units, ten homes that are not yours, thirty days unattended.**

**🚪 GATE I — the end of the standard model. Only now does the premium box
start.**

---

# CRITICAL PATH

```
SPRINT A (2d) ──► SPRINT E (5d) ──► SPRINT F (30d) ──► SPRINT I (30d)
     │                  │                  ▲
     │                  └──► SPRINT B (15d)┘
     │                              │
     │                              └──► SPRINT G (4d)
     │
     ├──► SPRINT C Play ⏳ (start day 1, 30-45d queue) ──────────► SPRINT I
     └──► SPRINT D POPIA ⏳ (start day 2, 60d queue) ───────────► SPRINT I
                                    │
              SPRINT H BOM ⏳ (start day 30) ─────────────────► SPRINT I
```

**≈ 90 working days ≈ 4½ calendar months** for one person, *if* C, D and H
genuinely run in parallel. Sequential, closer to seven months.

**Top risk:** Sprint E fails and everything downstream is unproven. It is
scheduled early for exactly that reason — and today is the argument for it, since
a box that reported healthy for eight days had never worked at all.

**If the date matters more than scope, cut:** DPI (highest complexity, lowest
launch-visible value — Pi-hole plus the firewall bouncer is already a complete
product story), the custom enclosure, and tablet screenshots. That is roughly 20
days. **Do not cut Sprint G or OTA rollback under any circumstance.**

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
