```
========================================================================================
GATE^FLAME — END-GAME PLAN: FROM HERE TO A SHIPPABLE APPLIANCE
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-015-PLAN | Version: 1.0 | Updated: 2026-08-15 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# GOAL 1 — THE END GAME

> **A customer buys a Gate^Flame box. They plug it into their router and power.
> They install one app. Within five minutes and without a keyboard, a terminal,
> or a single line of typing, their whole network is filtered, and their phone
> shows them true numbers about it — including yesterday's.**

That sentence is the product. Every item in this plan exists because something
in it is not yet true. Six clauses, six acceptance tests:

| # | Clause | Acceptance test | True today? |
|---|---|---|---|
| E1 | "plug it in" | Powered from cold, unattended, node is serving in under 120s | ❌ needs manual `deploy-on-pi.sh` |
| E2 | "install one app" | Play Store install, no side-load, no unknown-sources toggle | ❌ unsigned, no listing |
| E3 | "without typing" | Pairing completes with no SSH and no IP entry | ❌ pairing code is issued over SSH |
| E4 | "network is filtered" | Pi-hole live, DNS enforced, firewall/DPI actually running with caps | ⚠️ code exists, never run on hardware |
| E5 | "true numbers" | Zero fabricated values reach the UI; gaps named honestly | ⚠️ ~4 of 21 components wired |
| E6 | "including yesterday's" | Query history survives reboot; 7/30/90-day charts | ❌ **no telemetry table exists at all** |

**Definition of done:** ten units in ten homes that are not yours, running 30
days unattended, with a support inbox you can actually answer.

---

# PART 0 — VERIFIED BASELINE (2026-08-15)

Everything here was executed against a clean clone of `main` = `70dda20`, not
inferred from documents. This is the ground the plan is built on.

## 0.1 What is real

| Layer | State | Evidence |
|---|---|---|
| Backend | **Real** — 4,069 lines, 15 modules, 19 routes | 310 pytest pass; booted; issued a live token |
| Auth / pairing | **Real** — loopback-scoped issuance, salted token hashes, 5-guess lockout, per-IP rate limit | `test_pairing.py`; end-to-end curl walkthrough |
| Database | **Real but narrow** — SQLite/WAL, 4 tables | `node_identity`, `pairing_codes`, `pairing_attempts`, `devices` |
| Frontend build | **Real** — code-split, 4 build targets | `tsc` clean; 85/85 vitest; `dist-mobile/index.html` produced |
| Android identity | **Frozen** — `today.ionity.gateflame`, 5 places agree, CI asserts it | `capacitor.config.ts`, `build.gradle` |
| CI | **Exists**, runs on PR | `.github/workflows/ci.yml` + `release.yml` |
| Feed receiver | **Real code** — 8 modules, 83 tests | `feed-receiver/` |
| Brand assets | **Real and intact** | `Ionity-Global/ionity-assets…`: `icon-512.png` valid, `ionity-logo-edited.svg` 3872×2581 |

## 0.2 What is not real

| Gap | Consequence |
|---|---|
| **No telemetry table** | E6 impossible. Every chart is instantaneous polling. Reboot = amnesia |
| **CI runs zero tests** | 483 tests exist; CI runs none. Backend untouched by CI entirely |
| **17 of 21 UI components** not wired to live API; 4 are pure `mockData` brochures | E5 partial |
| **Pairing requires SSH** | E3 fails. No kiosk display, no button, no captive portal |
| **No hardware validation ever** | E4 unproven. Container runs only proved fallback paths |
| **Unsigned release** | E2 fails. No keystore exists |
| **No first-boot provisioning** | E1 fails. Requires a human with SSH |

## 0.3 🔴 NEW FINDING — the binary corruption is systemic, not incidental

This changes the priority order and was not known before today.

**All 26 Android PNGs are corrupt**, and have been since the first public commit
`67fefd8`:

```
expected PNG signature: 89 50 4e 47 0d 0a 1a 0a
actual:                 ef bf bd 50 4e 47 ...
                        ^^^^^^^^ U+FFFD — the 0x89 byte was destroyed
```

| File class | Count | U+FFFD sequences |
|---|---|---|
| `mipmap-*/ic_launcher*.png` | 15 | 695 – 6,530 each |
| `drawable-*/splash.png` | 11 | 1,581 – 4,446 each |
| `gradle-wrapper.jar` | 1 | 15,436 (fixed today) |
| `release/GateFlame-Complete-Package.tar.gz` | 1 | 282,516 (deleted earlier) |

**This is the same failure three times.** The entire `android/` tree arrived
through a text-mode pipe — the AI Studio → Antigravity → git path — and every
binary in it was rewritten as UTF-8 with invalid bytes replaced. Nothing that is
binary and came down that path can be trusted.

**Immediate consequence:** `aapt2` reads the PNG signature before crunching.
`./gradlew assembleDebug` will fail with a resource compile error. **The APK step
in the runbook I gave you will not complete until this is fixed.** I'd rather you
hear that from me now than from Gradle at 11pm.

**Structural consequence:** this must be closed as a *class*, not as three
incidents — `.gitattributes`, a CI binary-integrity gate, and a full-repo sweep.
That is why it is Phase 0 item 1 and not a cosmetic task in Phase 6.

---

# PART 1 — THE PLAN

Nine phases. Each has a **gate** — a condition that must hold before the next
phase starts. Phases 5 and 7 run in parallel with engineering because they are
lead-time-bound (legal review, hardware procurement), and starting them late is
the single most common way a hardware product slips a quarter.

Effort is in **working days for one person**, not calendar days.

---

## PHASE 0 — INTEGRITY & CREDENTIALS
**Days 1–3 · 3 days · Blocks everything**

Nothing else is worth doing while binaries silently rot and disclosed
credentials are live.

| # | Action | Detail | Done when |
|---|---|---|---|
| 0.1 | **Full-repo binary integrity sweep** | Script every tracked file: check magic bytes per extension, count U+FFFD. Cover `.png .jpg .jpeg .ico .webp .svgz .jar .apk .keystore .tar.gz .zip .woff .woff2 .ttf .otf .pdf .db` | Report shows every binary either valid or listed for replacement |
| 0.2 | **Add `.gitattributes`** | `*.png binary`, `*.jpg binary`, `*.jar binary`, `*.tar.gz binary`, `*.apk binary`, `*.keystore binary`, `*.woff2 binary`, `*.ico binary`, plus `* text=auto eol=lf` | Committed |
| 0.3 | **Add CI binary-integrity gate** | Fails the build if any tracked binary has a wrong magic byte or contains `EF BF BD`. This is the check that would have caught all three incidents | Red on a deliberately corrupted test file |
| 0.4 | **Regenerate all 26 Android images from real brand assets** | Source: `ionity-assets/nobify/webapp/assets/icon-512.png` (valid) and `images/ionity-logo-edited.svg` (3872×2581). Produce: `ic_launcher` + `ic_launcher_round` + `ic_launcher_foreground` at mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi (48/72/96/144/192 px), adaptive-icon background XML, and `splash.png` port+land at 5 densities. See §Asset Manifest | `aapt2` compiles; icon renders on a handset |
| 0.5 | 🔴 **Revoke both GitHub PATs** | Disclosed in chat 2026-08-14. github.com/settings/tokens and /personal-access-tokens | Both show revoked |
| 0.6 | 🔴 **Rotate `GEMINI_API_KEY`** | aistudio.google.com/apikey, then overwrite all 14 `.env` copies, then delete `ROTATE-ME.txt` | Old key rejected by API |
| 0.7 | 🔴 **Generate + back up the release keystore** | `android/generate-keystore.ps1`. **No recovery path — a lost keystore means every customer must uninstall and re-pair.** Back up to two physically separate encrypted locations. Record the SHA-256 fingerprint in a sealed document | Fingerprint recorded; two backups verified restorable |
| 0.8 | **Apply the deploy fix branch** | `fix/deploy-2026-08-15` — the four defects. Push, PR, merge | On `main` |
| 0.9 | **Enable branch protection on `main`** | Require PR + passing checks. `86deb08` is exactly what this prevents | Direct push rejected |
| 0.10 | **Fix the sandbox/session push rule** | Add to `CONTRIBUTING.md`: authorise the target repo and prove with `git push --dry-run` *before* starting work. This has cost ~7,500 lines once already | Documented |

**🚪 GATE 0:** No tracked binary is corrupt. All three credentials rotated.
Keystore backed up twice. `main` protected.

---

## PHASE 1 — FIRST LIGHT ON REAL HARDWARE
**Days 4–8 · 5 days**

The first time any of this executes on a Pi. Expect surprises — that is the point.

| # | Action | Detail | Done when |
|---|---|---|---|
| 1.1 | Flash Pi 5, static lease `192.168.0.10` | Pi OS Bookworm 64-bit. NVMe preferred over SD (see 7.2) | Boots, SSH reachable |
| 1.2 | `sudo bash deploy-on-pi.sh --with-pihole` | Prereqs → install.sh → caps drop-in → Pi-hole → avahi → validate | Exit 0 |
| 1.3 | **Read the `validate-on-pi.sh` PASS/FAIL table** | **The single highest-information event in this whole plan.** Rows that matter: `/sys/class/thermal`, `vcgencmd get_throttled`, `CAP_NET_ADMIN`, `CAP_NET_RAW`, `ip neigh`, cgroup v2 | Every required row PASS |
| 1.4 | Cross-check thermal against `vcgencmd measure_temp` | Disagreement means one source is lying and telemetry is wrong | Within 2 °C |
| 1.5 | Build + install the debug APK | Blocked on 0.4 | Installs, launches |
| 1.6 | Pair the phone | Discovery via `gateflame.local:8080`, fallback manual `192.168.0.10:8080` | Token issued, dashboard live |
| 1.7 | Confirm Pi-hole numbers are **real** | `totalQueriesToday` must move when you browse. If null → gap correctly named | Numbers track actual browsing |
| 1.8 | **Prove the firewall bouncer on hardware** | `POST /api/v1/firewall/bounce`, confirm `nft list ruleset`, confirm the client is actually blocked, then unbounce | Rule appears and traffic stops |
| 1.9 | **Prove DPI capture** | AF_PACKET SNI/Host parsing against real traffic | Real hostnames in `/flows/recent` |
| 1.10 | 24-hour soak | Leave it running. Watch RSS, temperature, WAL size, log growth | No leak, no thermal throttle, no crash |
| 1.11 | **Write down every surprise** | These become Phase 2 tests | Logged |

**🚪 GATE 1:** Real numbers from real hardware on a real phone. Firewall and DPI
demonstrated *enforcing*, not merely loaded.

---

## PHASE 2 — MAKE THE TESTS TELL THE TRUTH
**Days 9–15 · 7 days**

Your own lesson, from the state doc: *"465 tests green was true and told us
nothing about whether the product could reach its own hardware."* This phase
makes green mean something.

| # | Action | Detail |
|---|---|---|
| 2.1 | **CI runs `vitest run`** | 85 tests. Currently zero run in CI |
| 2.2 | **CI runs `pytest node-agent/tests/`** | 310 tests. The backend is currently untouched by CI |
| 2.3 | **CI runs `pytest feed-receiver/tests/`** | 83 tests |
| 2.4 | **CI runs `ruff check`** | Python lint gate |
| 2.5 | **Contract test: every discovery candidate carries an explicit port** | The test that would have caught defect 1 |
| 2.6 | **Manifest test: `aapt2 dump xmltree` on the built APK** | Asserts `networkSecurityConfig` resolves and cleartext policy is what we think. Would have caught defect 4 |
| 2.7 | **Boot test: agent must answer `/system/status` in CI** | Catches import errors, missing deps, broken routes |
| 2.8 | **Binary integrity gate** (from 0.3) wired into the same workflow | |
| 2.9 | **Add `pytest-cov` + `vitest --coverage`**, publish the number | Not a gate yet — a baseline to argue from |
| 2.10 | **Delete the 36 root codemod scripts** | 33 `*.cjs`, `fix-css.sh`, `update_server_sync.js`, `test.css`. Destructive one-shot regex rewrites; `patch.cjs` rewrites `SettingsManager.tsx` in place. Their work is already in `src/` |
| 2.11 | **Drop one lockfile** | `bun.lock` vs `package-lock.json` both tracked and drifting |
| 2.12 | **Fix `package.json` metadata** | `name` is `"react-example"`, `version` `"0.0.0"`, no `repository` field |
| 2.13 | **Nightly hardware job** | A self-hosted runner *on a real Pi* running `validate-on-pi.sh`. This is the only CI that can ever prove E4 |

**🚪 GATE 2:** A red CI genuinely blocks a broken product. Nightly Pi job green.

---

## PHASE 3 — THE MISSING DATABASE
**Days 16–30 · 15 days · Largest single engineering item**

E6 — *"including yesterday's"* — has no implementation at all. Four tables of
identity and auth cannot answer "how many ads did you block last week."

| # | Action | Detail |
|---|---|---|
| 3.1 | **Design the time-series schema** | `telemetry_samples`, `query_rollup_hourly`, `query_rollup_daily`, `threat_events`, `client_seen`, `flow_summary`. Decide retention per table up front — retention is a POPIA input (Phase 5), not an afterthought |
| 3.2 | **Choose the storage engine** | SQLite is almost certainly right — one file, no daemon, already in use. Evaluate but expect to reject: RRDtool (opaque), InfluxDB/Prometheus (a daemon on a 4 GB appliance), Parquet (no incremental write) |
| 3.3 | **Write the sampler** | Async loop, 60s cadence, into `telemetry_samples`. Must survive Pi-hole being down — a gap is a `NULL` row, never an interpolation |
| 3.4 | **Write the rollup job** | Hourly → daily → weekly. Runs on a timer, idempotent, resumable after power loss |
| 3.5 | **Retention + vacuum** | Raw 7d, hourly 90d, daily 2y. Enforced by a job, not by hope. **Bounded disk is a hard requirement** — an appliance that fills its own SD card is a returned unit |
| 3.6 | **New routes** | `GET /api/v1/history/summary?range=24h\|7d\|30d\|90d`, `/history/threats`, `/history/clients` |
| 3.7 | **Type the contract first** | TypeScript interfaces in `src/types/api.ts` before implementing. The contract is the seam |
| 3.8 | **WAL checkpoint + SD-wear strategy** | Batch writes. An SD card doing 1 Hz fsync for two years dies. Consider `synchronous=NORMAL` + tmpfs staging |
| 3.9 | **Backup / restore / factory reset** | `GET /api/v1/admin/export`, and a reset that wipes history **but keeps node identity** — same class of bug as the `revoke_all`/`provisioned` defect already fixed once |
| 3.10 | **Tests** | Rollup correctness across DST and midnight; retention actually deletes; restart mid-rollup; disk-full behaviour |

**🚪 GATE 3:** Unplug the Pi for a minute. Plug it back in. Yesterday is still there.

---

## PHASE 4 — FINISH THE FRONT END
**Days 25–45 · 20 days · Overlaps Phase 3 from day 25**

Today 4 of 21 components touch live data and 4 are pure brochure.

| # | Action | Detail |
|---|---|---|
| 4.1 | **Audit all 21 components → wire / gate / delete** | Every component gets one of three verdicts. No fourth option |
| 4.2 | **Wire the history views** to Phase 3 routes | 24h/7d/30d/90d charts |
| 4.3 | **Decide the four brochure screens** | `DeploymentScriptViewer`, `DeviceOnboardingSimulator`, `ExportPackagingCenter`, `ServerSyncArchitecture`. These are AI-Studio-era demo furniture. **Recommendation: delete from the shipping app, keep in a `/demo` route behind `VITE_USE_MOCK_DATA`.** A customer must never meet a screen that does nothing |
| 4.4 | **`VITE_USE_MOCK_DATA` as the single mock seam** | One flag. Sales demo without a Pi on the table; same build talks to a real node |
| 4.5 | **`DataSourceBanner` audit** | Assert that *no* fabricated value can render without the banner. Ideally enforce in the type system, not by review |
| 4.6 | **Real empty states** | Fresh node = no history. Design that screen deliberately or it looks broken on day one |
| 4.7 | **Real error states** | Node offline, token revoked, Pi-hole down, disk full — each with a specific message and a specific action |
| 4.8 | **Serve the kiosk** | `node-agent` has no static route, so `/device-kiosk` 404s and the built kiosk HTML is served by nothing. Either add the route or drop the kiosk concept |
| 4.9 | **Accessibility pass** | Contrast, touch targets ≥44px, screen-reader labels, `prefers-reduced-motion` (you have a particle canvas) |
| 4.10 | **Performance pass** | `vendor-charts` is 391 kB. Target <250 kB first paint on a mid-range Android |
| 4.11 | **Dark/light + font loading** | Google Fonts link is missing from `mobile.html`/`kiosk.html` — those two surfaces render in fallback fonts |
| 4.12 | **Frontend test coverage to match** | Every wired component gets a live-data and an error-state test |

**🚪 GATE 4:** Every screen a customer can reach shows either true data or an
honestly-labelled gap.

---

## PHASE 5 — LEGAL, PRIVACY & COMPLIANCE
**Days 16–75 · Runs in parallel · Lead-time bound — start at day 16, not later**

External review has a queue. Starting this late is how launches slip.

| # | Action | Detail |
|---|---|---|
| 5.1 | **POPIA review by a practitioner** | `docs/POPIA-REVIEW.md` §5. **Resolve the s72 cross-border question first** — where `feeds.ionity.today` is hosted determines whether you are exporting personal information |
| 5.2 | **Decide what the feed may ever carry** | Currently health-fields-only, outbound-only, off by default. Freeze that as a contract with a test, before commercial pressure argues otherwise |
| 5.3 | **Privacy notice (s18)** | Does not exist. Required at collection. Must be reachable from the app *and* a public URL — Play Store demands the URL |
| 5.4 | **Breach response plan (s22)** | Does not exist. Notification duties, timelines, named responsible party |
| 5.5 | **Appoint + register an Information Officer** | Registration with the Information Regulator. Has a lead time |
| 5.6 | **Data subject request procedure** | Access, correction, deletion — and how a customer exercises it against a box in their own house |
| 5.7 | **Resolve the licence position** | SPDX headers now read `LicenseRef-AED-900` (the Apache-2.0 contradiction is resolved). Confirm AED 900 / CC BY-NC-SA 4.0 is coherent with *selling hardware* — a non-commercial grant on a commercial product needs a lawyer's eye |
| 5.8 | **`THIRD_PARTY_NOTICES.md`** | Written for the lost backend, never landed. FastAPI, uvicorn, psutil, httpx, React, Recharts, motion, Capacitor, Pi-hole. **Pi-hole is EUPL-1.2 — check redistribution terms carefully if you ship it pre-installed on an image** |
| 5.9 | **Terms of sale + warranty** | CPA (Consumer Protection Act) obligations in ZA: 6-month implied warranty, repair/replace/refund election |
| 5.10 | **Export/import + ICASA** | Confirm whether a networking appliance needs type approval or is exempt |
| 5.11 | **Company + tax** | VAT registration threshold, invoicing, CIPC standing |
| 5.12 | **`SECURITY.md` disclosure policy** | Exists — confirm the contact routes to a monitored inbox |
| 5.13 | **Trademark** | "Gate^Flame" — search and file. The `^` is unusual; check it is registrable and how it is written in plain text |

**🚪 GATE 5:** A practitioner has signed off. Privacy notice is live at a public URL.

---

## PHASE 6 — PLUG AND PLAY
**Days 46–75 · 30 days · This is the product, not a feature**

E1 and E3. Today the box needs a human with SSH. That is not a product.

| # | Action | Detail |
|---|---|---|
| 6.1 | **Build a custom Pi OS image** | `pi-gen` or Packer. Agent + Pi-hole + avahi + systemd baked in. Boots to serving with zero commands |
| 6.2 | **First-boot provisioning** | Generate node identity, generate host keys, expand filesystem, set a unique hostname, seed the DB. Idempotent and resumable — a power cut mid-first-boot must not brick the unit |
| 6.3 | **Solve pairing without SSH** — *pick one, this is the key UX decision* | **(a) Physical button** — press = issue a code, an LED or e-ink shows it. Physical presence stays the authorisation. **(b) Small display** (0.96" OLED / e-ink) shows the code. **(c) Captive portal** — box runs a temporary AP, phone joins, pairs, box joins the real Wi-Fi. **(d) QR sticker** with a per-unit secret. **Recommended: (a) + (b).** It preserves the loopback/physical-presence security model that is already correct, and it is cheap |
| 6.4 | **Status LEDs** | Power / network / filtering-active / fault. A customer must be able to diagnose from across the room |
| 6.5 | **Network auto-configuration** | DHCP by default; detect and warn on double-NAT; handle a router that will not delegate DNS. **Document how the customer points DNS at the box** — this is the step most likely to generate support tickets |
| 6.6 | **OTA update mechanism** | Signed updates, staged rollout, automatic rollback on failed health check. **Do not ship without rollback** — a bad update that bricks 50 boxes in 50 homes is unrecoverable by you |
| 6.7 | **Factory reset** | Physical long-press. Wipes pairing and history; preserves node identity and the ability to re-pair |
| 6.8 | **Watchdog + self-heal** | systemd watchdog, restart-on-failure, hardware watchdog for a hung kernel |
| 6.9 | **Power-loss resilience** | `overlayroot` or at minimum a journaled FS + WAL. Homes lose power; SD cards corrupt on unclean shutdown |
| 6.10 | **Time sync** | NTP before any timestamped write. A box with a wrong clock writes unusable history and cannot validate TLS |
| 6.11 | **Image build in CI + a flashable `.img.xz` artifact** | Reproducible, checksummed, versioned |

**🚪 GATE 6:** Hand a sealed box to someone who has never seen it, with no
instructions beyond the printed card. They get to a working dashboard.

---

## PHASE 7 — HARDWARE, ASSETS & MANUFACTURING
**Days 30–90 · Parallel · Procurement lead times are the constraint**

| # | Action | Detail |
|---|---|---|
| 7.1 | **Freeze the BOM** | Pi 5 (4 GB vs 8 GB — decide from Phase 1 soak RSS), PSU (27 W USB-C PD official — undervoltage is the #1 Pi support ticket), case, cooling, storage, SD/NVMe, Ethernet cable, optional display/button/LEDs |
| 7.2 | **Storage decision** | **NVMe via HAT strongly preferred over microSD.** Phase 3 writes continuously; SD endurance is the most likely 18-month failure mode and every failure is an RMA |
| 7.3 | **Thermal validation** | Pi 5 throttles at 85 °C. Active cooling in a sealed case. Validate at 35 °C ambient — a Gauteng summer in a closed cabinet |
| 7.4 | **Enclosure** | Off-the-shelf vs custom. Ventilation, port access, LED light-pipes, button cutout, branding, mounting |
| 7.5 | **Regulatory marks** | Whatever 5.10 concludes |
| 7.6 | 🎨 **Asset manifest — see §Asset Manifest below.** Nothing on that list is optional | |
| 7.7 | **Packaging** | Box, insert, quick-start card, warranty card, cable ties. The quick-start card *is* the onboarding UX |
| 7.8 | **Serial numbering + provisioning record** | Per-unit serial, node ID, keystore fingerprint, ship date. You need this for RMA and for revoking a stolen unit |
| 7.9 | **Assembly runbook + QA checklist** | 20-point per-unit test: boots, serves, pairs, filters, LEDs, thermals under load, factory reset works |
| 7.10 | **Burn-in** | 24h per unit before shipping. Infant mortality is real and cheaper to catch on your bench |
| 7.11 | **Supplier redundancy** | Two sources for the Pi and the PSU |
| 7.12 | **Pricing** | COGS + assembly + support reserve + warranty reserve + margin. Decide now whether there is a recurring component — it changes the architecture |

**🚪 GATE 7:** Ten units built to the runbook, all passing QA, boxed.

---

## PHASE 8 — DISTRIBUTION & LAUNCH
**Days 76–105 · 30 days**

| # | Action | Detail |
|---|---|---|
| 8.1 | **Google Play Console account** | $25, identity verification has a lead time |
| 8.2 | **Signed release build** | Uses the Phase 0 keystore. Enrol in **Play App Signing** — it is the only recovery path if your upload key is ever lost |
| 8.3 | **Data safety form** | Must match reality exactly. What is collected, why, whether it leaves the device. **A false declaration is a takedown**, and your honest answer is unusually good here: almost nothing leaves the LAN |
| 8.4 | **Store listing** — see §Asset Manifest | Title, short description (80 chars), full description (4000), category, contact, privacy policy URL (Phase 5.3) |
| 8.5 | **Target API level** | Play enforces a floor and raises it annually. Verify before submitting |
| 8.6 | **Closed → open testing track** | Minimum tester counts and duration apply for new personal accounts. **Check the current rule early — it can add weeks** |
| 8.7 | **Deploy `feed-receiver`** | 83 tests, deployed nowhere. Hosting location is a POPIA input (5.1) |
| 8.8 | **Public docs site** | Setup guide, DNS instructions, troubleshooting, FAQ. On `ionity.today` |
| 8.9 | **Support channel** | Monitored inbox, response-time commitment, ticket tracking |
| 8.10 | **RMA process** | Return, diagnose, replace, restock |
| 8.11 | **Status/incident page** | For the feed and OTA services |
| 8.12 | **Ten-unit field trial, 30 days** | Not friends who will forgive things. Real homes, real routers, real support tickets |
| 8.13 | **Launch** | |

**🚪 GATE 8 — the end game:** Ten units, ten homes, 30 days, unattended, with a
support inbox you can answer.

---

# PART 2 — ASSET MANIFEST
*"Leave nothing out, not even a jpeg."*

Source of truth: `github.com/Ionity-Global/ionity-assets-ionity-global-ionity-today`,
branch `main-Ionity`. Verified intact today: `nobify/webapp/assets/icon-512.png`
(512×512, valid), `images/ionity-logo-edited.svg` (viewBox 0 0 3872 2581),
`Ionity_Global_Pty_LTD_Transparrent.png` (1536×1024).

## App icons — **all 26 currently corrupt, all must be regenerated**

| Asset | Sizes | Notes |
|---|---|---|
| `ic_launcher.png` | 48, 72, 96, 144, 192 px | mdpi → xxxhdpi |
| `ic_launcher_round.png` | same 5 | |
| `ic_launcher_foreground.png` | same 5 | Adaptive icon. **Keep artwork inside the safe zone — 66/108 of the canvas.** Anything outside gets masked off on some launchers |
| `ic_launcher_background` | XML or PNG | Solid brand colour is safest |
| `splash.png` | port + land × 5 densities = 10 | Or migrate to Android 12+ `SplashScreen` API and retire these entirely — **recommended** |
| Play Store icon | 512×512 PNG, 32-bit, no alpha | Separate from the app icon |
| Monochrome icon | 1 | Android 13+ themed icons |

## Play Store listing

| Asset | Spec |
|---|---|
| Feature graphic | 1024×500 PNG/JPEG, no alpha |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 |
| 7" tablet screenshots | if declaring tablet support |
| 10" tablet screenshots | if declaring tablet support |
| Promo video | Optional, YouTube URL |
| Short description | ≤80 chars |
| Full description | ≤4000 chars |
| Privacy policy URL | **Mandatory** — from Phase 5.3 |

## Web / docs

Favicon set (16, 32, 180 apple-touch, 192, 512, maskable), OG card 1200×630,
Twitter card, docs-site logo (light + dark), architecture diagram, network
topology diagram, pairing flow diagram, wiring diagram if a button/display ships.

## Print / physical

Product box artwork with dielines, quick-start card (both faces), warranty card,
regulatory label, serial-number label template, enclosure branding artwork
(silkscreen or laser file), QR sticker template if 6.3(d) is chosen.

## Marketing

Product photography (hero, in-situ, unboxing, detail), app screenshots on device
frames, social cards per platform, a one-page PDF spec sheet, email header,
press-kit ZIP.

## In-app

Empty-state illustrations (no history yet / no clients yet / node offline),
error illustrations, onboarding illustrations, module icons ×9, threat-severity
iconography.

**Rule for every asset above:** generate from vector, commit under
`.gitattributes` binary rules, and let the Phase 0.3 CI gate verify it. Three
binaries have already been destroyed on the way into this repo.

---

# PART 3 — CRITICAL PATH & RISK

## The chain that determines the date

```
0.4 icons ──► 1.5 APK ──► 1.6 pairing ──► 1.3 hardware validation
                                                   │
                                                   ▼
              3.x database ──► 4.x frontend ──► 6.x plug-and-play
                                                   │
   5.1 POPIA (start day 16) ────────────────────►  ▼
   7.1 BOM (start day 30) ──────────────────────► 8.x launch
```

**Total: ~105 working days ≈ 5 calendar months** for one person, assuming
Phases 5 and 7 genuinely run in parallel. Sequential, it is closer to eight.

## Top risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Phase 1 hardware validation fails** | Everything downstream is unproven. `vcgencmd`, thermal zones, and cgroup v2 differ on Pi 5 vs Pi 4 | Do it in week one. It is item 1.3 for exactly this reason |
| **Keystore lost** | Catastrophic and unrecoverable | Two encrypted backups + Play App Signing (8.2) |
| **POPIA review returns material findings** | Can force an architecture change to the feed | Start day 16; the feed is already minimal and off by default |
| **SD card wear from Phase 3 writes** | 18-month field failures, every one an RMA | NVMe (7.2) + batched writes (3.8) |
| **Play closed-testing requirements** | Can add weeks for a new account | Check the current rule at 8.1, not at 8.6 |
| **Another binary corruption** | Has happened three times | 0.2 + 0.3 close it as a class |
| **Work lost to an unpushable session** | Has happened once, ~7,500 lines | 0.10 — prove push before starting |
| **Single-person bus factor** | Total | Document as you go; the doc set is already good |

## What I would cut if the date mattered more than the scope

- **Kiosk (4.8)** — the phone is the interface. Cut it and delete the build target.
- **DPI (1.9)** — highest complexity, lowest customer-visible value at launch. Pi-hole plus the firewall bouncer is already a complete product story.
- **Custom enclosure (7.4)** — ship in an off-the-shelf case for the first ten units.
- **Tablet screenshots (8.x)** — declare phone-only.

That removes roughly 20 days. I would not cut Phase 0, Phase 2, or 6.6 (OTA
rollback) under any circumstance.

---

# PART 4 — WHAT I NEED FROM YOU TO SHARPEN THIS

1. **Are you selling this, or is it internal/portfolio?** Phases 5, 7 and 8 are ~60% of the plan and mostly vanish if it is not commercial.
2. **Solo, or is there a team?** All effort figures are one person.
3. **Is there a date?** A launch target changes what gets cut.
4. **Pairing UX decision (6.3)** — button+display, or captive portal? It is the biggest single UX call and it has a BOM consequence, so it wants deciding before 7.1.
5. **Does the DEPLOY bundle still exist** at `C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\`? Your Filesystem connector was down. If it has valid PNGs, item 0.4 gets much shorter.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
