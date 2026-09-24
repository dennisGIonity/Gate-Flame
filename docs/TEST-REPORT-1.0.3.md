```
========================================================================================
GATE^FLAME 1.0.3 — TEST REPORT (STANDARD BOX)
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-024-TEST | Version: 1.0 | Updated: 2026-09-24 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

Every line below says what was checked, where, and what came back. Anything not run is
marked **NOT RUN** with the reason — a blank or a guess is never recorded as a pass.

## 1. Build under test

| Item | Value |
|---|---|
| Source | `github.com/dennisGIonity/Gate-Flame`, branch `fix/mobile-dns-drops` (the only local copy is `E:\Gateflame`) |
| App version | 1.0.3, Android versionCode 15 |
| APK | `GateFlame-Mobile-1.0.3-debug.apk`, 4,796,075 bytes, sha256 `5AC1130C…07BF0D79` |
| Test device | Raspberry Pi 5 16 GB, Trixie, node `GF-72TYTITQ`, on the isolated Ionity lab (H3C, `192.168.124.3`, eth0 only) |
| Operator machine | Wabakipi laptop, lab `192.168.124.4`, fleet console `:8091` |

## 2. Consolidation — one repo, one folder

30 local folders named like the project were scanned (`tools/find-copies.sh`). All git
copies point at `dennisGIonity/Gate-Flame`. Exactly one commit existed nowhere else
(`a7962f5`, a 2026-08-13 scratch archive) — it is on GitHub as
`archive/temp-build-scratch-2026-08-13`. The old "Gate^Flame Finishing touches" project was
merged into `docs/archive-finishing-touches/` on 2026-09-12. The remaining unmerged remote
branches (`fix/mobile-hookup` and its two copies) were checked hunk by hunk: their fixes
(`onTokenRejected`, the import-cycle break) are already in the current code.

## 3. Automated suites — all green

Run with `tools/run-all-suites.sh` on 2026-09-24.

| Suite | Result |
|---|---|
| node-agent pytest | **649 passed** (was 647 + 2 failed; see §5) |
| fleet pytest | **12 passed** |
| feed-receiver pytest | **83 passed** |
| TypeScript `tsc --noEmit` | **clean** |
| vitest (kiosk, mobile, Ionibot, services) | **212 passed** in 15 files |
| Web build, kiosk bundle, mobile bundle | built; `verify-bundle` confirms production React |
| Shell syntax (`bash -n`) every `.sh` | clean |
| APK debug build | OK; `capacitor.config.json` in the built app read back: `allowMixedContent: true` |

## 4. Lab move — read back from the laptop

| Check | Result |
|---|---|
| Pi reachable on the lab only | `192.168.124.3` :22/:53/:8080/:8081 OPEN; household `192.168.0.11` no reply |
| Household network untouched | household DNS still resolves (`google.com` via `192.168.0.1`) |
| Pi-hole bound to the lab address only, DHCP off | `192.168.124.3:53` + loopback; `dhcp.active=false` |
| Agent identity | `/system/status` → `GF-72TYTITQ`, `provisioned: true`, `storageHealthy: true` |
| Filtering | `doubleclick.net` → `0.0.0.0` |
| Recursive resolution | **BLOCKED BY LAB** — the H3C's WAN port has no uplink, so non-blocked names SERVFAIL and the Pi's clock cannot sync. Needs one cable (H3C WAN → a TP-Link LAN port). |

## 5. Defect found and fixed in this pass

**The watchdog's LAN-renumber self-heal could not read `.env` on some systems.** It used
`grep -oP`, and PCRE is not compiled into every `grep`. A failed read came back as
"unset", so the function rewrote a key it had never read. Fixed with a portable `awk` read
that also tolerates CRLF; both regression tests pass again.

## 6. Live feature verification on the device

**PENDING** the release install on the lab Pi (`tools\DEPLOY-RELEASE.cmd`, one sudo
password). This section is filled from `tools/stage-pi-release.last.txt` and the screenshots
once that has run.

## 7. Not run, and why

| Item | Why |
|---|---|
| `install-all.sh` on a blank SD card | New in 1.0.3; no blank Pi was available. The individual installers it chains are the ones the lab box was built with. |
| Signed (Play Store) release APK | Blocked on the signing-key decision; the stored keystore did not open with the recorded password. Debug build supplied. |
| End-to-end with a real household router | Deliberately not done on the household network; the lab router has no internet uplink yet (§4). |

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
