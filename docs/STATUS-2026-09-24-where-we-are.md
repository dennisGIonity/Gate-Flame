```
========================================================================================
GATE^FLAME — STATUS 2026-09-24: WHERE WE ARE / WHERE WE ARE GOING
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-024-STATUS | Version: 1.0 | Updated: 2026-09-24 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

**Sources read for this document.** `CLAUDE.md`; `docs/PIN-2026-09-21.md`,
`PIN-2026-09-10.md`, `PIN-2026-09-06.md`; `gateflame-STATE-resume-here.md` (v11, 08-31);
`archive-gateflame-STATE-2026-08-17.md` (listed, not re-read in full);
`GATEFLAME-ROADMAP-2026-08-24.md`; `ADR-001-DNS-AUTHORITY-MODEL.md`;
`DENNIS-OUTSTANDING-ACTIONS.md` (superseded 08-31); `FUNCTION-STATUS-AND-BUGS.md`;
`STATUS-2026-09-13.md`; `TEST-REPORT-2026-08-31.md` (listed, not re-read in full);
`TEST-REPORT-2026-09-15.md`; `MERGE-2026-09-12-finishing-touches.md` (F7–F10);
`CARRYOVER-VERIFICATION-2026-09-20.md` (§1);
`archive-finishing-touches/gateflame-two-tier-endgame.md` (listed only);
`E:\.IONITY-LAB\README.md`; `E:\.ESP32-MCP\docs\HANDOFF.md`; today's run outputs
`tools/history-dump.last.txt`, `tools/lab-probe.last.txt`, `tools/lab-pi-id.last.txt`.
No `SPRINT*` or `BUG*` file exists in `docs/`. Bugs are tracked inside
`FUNCTION-STATUS-AND-BUGS.md`.

---

## 0 — The correction that changes how to read the pin

`PIN-2026-09-21.md` §1 concluded that **"the LAN renumbered to 192.168.124.0/24"**. It did not.
Dennis was building a **separate, isolated lab**, and that is what the pin measured:

| | Household (leave alone) | Ionity Lab (where Gate^Flame goes) |
|---|---|---|
| Router | TP-Link EX511, `192.168.0.1`. Internet only | H3C Magic, `192.168.124.1` |
| Laptop | Wi-Fi `192.168.0.3` (internet) | Ethernet `192.168.124.4` (DHCP reservation, lab only) |
| Pi 5 | **currently here**: `192.168.0.11` on Wi-Fi, MAC `88-A2-9E-27-A1-8F` | target. Not on it yet |

Measured today (`tools/lab-probe.last.txt`, 09:26):
- The lab ping sweep of `.124.1–60` found only the laptop (`.124.4`).
- `192.168.0.11`: `:22` OPEN (`OpenSSH_10.0p2 Debian-7+deb13u4`), `:53` TIMEOUT, `:8081` TIMEOUT.
  Gate^Flame is paused by `E:\.IONITY-LAB\PAUSE-GATEFLAME.cmd` (`.ESP32-MCP/docs/HANDOFF.md`: *"GateFlame disabled on the Pi 5 (user confirmed)"*).
- `192.168.0.11:8080` OPEN, but `/api/v1/system/status` returned an **Open WebUI** HTML page, not the agent.
  **Consequence:** the CLAUDE.md "a route's status code settles deployment" rule gives wrong answers
  on `:8080` until this is resolved.
- The H3C web UI at `192.168.124.1` timed out from the laptop (`lab-pi-id.last.txt`).
- The ssh-agent was not running (`Error connecting to agent: Connection refused`).

**Not settled:** the pin's `.124.17/.18` hosts (MACs `88-a2-9e-27-a0-9e/…9d`, every TCP port RST).
The Pi's Wi-Fi MAC is now `…27-A1-8F`. All three MACs are in the same Raspberry Pi range, so
`.124.17/.18` may have been this Pi's wired/wireless pair while it sat on the H3C with services paused,
or a different board. This document does not claim which. The pin's root-cause finding still holds
either way: `dns-stack/.env` pins `GATEFLAME_LAN_IP=192.168.0.10`, and Pi-hole cannot bind port 53 on
any other address. `dfdca9d` fixes this in code, and `tools/lab-resume-gateflame.sh` fixes it on the box.

---

## 1 — Timeline (from git and the pins)

| Date | Milestone | Evidence |
|---|---|---|
| 2026-08-13 | Initial public release, then the AI Studio import. Signed-APK build and CI added | `67fefd8`, `384c9fc`, `7de065e` |
| 08-14 | node-agent rebuilt from scratch, with the pairing UI. `applicationId` frozen as `today.ionity.gateflame` | `919856a`, `d5a1bcd` |
| 08-15 | nftables bouncer, DPI, WAN budget, feed receiver. Kiosk served. 26 corrupt PNGs repaired | `6a8e1ba`, `1cf9b10`, `2a5020b` |
| 08-16 | **The box actually filters**: Pi-hole + Unbound. Bypass mode, pause, honesty fixes | `bd8f552`, `85c31b1`, `ad9a873`, `eb7178f` |
| 08-17 | Threat log ported to Pi-hole v6. CI runs 548 tests. Tag `v1.0.2` on main | `fecdfc5`, `d127262`, `031a5bc` |
| 08-18/19 | Mobile-disconnect RCA. Watchdog made to probe both listeners. Router-config setup | `fa1dcd3`, `65dce06`, `fbaf16c` |
| 08-23 | Ionibot support desk bundled in the app, working offline | `7307a50` |
| 08-24 | **ADR-001 accepted.** CLAUDE.md created. Found that the box had "never filtered" and fixed it. Mobile app rebuilt. Roadmap v2 | `da01ab4`, `8ef97f7`, `df24d31`, `87168f0`, `b630554`, `1de884e` |
| 08-25 | Rule Zero: one banner, one copy, one identity | `ca6405b` |
| 08-30 | Shield (VPN Gate, per-device, per-region). Real console login + Builds panel. Fake-data shell removed. Fleet dashboard live | `43f5b24`, `407380d`, `3f81a79`, `b3e3f24`, `2e0977e` |
| 08-31 | Fleet v2 (history, per-node tokens). Device names. Ionibot on the kiosk. PoC v0.5. **Last pushed state of `main` (`011257c`)** | `b1cd9bb`, `be3b864`, `d6958db`, `b779a2b` |
| 09-06 | POPIA s18 privacy notice + Play data-safety mapping. Gravity timeout fixed. `prove-it.ps1` | `d8aecab`, `654dbf4`, `a85451c` |
| 09-09 | Gravity timeout sized from a cold download | `6db09d5` |
| 09-10 | All simulated data removed. Brand v1.1. `.DUMP`, profiles, Cloudflare upstream, on-box ML. Desktop (Electron) + tag `desktop-v1.0.2` | `77ad81b`, `eb3b25e`, `e751344`, `7e483cd` |
| 09-12 | Finishing-touches project merged. Fabricated credential removed. SSH/PowerShell trap recorded | `5ae59c4`, `87e8160`, `478e575` |
| 09-13 | BUG-01/02 fixed. Fleet autostart staged. **BUG-18** (`X-FTL-SID`) fixed | `86da151`, `4ef06e5` |
| 09-15 | **BUG-19**: first time the mobile app ever worked on a real handset. Final test report. Last push (`4d7b064`) | `cb73644`, `4d7b064` |
| 09-20 | C-drive reconciliation. Lost Docker backend recovered. 09-16 proof captures committed | `270008d`…`770e99c` |
| 09-21 → 09-24 | Deep audit (~30 fixes + tests). Pin written. **Not pushed** | `dfdca9d` |
| 09-22/23 | Ionity Lab built (H3C, ESP32 boards). Gate^Flame paused on the Pi | `E:\.IONITY-LAB\README.md`, `.ESP32-MCP/docs/HANDOFF.md` |

---

## 2 — DONE and verified live (with evidence)

| Capability | Last live proof | Source |
|---|---|---|
| Node identity, provisioned, storage healthy (`GF-72TYTITQ`, agent 0.1.0) | `/system/status` 200, 2026-09-15 | `TEST-REPORT-2026-09-15.md` §3 |
| Loopback-only `kiosk` scope and read-only LAN view | 401 on LAN / "Protection status withheld", 09-15 | same, §4 |
| DNS filtering | `doubleclick.net → 0.0.0.0`, 359,667–425,410 gravity domains, `active` (08-31) | `gateflame-STATE-resume-here.md` §0 |
| Mobile app on a real handset (S10e): Home, Activity, Blocked, Network, Health, Settings, Shield list + rename, splash | Real data (207,207 lookups / 52,991 blocked), 09-15 | `FUNCTION-STATUS-AND-BUGS.md` BUG-19, `STATUS-2026-09-13.md` §1 |
| Shield country list (VPN Gate) and device names (`PUT /clients/{mac}/name`) | 200 live, 08-31 | `FUNCTION-STATUS-AND-BUGS.md` §1 |
| Pi-hole rate limit fix | Read back as `0` | `gateflame-STATE-resume-here.md` §3 |
| Fleet dashboard ingest, tokens, history, admin, notes | Live Pi posting on 08-31. Only an empty-state run on 09-15 | `FUNCTION-STATUS-AND-BUGS.md` §4, `TEST-REPORT-2026-09-15.md` §5 |
| Windows desktop portable | Built and run, found the node (09-10) | `PIN-2026-09-10.md` |
| Debug APK `VERSION_CODE=14 / 1.0.2` | Installed on the S10e, 09-15 | `STATUS-2026-09-13.md` |
| Test suites | node-agent 649, fleet 12, vitest 212, `tsc` green (09-21, workstation) | `PIN-2026-09-21.md` §2 |

Everything above was proven on the **old** household addresses (`192.168.0.10`). None of it has been
re-proven since the Pi was paused and Open WebUI took `:8080`.

---

## 3 — Built but NOT deployed, or NOT verified

| Item | State | Source |
|---|---|---|
| The **09-10 agent** (profiles, accessibility, Cloudflare upstream, ML, `/system/storage`) | Returned 404 on the box on 09-10 and 09-13. Never deployed | `PIN-2026-09-10.md`, `STATUS-2026-09-13.md` |
| **BUG-18** Pi-hole `X-FTL-SID` header fix | Never confirmed against a live box | `FUNCTION-STATUS-AND-BUGS.md` |
| **09-21 audit** (`dfdca9d`): `sync_lan_ip_env()`, `:?` compose guards, resolv.conf, RA exact match, secret redaction, `upstream.py` real read-back, `{clients,gap}`, Ionibot token/shape fixes, five-state kiosk | In the repo only. Not pushed and not deployed | `PIN-2026-09-21.md` §3 |
| `GET /system/feed` (BUG-07 visibility) | 404 on the box 09-15 | `TEST-REPORT-2026-09-15.md` §3 |
| DNS watchdog / IPv6 self-heal (the phone-drop fix), RA advertiser | Not on the Pi | BUG-10, STATE §7 |
| Fleet autostart (`tools/install-fleet-autostart.ps1`) | Staged, never run or reboot-proven | BUG-06 |
| Firewall bounce, `.ovpn` handoff, console PIN, 90-day retention, idle re-lock, Ionibot | Never exercised on hardware | BUG-04/05/08, `STATUS-2026-09-13.md` |
| DoT for the Cloudflare modes | Not built (plain 53, `encrypted: false`) | `PIN-2026-09-10.md` |
| macOS/Linux desktop | Built by CI on the `desktop-v1.0.2` tag. Result not recorded in any doc | `PIN-2026-09-10.md` |
| Screenshots, two per feature (pin step 5), and `TEST-REPORT-2026-09-21.md` | Not started | `PIN-2026-09-21.md` §5 |
| Release keystore | `cert-info.txt` holds *"Keystore was tampered with, or password was incorrect"*. The keystore was also pasted into a chat as base64 | STATE 08-31, `FUNCTION-STATUS-AND-BUGS.md` §7 |
| History database (Sprint B) | Not started: no `telemetry_samples` table and no `/history/*` route | `FUNCTION-STATUS-AND-BUGS.md` §7 |

---

## 4 — Open decisions that belong to Dennis (quoted)

1. **Ionibot on the kiosk.** CLAUDE.md: *"mobile app only, never the kiosk"*. STATE 08-31: *"Ionibot on the
   wall console (was mobile-only)."* The code has it mounted: `KioskApp.tsx:388` *"Ionibot, mounted on the wall
   console as well as the phone."* The history is mixed too: `d6958db` "Ionibot on the kiosk", then `daf1067`
   "…Ionibot deferred on the kiosk". Which one stands? (`PIN-2026-09-21.md` §4 #2)
2. **Cubie A7A-6GB and going inline.** *"how would this change and work if i was to say lets change it, because
   of radxa 6gb we can go inline and take over dns?"* Unanswered. ADR-001's load-shedding argument does not
   depend on RAM. (`MERGE-2026-09-12` F7/F8, `STATUS-2026-09-13.md` #15)
3. **The `protectionStatus` contract.** The code has five states, `active|paused|bypass|degraded|unconfigured`,
   and `applying` is a separate boolean. CLAUDE.md lists `applying` as the fifth state. The code, the TS type
   and the tests agree with each other, so CLAUDE.md needs his correction. (`PIN-2026-09-21.md` §4 #1)
4. **The allow route.** There is no `/filtering/allow` (per-site allow). Ionibot now says honestly that it is
   not built. *"Product decision: build or remove the actions."* (§4 #4)
5. **The router-revert route.** There is no `POST /pair/router/revert`. Same choice. (§4 #4, STATE §7)
6. **The router-authority flow** (STATE §4): a guided one-screen flow (recommended), a per-model adapter, or
   premium-only.
7. **The Headscale control plane.** Where it is hosted, what the consent notice says, and whether it is
   premium-only. It unblocks both remote support and Shield exit servers. (`FUNCTION-STATUS-AND-BUGS.md` §6)
8. **The keystore.** Regenerate before the first Play upload (*"costs nothing"*) or keep it. (`MERGE` §F1, `STATUS-2026-09-13.md` #3)
9. **Fleet host and fixed addresses.** Use a DHCP reservation, or move the fleet to fixed hardware
   (`fleet/deploy/gateflame-fleet.service`). (BUG-07, `STATUS-2026-09-13.md` #2)
10. **New, from today's facts:**
    - **Port 8080 on the Pi.** Open WebUI holds it, and every Gate^Flame client assumes the agent is on 8080.
      Which one moves?
    - **The Pi's screen.** `SETUP-PI-LAB.cmd` puts the ESP32 dashboard kiosk on the Pi's screen, but "the product
      IS the kiosk" (`gateflame-kiosk.service`). Which one owns the screen in the lab?
11. Carried from the docs: premium pricing (standard is decided at R49/month, first month free, roadmap Sprint H),
    Pi-hole EUPL-1.2 redistribution (lawyer), and the `DeploymentScriptViewer` / brochure panels (delete or gate).

---

## 5 — Where we're going

### 5.1 Roadmap, in order (`GATEFLAME-ROADMAP-2026-08-24.md`)

`A` Close out the household (2d) → `E` Prove it on hardware (5d) → `B` History DB (15d) → `F` Plug and play (30d)
→ `G` Make green mean something (4d, alongside F) → `I` Launch (30d). Running in parallel from day 1: `C` Play
Store (30–45 d queue) and `D` POPIA/legal (60 d). `H` Hardware/BOM starts on day 30. Roughly 90 working days
if the parallel tracks really run in parallel.

**Where each sprint stands:**
- **A** is re-scoped by the lab. The "household" is now the **lab**, and the TP-Link must not be touched.
  A.3–A.6 become H3C tasks. A.7 (revoke credentials) and A.8 (keystore) are still open.
- **B** has not started.
- **C**: the privacy notice is drafted (`d8aecab`) but not published. Annex B blockers remain.
- **D**: the Information Officer is named and SA hosting is recorded (PIN 09-06). Practitioner review, the
  breach plan and IO registration are open.
- **E, F** have not started.
- **G**: the feed-receiver tests are in CI (09-12). Ruff is still non-blocking.

### 5.2 Play Store blockers (CLAUDE.md "Distribution", roadmap C, `STATUS-2026-09-13.md` #5–9)

- **Signed release APK.** Blocked on the keystore decision. `android/keystore.properties` has never been written.
- **Play App Signing** enrolment at the first upload.
- **Public privacy URL.** `docs/web/privacy.html` is ready for `ionity.today/privacy`. Annex B first: company
  registration number, IO registration, the kiosk "what we send" screen, a breach plan, `SECURITY.md`.
- **Data-safety form.** Declare *Device or other IDs* (per-device Shield state leaves the box).
- **versionCode discipline.** Settled at **1.0.2 / code 14** (`PIN-2026-09-21.md` §4 #7). Code 14 must not be reused.
- **Closed-testing tester count and duration rule.** Not checked yet.
- **Play Console account and identity verification.** No doc records it being started.
- **Store assets.** None exist (screenshots, feature graphic, 512×512 icon).

### 5.3 Subscription, VPN, fleet console

The recurring model is decided: R49/month, and *"that function alone justifies us asking a subscription"*
(the VPN). The fleet console is the billable surface. Today it is hand-started, not reboot-safe, has no TLS
(`deploy/Caddyfile.example`, PIN 09-21 §4 #6) and has no remote-action channel. The VPN direction is WireGuard,
Ionity-branded, per-device, with country and continent choice. Oracle Free and customer exit nodes are ruled
out, and the `.ovpn` handoff is *"rather dodgy"*. Ionity exit servers do not exist (`controlPlaneReachable: false`).
Both depend on the Headscale decision (§4 #7). A customer box needs a consent screen and a kill toggle before
its feed is switched on (STATE §5c).

### 5.4 Next 10 concrete actions, in priority order

1. **Move the Pi into the lab.** Plug the Pi's Ethernet into an H3C **LAN** port (or join it to `IONITY-LAB`),
   then run `tools\LAB-RESUME-GATEFLAME.cmd`. It refuses unless the Pi holds `192.168.124.x`. It undoes the
   lab pause, rewrites `dns-stack/.env`, brings the DNS stack up, and reads every port back from the laptop.
   Settle the **Open WebUI / :8080** conflict first (§4 #10). Otherwise the read-back reports "NOT the
   GateFlame agent".
2. **Reserve the Pi's address on the H3C** (DHCP reservation, as was done for `.124.4`). This is the third
   address move to break things (BUG-07).
3. **Load the key, commit, push.** Run `tools\load-key.cmd`, then commit the pin edit + lab/push tools, then
   `tools\git-bash.cmd /e/Gateflame/tools/push-if-key.sh` to push the 7 unpushed commits. Run `tools\doctor.cmd`
   before and after.
4. **Deploy `dfdca9d` to the Pi.** Use `tools/stage-pi-full.sh` plus one `sudo /tmp/gfstage/install.sh`. This
   carries the 09-10 agent, BUG-18 and the renumber self-heal. Then check that Threats/Filtering show real,
   non-null Pi-hole numbers (the BUG-18 proof).
5. **ADR-001 in the lab.** Set the **H3C's** upstream/WAN DNS to the Pi's lab address and leave the DHCP DNS
   alone. Verify with `nslookup doubleclick.net 192.168.124.1` → `0.0.0.0`. Settle the H3C's IPv6/RDNSS
   behaviour. The TP-Link stays untouched.
6. **Screenshots + `TEST-REPORT-2026-09-21.md`.** This is pin step 5: two shots per feature across the kiosk,
   mobile, fleet and Pi-hole `:8081`. The test phone must join `IONITY-LAB` for the mobile shots.
7. **Fleet on the lab.** Start `fleet/start-fleet.ps1` on the laptop, repoint the Pi's `GATEFLAME_FEED_URL` to
   `http://192.168.124.4:8091/api/v1/nodes`, and run and reboot-prove `install-fleet-autostart.ps1` (BUG-06).
8. **Revoke credentials.** AWS pair first, then OpenAI, the two GitHub PATs and `GEMINI_API_KEY`. Delete
   `TempGateFlameBuild\.env.local` (BUG-12, `FUNCTION-STATUS-AND-BUGS.md` §7).
9. **Keystore decision** (§4 #8). Then write `keystore.properties`, build the first signed release, and start
   Play Console identity verification (roadmap C.1). That starts the longest queue.
10. **Get Dennis's rulings** on §4 #1–5 and #7. Then start **Sprint B (history DB)**, the largest build item left.

---

## 6 — Stale facts in CLAUDE.md (listed only; CLAUDE.md not edited)

1. **The "CURRENT PIN" banner** says *"the LAN moved to 192.168.124.x, the box is down"*. That was the lab being
   built. The household is still `192.168.0.0/24`.
2. **Live estate, Pi**: eth0 `.0.10` / wlan0 `.0.13`, "port 53 on .10". Now the Pi is at `192.168.0.11` (Wi-Fi,
   `88-A2-9E-27-A1-8F`), Gate^Flame is paused, and it is headed for `192.168.124.x`.
3. **Live estate, workstation**: `192.168.0.7` with DNS set to `192.168.0.10`. Now it is Wi-Fi `192.168.0.3`
   (DNS `192.168.0.1`) and Ethernet `192.168.124.4` (DNS `192.168.124.1`). STATE 08-31 already noted `.6`.
4. **Fleet URL** `http://192.168.0.3:8091`. `.0.3` is now the laptop's own Wi-Fi address, and nothing listened on
   `:8091` on 09-21. The lab target would be `192.168.124.4:8091`. (`DENNIS-OUTSTANDING-ACTIONS.md`'s `.0.6:8080`
   is older still.)
5. **Router**: the EX511 is described as the product's router. It is now household-only and off limits. The lab
   router is the **H3C Magic** at `192.168.124.1`, model details not yet read.
6. **The status-code rule's example URL** `http://192.168.0.10:8080/...`. That address is wrong, and `:8080` on the
   Pi currently answers as Open WebUI (200 HTML), which defeats the 404/401 test.
7. **`protectionStatus` "FIVE values"** lists `applying` as the fifth. The code uses `unconfigured`, and `applying`
   is a boolean (§4 #3).
8. **Version disagreement** (tag `v1.0.2` vs `VERSION_NAME=1.0.1`). This is resolved: 1.0.2 / code 14 everywhere.
9. **IoniBot "mobile app only, never the kiosk"**. The code mounts it on the kiosk (§4 #1).
10. **"Mobile work in `C:\Users\DGMic\GateFlame-Repo`"**. This conflicts with Rule 3. `CARRYOVER-VERIFICATION-2026-09-20.md`
    shows that clone holds nothing unique.
11. **Pi `provisioned: true` "as of 2026-08-31"**. The last live read was 09-15, and nothing has been read since the pause.
12. **PIN §1's "sshd refuses"**. `:22` answers on `192.168.0.11` today.

---

## 7 — Git state (read-only, `tools/history-dump.sh` → `tools/history-dump.last.txt`, 09:30)

- **Checked out:** `fix/mobile-dns-drops`, **7 ahead / 0 behind** `origin/fix/mobile-dns-drops`. **Not pushed.**
- **`main`** = `origin/main` = `011257c` (2026-08-31). PR #3 is still unmerged. `CARRYOVER-VERIFICATION` counted
  37 commits ahead of `origin/main` at `4d7b064`, so it should be about 44 now. That number is derived, not
  re-measured.
- **Unpushed commits** (all `DennisIonity`):
  `dfdca9d` 09-24 deep audit + pin · `770e99c` C-drive clearing script · `f75cf26` reconcile C: by content ·
  `eb71e68` carry C: originals, redact token · `3308a9e` recover lost Docker backend (closes A8) ·
  `cefdad4` verify carry-over · `270008d` commit 09-16 proof captures.
- **Uncommitted:** `M docs/PIN-2026-09-21.md`.
  - Untracked scripts that should be committed (per CLAUDE.md rule 6): `tools/LAB-RESUME-GATEFLAME.cmd`,
    `lab-resume-gateflame.sh`, `lab-probe.ps1`, `lab-pi-id.ps1`, `push-if-key.sh`, `esp32-import.sh`,
    `esp32-survey.sh`, `history-dump.sh`.
  - Untracked run outputs (`tools/*.last.txt`, `local-console.*.txt`) are not committed by convention.
  - The BUG-17 files (`android/version.properties`, `vite.standalone.config.ts`, `debug.cjs`) **no longer appear**
    in `git status`. Whether they were committed or reverted was not checked.
- **Remote-only branches (stale):** `chore/repo-hygiene` (08-15), `feat/kiosk-and-icons` and `feat/kiosk-console`
  (08-17), `fix/mobile-hookup`, `recovered/mobile-hookup`, `rescue/repo-c-fix/mobile-hookup` (08-18).
- **Tags:** `v1.0.2`, `checkpoint-2026-08-30-main-synced`, `checkpoint-2026-08-30-verified`, `desktop-v1.0.2`.
- **Identities across all history:** 105 `DennisIonity`, 14 `Johan Wilhelm van Antwerp` (the historic mistake,
  left as is per Rule 4), 10 Claude, and 13 across five other Dennis aliases. The only new commit since 09-15
  is under `DennisIonity`.
- The PIN mentions a stale 0-byte `.git/index.lock` from 09-21. `git status` ran without error today, but this
  document does not confirm whether the file is gone.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
