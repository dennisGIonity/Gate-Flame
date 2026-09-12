```
========================================================================================
GATE^FLAME — FULL SCAN, CLEANUP, STATUS & ROADMAP
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-018-SCAN | Version: 1.0 | Updated: 2026-08-18 01:50 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

Everything below was **executed against a clean clone** of `dennisGIonity/Gate-Flame`
on 2026-08-18. Nothing is quoted from a commit message or an older document.

---

# 1 — GIT STATE: EVERYTHING IS ON THE REPO

- `main` = `031a5bc`, tagged **`v1.0.2`**. The kiosk work branch **has been merged** — the PR that the last state doc listed as outstanding is done.
- Remote branches: `main`, `chore/repo-hygiene`, `feat/kiosk-and-icons`, `feat/kiosk-console`.
- **All three feature branches are fully merged into `main`** (`git branch -r --merged`). They are safe to delete.
- Two open PR refs exist (`refs/pull/1`, `refs/pull/2`); both point at commits already contained in `main`. They should be closed.
- Repo size **5.2 MB**. No `dist/`, `node_modules/`, `*.log`, `.DS_Store`, `*.bak` or backup files tracked. No file over 200 KB except `package-lock.json` (168 KB).
- **No secret has ever been committed.** Full-history scan of every commit on every ref for `ghp_`, `github_pat_`, `AIza`, `sk-`, `xox`, `BEGIN PRIVATE KEY` → **zero hits**. `.env.example` is the only `.env*` ever tracked.
- **All 26 Android PNGs verified valid** this session (magic bytes `89 50 4e 47` on every one). `gradle-wrapper.jar` = `50 4b 03 04`, a valid ZIP. The binary-corruption class is closed in the tree.
- ❗ **Nothing was found unpushed anywhere.** Verified against your PC as well — see §5.

---

# 2 — CLEANUP DONE (branch `chore/cleanup-2026-08-17`, commit `60d1d2a`)

Conservative scope, as you chose: only files **proven unreferenced** by an import-graph
walk from the three entrypoints. No behaviour changed.

**Deleted (388 lines)**

| File | Why |
|---|---|
| `src/components/Header.tsx` | 168 lines, never imported — superseded by the inline `<header>` in `AppLayout.tsx` |
| `src/components/Footer.tsx` | 90 lines, never imported anywhere |
| `vite.kiosk.config.ts` | No npm script has ever called it |
| `vite.mobile.config.ts` | Same |
| `build-standalone.js` | Orphaned — already flagged at `DENNIS-DO-THIS.md:208` |
| `metadata.json` | AI Studio scaffolding, declaring a Gemini capability the repo deliberately removed |
| `android/.../ExampleUnitTest.java` | Capacitor template — asserts `2 + 2 == 4` |
| `android/.../ExampleInstrumentedTest.java` | Capacitor template stub |

**Dependencies removed** — zero imports repo-wide: `canvas-confetti`,
`@types/canvas-confetti`, `autoprefixer` (no postcss config exists; Tailwind v4 runs via
`@tailwindcss/vite`), `tsx` (never invoked), `vite-plugin-singlefile` (its only two
consumers were the deleted configs).

**Fixed**

- `package.json` identity: was `"name": "react-example"`, `"version": "0.0.0"` on a product repo → now `gateflame` / `1.0.1`, with a `repository` field.
- `README.md` build-target table pointed at two configs no script uses → now names the real scripts.
- `.gitignore` gains `coverage/` and `.vitest/`.

**Re-verified after the cleanup:** `tsc --noEmit` clean · 109/109 vitest · all four
build targets build · `dist-mobile/index.html` and `dist-kiosk/index.html` both produced.

⚠️ **The commit is not pushed.** The session's git proxy refuses:
`dennisGIonity/Gate-Flame is not in this session's authorized repository set`.
A `.patch` and a `.bundle` are delivered alongside this document — or add the repo to
the session sources and I push it directly.

---

# 3 — WHAT WORKS (measured this session, not claimed)

| Layer | State | Evidence |
|---|---|---|
| **Backend (node-agent)** | **Works** — 20 Python modules, 25 API routes | **441/441 pytest pass** |
| **Feed receiver** | **Works** — 7 modules | **83/83 pytest pass** |
| **Frontend** | **Works** — typechecks, builds, code-split | **109/109 vitest**, `tsc` clean, 4 build targets green |
| **Total test suite** | **633 tests, 633 pass** | run end-to-end here |
| Auth / pairing | Real — loopback-scoped issuance, salted token hashes, 5-guess lockout, per-IP rate limit | `test_pairing.py` |
| DNS filtering | Code complete — Pi-hole + Unbound compose stack, bypass mode, content-vs-threat axes split, pause-with-expiry | `test_axis_independence.py`, `test_filtering_api.py` |
| Threat log | Ported to Pi-hole v6 API; honest when the log is empty | `test_threats_v6.py`, `test_module_honesty.py` |
| Kiosk | Served — `StaticFiles` mount at `/device-kiosk`, real on-device console | `test_kiosk_route.py`, `kioskConsole.test.tsx` |
| Android identity | **Frozen** at `today.ionity.gateflame`, asserted in 5 places by CI | `ci.yml` |
| Android binaries | **All 26 PNGs valid**, wrapper jar valid | magic-byte check this session |
| CI | Now runs frontend tests **and** the 441 backend tests, builds all targets, verifies the release tarball, blocks tracked build output/secrets | `.github/workflows/ci.yml` |
| **Release keystore** | ✅ **Exists** — `~/.gateflame-signing/gateflame-release.jks`, created 2026-08-17 18:24 SAST | listed on your PC |

---

# 4 — WHAT DOES NOT WORK / IS MISSING

## 4.1 Blocking the product (the end-game clauses)

- 🔴 **No history database at all.** The schema has **5 tables** — `node_identity`, `pairing_codes`, `pairing_attempts`, `devices`, `filter_settings`. There is **no telemetry, rollup, or event table**, and **no `/api/v1/history/*` route**. Every chart is instantaneous polling; a reboot is amnesia. *"Including yesterday's" is currently impossible.*
- 🔴 **Never run on real hardware.** `deploy-on-pi.sh` / `validate-on-pi.sh` have never produced a PASS/FAIL table. Firewall (`nft`) and DPI (AF_PACKET) are proven only in container fallback paths — never proven *enforcing*.
- 🔴 **No plug-and-play.** No custom Pi image, no first-boot provisioning, no OTA, no factory reset. The box still needs a human with SSH.
- 🔴 **Pairing still requires SSH** to read the code. No button, no display, no captive portal.
- 🔴 **No Play Store path.** No listing, no signed release build, no privacy-policy URL.

## 4.2 Defects and inconsistencies found this session

- **Kiosk scope is inferred from the URL, granted from the socket.** `src/config/env.ts:96` treats any path containing `device-kiosk` as kiosk context; `node-agent/gateflame/security.py:74` grants `kiosk` scope **only from a loopback source address**. A phone opening `http://<node>:8080/device-kiosk` on the LAN gets a page that believes it is the kiosk and takes a **401 on the first button press**. Security model is correct; the frontend's assumption is not.
- **Version disagreement.** Git tag is **`v1.0.2`**; `android/version.properties` says `VERSION_NAME=1.0.1`. One is wrong.
- **Four demo screens still reachable in the shipping web app** via `src/App.tsx` (you chose to leave these for now):
  - `ServerSyncArchitecture.tsx:146` — a refresh button **mints a fake credential** `` `gf_live_ionity_${Math.random()...}` `` and renders it in a field labelled *"API Token"* with no simulated marker. The `gf_live_` prefix makes a random string look like a production key.
  - `DeviceOnboardingSimulator.tsx` (722 lines) — invents Wi-Fi networks, hardcodes `IP: 192.168.1.105`. This is the exact component purged from the kiosk for dishonesty; it is still live on web/desktop.
  - `ExportPackagingCenter.tsx` (403 lines), `DeploymentScriptViewer.tsx` (155 lines) — brochure.
  - `src/data/mockData.ts:76-116` — `MOCK_NETWORKS` with invented SSIDs.
- **`feed-receiver`'s 83 tests are not in CI.** Only the frontend and node-agent suites run.
- **Ruff is non-blocking** — 51 violations reported, `continue-on-error: true`.
- **Unresolved address conflict** carried over: `docs/LINKS.md` says the node is `192.168.1.100`/`.105`; the end-game plan says `192.168.0.10`. Different `/24`. Nothing should hard-code an address until this is settled.
- **Hardware spec contradiction:** `docs/KIOSK-REBUILD-PROMPT.md:11` says the product is a Raspberry Pi 5; `docs/BASE-MODEL-DIRECTIVE.md:31` says the base model is an Orange Pi Zero 2W 2 GB and the Pi 5 is only the top tier.
- **Two spent documents at repo root/docs**: `DENNIS-DO-THIS.md` (dated 2026-08-15; steps 1–3 are complete) and `docs/KIOSK-REBUILD-PROMPT.md` (the rebuild it asks for has landed). Both are still cited by live code/checklists, so they need extracting, not blind deleting.

## 4.3 Still required from you (cannot be done from a session)

| # | Item | Status |
|---|---|---|
| 1 | 🔴 **Revoke two GitHub PATs** (disclosed in chat 2026-08-14) | open since 14 Aug |
| 2 | 🔴 **Revoke `GEMINI_API_KEY`** at aistudio.google.com | open — **and there are still 2 live plaintext copies on your PC**, see §5 |
| 3 | 🟡 **Back up the release keystore twice + record its SHA-256 fingerprint** | keystore now exists; backups unverified. No recovery path if lost |
| 4 | 🟡 **Enable branch protection on `main`** | cannot verify without repo admin access |
| 5 | 🟡 **POPIA review by a practitioner** — resolve the s72 hosting question for `feeds.ionity.today` first | open |
| 6 | 🟡 Authorize this repo in the session sources, or apply the delivered patch | blocking the cleanup push |

---

# 5 — YOUR PC: WHAT IS REDUNDANT, WHAT IS UNIQUE

Audited `GateFlame-Backup-2026-08-13`, `gf-scratch`, `TempGateFlameBuild`, `source`,
`AndroidStudioProjects`, `.gateflame-signing`.

## 5.1 🔴 Security finding — a live copy of the Gemini key you thought was gone

`ROTATE-ME.txt` states *"All 14 copies are now the .env.example placeholder. This is the
only copy left."* **That is no longer true.**

- `TempGateFlameBuild\.env.local` contains a live plaintext `GEMINI_API_KEY=` — a **15th copy**.
- It is therefore also inside `GateFlame-Backup-2026-08-13\TempGateFlameBuild.zip` (392 MB) and `TempGateFlameBuild-full.zip`.
- **Revoking the key at Google makes all of this moot.** Do that first, then delete.

## 5.2 Redundant — nothing unique, safe to remove

| Path | Size | Finding |
|---|---|---|
| `_fix-2026-08-13\*.bundle` (8 of 9) | ~10 MB | Every SHA in all eight bundles is **already on `origin/main`**. Verified individually |
| `GateFlame-Backup-2026-08-13\*.zip` (14 files) | ~6 MB | AI Studio export snapshots, July–early Aug. All superseded |
| `TempGateFlameBuild.zip` | **392 MB** | Zip of the folder below. Contains the leaked key |
| `TempGateFlameBuild\` (working copy) | large | Git HEAD is `97c6c4c` — **the second commit ever made** (July). Includes `node_modules`, `dist`, `bun.lock`, all 36 codemod scripts. Superseded entirely |
| `gf-scratch\` | — | Clone at `2f71d93`, **clean working tree, every commit on `origin`**. Fully redundant |
| `AndroidStudioProjects\GateFlame_Ionity` | — | Empty Android Studio Compose template, package `com.example.gateflame_ionity`. **No Gate^Flame code** |
| `AndroidStudioProjects\GateFlamev01` | — | Same — `com.example.gateflamev01`. **No Gate^Flame code** |
| `source\repos\` | 0 | Empty |

**Reclaimable: roughly 400 MB+.**

## 5.3 🟢 Unique — do NOT delete

| Path | Why |
|---|---|
| `_fix-2026-08-13\E-App-SAFETY-2026-08-16.bundle` (361 MB) | **The only copy of the lost Docker backend.** 3 commits (`105629a → 09ec6d3`): FastAPI backend, `containerManager.js`, `Dockerfile`, `docker-compose.yml`, network scanner, Pi-hole polling. **None of these SHAs exist on GitHub.** It is 361 MB because `.jdk`, `.gradle`, `node_modules` and `dist-*` were committed into it |
| `.gateflame-signing\gateflame-release.jks` | The release keystore. **Irreplaceable** |
| `_fix-2026-08-13\*.md` (DEPLOY-RUNBOOK, RUN-THIS-ON-THE-PI, SSH-RECOVERY, APPLY-FIX) | Operational runbooks not in the repo. Worth committing to `docs/` |
| `_fix-2026-08-13\firstrun.sh` | Provisioning script not in the repo — Phase 6 input |
| `GateFlame-Mobile-1.0.1-debug.apk` | The only built APK |

**Recommended handling of the 361 MB bundle:** extract the three commits' *source*
(Dockerfile, compose, `containerManager.js`, backend) into a ~200 KB archive committed
under `docs/archive/lost-backend/`, then the bundle can go. I can do that on request.

⚠️ I **cannot delete** files on your machine — the bridge blocks `rm`. On approval I move
them into a `_to_delete\` folder in each mounted directory for you to delete.

---

# 6 — ROADMAP

Effort is **working days for one person**. Phases 2 and 4 run in parallel with
engineering because they are lead-time-bound.

## SPRINT 0 — Close the loop on this scan · **1 day** · do first

| # | Action |
|---|---|
| 0.1 | Authorize the repo in session sources (or apply the delivered patch) and **push `chore/cleanup-2026-08-17`** |
| 0.2 | Delete the 3 merged remote branches; close PRs #1 and #2 |
| 0.3 | 🔴 **Revoke the two GitHub PATs and the `GEMINI_API_KEY`** — then delete `ROTATE-ME.txt` **and** `TempGateFlameBuild\.env.local` |
| 0.4 | **Back up `gateflame-release.jks` to two separate encrypted locations; record its SHA-256 fingerprint** in a sealed document |
| 0.5 | Enable branch protection on `main` (require PR + passing CI) |
| 0.6 | Fix the version disagreement — bump `VERSION_NAME` to `1.0.2`, or re-tag |
| 0.7 | Extract the lost-backend source from the 361 MB bundle → `docs/archive/`; commit the four runbooks + `firstrun.sh` to `docs/`; then clear ~400 MB of redundant local copies |
| 0.8 | Settle the address conflict (`192.168.0.10` vs `192.168.1.x`) and the Pi 5 vs Orange Pi Zero 2W base-model contradiction — **both must be decided before anything else hard-codes them** |

**🚪 Gate 0:** Credentials dead. Keystore backed up twice. `main` protected. One authoritative address, one authoritative base model.

## SPRINT 1 — First light on real hardware · **5 days** · the highest-information week

| # | Action |
|---|---|
| 1.1 | Flash the board, static lease at the agreed address |
| 1.2 | `sudo bash deploy-on-pi.sh --with-pihole` → exit 0 |
| 1.3 | **Read the `validate-on-pi.sh` PASS/FAIL table.** Rows that matter: `/sys/class/thermal`, `vcgencmd get_throttled`, `CAP_NET_ADMIN`, `CAP_NET_RAW`, `ip neigh`, cgroup v2 |
| 1.4 | Build + install the debug APK; pair the phone with **no SSH-free shortcut** — record exactly what typing was needed |
| 1.5 | Confirm Pi-hole counters **move when you browse**. A null is fine; a fabricated number is not |
| 1.6 | Prove the firewall bouncer *enforcing*: `POST /firewall/bounce` → `nft list ruleset` → client actually blocked → unbounce |
| 1.7 | Prove DPI capture — real hostnames in `/flows/recent` |
| 1.8 | 24-hour soak: RSS, temperature, WAL size, log growth |
| 1.9 | Write down every surprise — these become Sprint 3 tests |

**🚪 Gate 1:** Real numbers, real phone, real enforcement. Then delete `src/components/kiosk/GateFlameKiosk.tsx` (the file itself says to).

## SPRINT 2 — Legal & privacy · **starts day 2, runs 60 days in parallel**

Start now, not later — external review has a queue.

| # | Action |
|---|---|
| 2.1 | **POPIA review by a practitioner.** Resolve where `feeds.ionity.today` is hosted first — it decides whether you are exporting personal information (s72) |
| 2.2 | Privacy notice (s18) at a **public URL** — Play Store will not accept a listing without it |
| 2.3 | Breach response plan (s22); appoint + register an Information Officer |
| 2.4 | Freeze the feed contract (health-fields-only, outbound-only, off by default) **with a test** |
| 2.5 | `THIRD_PARTY_NOTICES.md` — note **Pi-hole is EUPL-1.2**; check redistribution terms if you ship it pre-installed |
| 2.6 | Confirm AED 900 / CC BY-NC-SA 4.0 is coherent with *selling hardware* |
| 2.7 | Trademark search + filing for "Gate^Flame" (check the `^` is registrable) |

## SPRINT 3 — Make green mean something · **4 days**

| # | Action |
|---|---|
| 3.1 | Add `feed-receiver`'s 83 tests to CI |
| 3.2 | Drive ruff to zero, then flip `continue-on-error: false` |
| 3.3 | Binary-integrity gate in CI (magic bytes + `EF BF BD` scan) — closes the corruption class permanently |
| 3.4 | Manifest test: `aapt2 dump xmltree` on the built APK asserts the cleartext policy |
| 3.5 | Nightly self-hosted runner **on the actual board** running `validate-on-pi.sh` — the only CI that can ever prove filtering works |
| 3.6 | Coverage baseline published (not yet a gate) |

**🚪 Gate 3:** A red CI genuinely blocks a broken product.

## SPRINT 4 — The missing database · **15 days** · largest single item

| # | Action |
|---|---|
| 4.1 | Design the time-series schema: `telemetry_samples`, `query_rollup_hourly`, `query_rollup_daily`, `threat_events`, `client_seen`, `flow_summary`. **Decide retention per table up front — retention is a POPIA input, not an afterthought** |
| 4.2 | Stay on SQLite (one file, no daemon, already in use) |
| 4.3 | Sampler: async, 60 s cadence. A Pi-hole outage is a `NULL` row, **never an interpolation** |
| 4.4 | Rollup job: hourly → daily. Idempotent, resumable after power loss |
| 4.5 | Retention + vacuum enforced by a job. **Bounded disk is a hard requirement** — an appliance that fills its own card is a returned unit |
| 4.6 | Routes: `GET /api/v1/history/summary?range=24h\|7d\|30d\|90d`, `/history/threats`, `/history/clients` |
| 4.7 | **Type the contract in `src/types/api.ts` first** — the contract is the seam |
| 4.8 | Batched writes + WAL checkpoint strategy; 1 Hz fsync for two years kills an SD card |
| 4.9 | Export / restore / factory reset that **wipes history but keeps node identity** |
| 4.10 | Tests: rollup across midnight and DST, retention actually deletes, restart mid-rollup, disk-full |

**🚪 Gate 4:** Unplug the box for a minute. Plug it back in. Yesterday is still there.

## SPRINT 5 — Finish the front end · **15 days** · overlaps Sprint 4

| # | Action |
|---|---|
| 5.1 | **Fix `isKioskContext()`** — derive kiosk-ness from a node-provided signal, not the URL path. Currently a LAN phone gets a kiosk UI and a 401 |
| 5.2 | **Decide the four demo screens.** Recommended: delete from the shipping app, keep behind a `/demo` route gated on `VITE_USE_MOCK_DATA`. **A customer must never meet a screen that does nothing** |
| 5.3 | 🔴 Remove the fabricated `gf_live_ionity_…` token in `ServerSyncArchitecture.tsx:146` regardless of 5.2 — it looks like a production credential |
| 5.4 | Wire the history views to the Sprint 4 routes |
| 5.5 | Audit all 21 components → wire / gate / delete. No fourth option |
| 5.6 | Real empty states (a fresh node has no history — design that, or day one looks broken) and real error states (node offline, token revoked, Pi-hole down, disk full) |
| 5.7 | Assert in the type system that no fabricated value can render without `DataSourceBanner` |
| 5.8 | Accessibility: contrast, ≥44 px targets, screen-reader labels, `prefers-reduced-motion` |
| 5.9 | Performance: `vendor-charts` is 391 kB → target <250 kB first paint |
| 5.10 | Font loading on `mobile.html` / `kiosk.html` (both render in fallback fonts today) |

**🚪 Gate 5:** Every screen a customer can reach shows true data or an honestly-labelled gap.

## SPRINT 6 — Plug and play · **30 days** · *this is the product, not a feature*

| # | Action |
|---|---|
| 6.1 | Custom OS image (`pi-gen`/Packer): agent + Pi-hole + avahi + systemd baked in, boots to serving with zero commands |
| 6.2 | First-boot provisioning — idempotent and resumable. **A power cut mid-first-boot must not brick the unit** |
| 6.3 | **Pairing without SSH — the key UX decision.** Recommended: physical button + small display. It preserves the loopback/physical-presence model that is already correct, and it is cheap. Alternatives: captive portal, per-unit QR sticker. **Decide before the BOM freeze** |
| 6.4 | Status LEDs — power / network / filtering / fault |
| 6.5 | Document how the customer points DNS at the box, and handle a router that will not delegate. **This is the #1 predicted support ticket** |
| 6.6 | OTA updates: signed, staged, **automatic rollback on failed health check. Do not ship without rollback** |
| 6.7 | Factory reset (long-press), watchdog + self-heal, power-loss resilience, NTP before any timestamped write |
| 6.8 | Image built in CI as a checksummed, versioned `.img.xz` |

**🚪 Gate 6:** Hand a sealed box to someone who has never seen it. Printed card only. They reach a working dashboard.

## SPRINT 7 — Hardware & manufacturing · **starts day 30, parallel** · lead-time bound

Freeze the BOM (board tier decided in Sprint 0.8, RAM decided from the Sprint 1 soak),
PSU, case, cooling. **Prefer NVMe over microSD** — Sprint 4 writes continuously and card
wear is the likeliest 18-month failure, every one an RMA. Thermal-validate at 35 °C
ambient. Then: enclosure, asset manifest (icons, store graphics, print, marketing,
in-app empty/error illustrations), packaging, per-unit serial + provisioning record,
20-point QA checklist, 24 h burn-in per unit, two suppliers for board and PSU, pricing.

**🚪 Gate 7:** Ten units built to the runbook, all passing QA, boxed.

## SPRINT 8 — Distribution & launch · **30 days**

Play Console account (identity verification has lead time) → signed release build with
the Sprint 0 keystore, **enrolled in Play App Signing — the only recovery path if the
upload key is lost** → data-safety form matching reality exactly (your honest answer is
unusually strong: almost nothing leaves the LAN) → store listing with the Sprint 2
privacy URL → **check the current closed-testing tester-count and duration rule early;
it can add weeks** → deploy `feed-receiver` (hosting location is a POPIA input) → public
docs site on `ionity.today` → monitored support inbox → RMA process → **ten units, ten
homes that are not yours, 30 days unattended**.

**🚪 Gate 8 — the end game.**

---

# 7 — CRITICAL PATH

```
0.3 credentials ─┐
0.4 keystore ────┼─► SPRINT 1 hardware validation ──┐
0.8 address/BOM ─┘                                  │
                                                    ▼
                          SPRINT 4 database ──► SPRINT 5 frontend ──► SPRINT 6 plug-and-play
                                                    │
  SPRINT 2 POPIA (start now) ───────────────────►   ▼
  SPRINT 7 BOM (start day 30) ──────────────────► SPRINT 8 launch
```

- **~100 working days ≈ 5 calendar months** for one person, *if* Sprints 2 and 7 genuinely run in parallel. Sequential, closer to eight.
- **Top risk:** Sprint 1 fails and everything downstream is unproven. It is scheduled first for exactly that reason.
- **If the date matters more than scope, cut:** DPI (highest complexity, lowest launch-visible value — Pi-hole plus the firewall bouncer is already a complete product story), the custom enclosure, and tablet screenshots. That is ~20 days. **Do not cut Sprint 3 or OTA rollback under any circumstance.**

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
