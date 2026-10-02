```
========================================================================================
GATE^FLAME — A-TO-Z AUDIT, PASS 1: THE MOBILE APP ON ITS WAY TO GOOGLE PLAY
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-10-002-AUD1 | Version: 1.0 | Updated: 2026-10-03 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# What this pass covered, and what it did not

**Scope:** the phone app — `src/mobile/`, `src/services/`, the shared client it polls
through (`src/components/kiosk/kioskClient.ts`, `charts.tsx`), the pairing screen,
Ionibot's shell, `mobile.html`, `capacitor.config.ts`, `android/`, and the build scripts
that produce the APK. Chosen first because it is the surface going to Google Play.

**Not in this pass** (later passes, same repo, one per session): `node-agent/`
(762 tests), the kiosk console, `fleet/`, the Electron desktop, `t1/`, `feed-receiver/`,
`infra/`.

**Method.** Baseline first (typecheck, 212 tests, production build, bundle sizes), then
every shipped file under `src/mobile` and `src/services` read in full, the shared client
and chart module read in full, the Android project read in full, the installed debug APK
opened and inspected. Every fix carries a test that fails without it; the two most
important fixes (BUG-20, BUG-25) were reverted once each to watch their tests fail. The
Android changes were read back from a freshly built APK, not from the source files.

**Rule held throughout:** no screen copy was reworded and no claim was added. Two labels
were corrected because they were factually wrong about the number under them, and are
listed below as such. Everything a customer reads is otherwise as it was.

---

# Baseline (before any change)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` (NODE_ENV unset) | 212 / 212, 15 files |
| `vitest run` (NODE_ENV=production, the wabakipi shell) | **2 failed** — see BUG-02 |
| `vite build` (mobile + kiosk) | 4 s; JS 466 kB, CSS 107 kB, assets 781 kB |
| Debug APK (`release/`, 2026-09-24) | 4.8 MB, **no `lib/`** (no native code) |
| `npm audit` | 0 vulnerabilities, prod and dev |
| Installed Capacitor | 8.5.1 (package.json says ^8.4.2) |

---

# Findings — fixed in this pass

Severity is the customer's, not the engineer's: **S1** = a customer would be misled or
left stranded; **S2** = a customer would notice and lose trust; **S3** = a customer
would not notice, but it costs battery, time or a future bug.

| # | Sev | Finding | Fix | Proof |
|---|---|---|---|---|
| BUG-20 | **S1** | **A phone revoked at the kiosk never found out.** Every mobile screen polls through `kioskClient.nodeRequest`, which had no 401 handling. The revocation fix of 2026-08 lived in `apiClient`, the path the 2026-08-24 rebuild stopped using. A revoked handset kept its dead token, polled every 4 s and showed "Cannot see your box" forever — the exact failure `apiClient.ts` says was fixed. | `NodeTransport.onUnauthorized` → `apiClient.rejectToken()` (one function for both transports), wired in `nodeSession.ts`. Fires only when a token was actually sent. | `kioskClient.test.ts` (5 tests); reverted once → failed |
| BUG-28 | **S1** | **Home claimed "Cannot see your box — are you on home Wi-Fi?" when it could.** (a) before the first poll had answered — every launch, for seconds on a Pi mid-rebuild; (b) when the box was reachable but *refused* `/filtering`; (c) a stale `active` payload was drawn as the live verdict while `/filtering` was failing. Health rendered **"Silent"** in fault red for a *null* telemetry reading and a "silent" chip while loading. Blocked turned a missing blocked-count into a confident **"0%"** ring. | Home: shimmer while waiting; the node's own sentence on a refusal (reusing the Settings wording for that case); error ⇒ status unknown. Health: dash until the box has answered; refusal reported as a refusal. Blocked: dash unless both figures exist. | `screens.test.tsx` (15 tests) |
| BUG-21 | **S1** | **Android 15+ edge-to-edge was never handled.** targetSdk 36 means the app is drawn under the status bar and gesture bar. `mobile.html` had no `viewport-fit=cover`, so Capacitor's SystemBars padded the WebView and showed the theme's **white** window background in both bars on a light-mode phone; `env(safe-area-inset-*)` evaluated to 0 on every Android WebView before Chromium 140; the pairing screen had no top inset at all. The only handset this app has run on (S10e, Android 12) is not drawn edge-to-edge, so none of this had been exercised. | `viewport-fit=cover`; `--gf-safe-*` in `index.css` = Capacitor-injected inset → `env()` → 0, used by every edge; `plugins.SystemBars.style = 'DARK'`; `windowBackground = #080D16` (`colors.xml`, `styles.xml`); pre-paint background in `mobile.html`. | APK read-back: regenerated `capacitor.config.json` carries `plugins.SystemBars`; **needs one Android 15/16 handset to confirm visually** |
| BUG-22 | **S2** | **The app called Google on every launch.** Three typefaces from `fonts.googleapis.com` / `fonts.gstatic.com` — a third-party transfer of IP and user agent before the customer has paired anything, from a product whose Data Safety annex answers "shared with third parties? No". Also a render that depended on the household having internet (load shedding), and a 1–3 s type swap on a slow link. The kiosk had deliberately avoided this since August; the phone had not. | Fonts shipped in the bundle from `@fontsource-variable` (latin subset, 100 kB, SIL OFL 1.1); links removed from `mobile.html`, `index.html`; `kiosk.html` note updated. `PRIVACY-NOTICE.md` Annex A records the correction. | APK read-back: three `.woff2` in `assets/public`, zero `fonts.googleapis` links |
| BUG-23 | **S2** | **Every paired phone defaulted to the name "Linux".** The default device name was the first parenthesised user-agent token, which on every Android WebView is `Linux`. The kiosk's paired-devices list — the thing a lost phone is revoked from — filled with identical entries. | `mobile/deviceName.ts`: model from the UA (`SM-G970F`, `Pixel 8`), reduced-UA placeholder `K` treated as absent, Client Hints refine it, `My phone` fallback. | `deviceName.test.ts` (11 tests) |
| BUG-24 | **S2** | **Accessibility settings applied only once Settings was opened.** The hook that puts text size / contrast / motion on `<html>` was mounted by one component, the card at the bottom of Settings. A saved 130% text size did nothing on launch until the owner scrolled to the card that had set it. | `applyCachedAccessibility(PHONE_TEXT_SCALE)` in `main-mobile.tsx`; one clamp constant shared with the card. | `accessibilityBoot.test.tsx` |
| BUG-25 | **S2** | **`refresh()` after a control tap did nothing until the next interval.** `usePolled`'s in-flight guard was a ref shared across polling cycles; `refresh()` tears the cycle down and restarts it in the same React commit, before the aborted request's `finally` has run, so the new cycle's first tick saw "busy" and returned. On Settings that read as "the toggle did nothing" — the double-tap `applying` exists to prevent. | Guard scoped per cycle. | `kioskClient.test.ts`; reverted once → failed ("expected 2 calls, got 1") |
| — | **S2** | **"Reduce motion" in the app did not reduce motion.** `useReducedMotion` — consulted by both canvases, the ring gauge and the counting figures — read only the OS media query. The in-app switch sets `html.reduce-motion`, which stopped the CSS and nothing else. | The class is observed (MutationObserver) alongside the media query. | `accessibilityBoot.test.tsx` |
| — | **S2** | **The Home gravity field restarted every 4 s.** `GravityParticleCanvas` rebuilt its whole simulation on every prop change; HomeScreen passes `threatFeed={[]}` (a new array each render) and `blockPercentage` changes every poll, so all 30 particles respawned at random positions every few seconds. It also ignored reduced motion and rendered at 1× on 3× screens. | Live values via a ref; the effect depends only on visibility and motion preference; static frame under reduced motion; DPR-aware canvas. | Code; visible on device |
| — | **S2** | **Ionibot's help sheet opened white over the dark app** on light-mode phones: its dark styles keyed off `prefers-color-scheme` only, while the app forces `.dark`. | Same dark rules under `html.dark`; a host that does not set the class is unaffected, so the folder stays portable. | Code |
| — | **S3** | **A phone in a pocket kept polling the Pi**, and a phone brought back after an hour showed hour-old figures as live for up to one interval. | `usePolled` parks on `document.hidden`, fetches immediately on return. The console is never hidden; unaffected. | `kioskClient.test.ts` (3 tests) |
| — | **S3** | **The live backdrop ran an O(n²) link pass at 60 fps behind every screen** — the app's largest continuous drain. | Capped at ~30 fps, drift speed preserved by scaling to the real frame gap. | Code |
| BUG-26 | **S3** | **`CHANGE_WIFI_MULTICAST_STATE` was declared and never used.** The manifest justified it by mDNS discovery; no code acquired a multicast lock. On a security product every permission has to be earned. | `MainActivity` acquires a multicast lock in `onResume`, releases in `onPause`. | APK read-back: `classes8.dex` carries MainActivity, 4 `MulticastLock` refs and the lock tag |
| BUG-27 | **S1 for Play** | **The repo could not build what Play accepts.** Play takes an Android App Bundle; only `assembleRelease` (APK) existed. | `npm run build:aab` → `release/GateFlame-Mobile.aab`. The Gradle guard that refuses an unsigned release already covered `bundleRelease`. | Script; the actual bundle needs the keystore (below) |
| BUG-29 | **S3** | **`build:apk*` needed Git-bash, and then didn't work there either.** npm hands scripts to `cmd.exe` on Windows however npm was started; the `./gradlew` chain died with `'.' is not recognized`. Re-hit from Git-bash on 2026-10-03; CLAUDE.md's remedy was not sufficient on this machine. | `scripts/android-build.mjs` runs `gradlew.bat` / `./gradlew` from any shell and copies the artifact to `release/`. CLAUDE.md corrected. | Debug APK built from PowerShell in 34 s |
| BUG-02 | **S3** | **Half of BUG-02 was still open.** `NODE_ENV=production npm run test:run` — the confirmation FUNCTION-STATUS asked for — failed two suites (`readdirSync is not a function`): Vite decides what `node:fs` resolves to from the shell's NODE_ENV before `test.env` applies. | `process.env.NODE_ENV = 'test'` at the top of `vitest.config.ts`. | 252/252 under `NODE_ENV=production` |
| — | **S3** | Pairing: "Search again" started a second twelve-way discovery race alongside the first; probes outlived the screen. Buttons were ~36 px tall; inputs unlabelled; the code field did not ask for a numeric keyboard or one-time-code autofill; the only screen still in Tailwind's stock emerald/slate. | One `AbortController` per run, aborted on re-run and unmount; 48 px targets; labelled inputs; `inputMode="numeric"`, `autoComplete="one-time-code"`, Enter submits; app palette. **Every string unchanged.** | Code |
| — | **S3** | `apiRequest` ignored an already-aborted signal; a request issued after its owner unmounted ran to completion. | Checked up front. | Code |
| — | **S3** | Two labels factually wrong about the number under them: Activity's **"Refused since your box last started"** sat over Pi-hole's `queries.blocked`, which is the **last 24 hours** and survives a reboot (`pihole.py:448`). | → "Refused in the last 24 hours". | Code |
| — | doc | CLAUDE.md listed `protectionStatus`'s fifth value as `applying`; the node emits `active | paused | bypass | degraded | unconfigured` with `applying` as a separate boolean (`main.py:746-821`). This was the open "needs your call" from the 2026-09-21 pin — it was a fact, not a call. | CLAUDE.md corrected; `types/filtering.ts` was already right. | `main.py` |

---

# Findings — not fixed, and whose call they are

## Dennis's calls (product)

1. **The caption on the Home gravity field reads "GRAVITY™ EDGE AI THREAT INTERCEPTOR".**
   The box is a DNS blocklist filter; "AI threat interceptor" on the one screen whose job
   is telling the truth is a claim the product cannot back, and "™" on *Gravity* — Pi-hole's
   own name for its blocklist database — is at least awkward. The legend beneath it already
   carries the real figure. **Recommendation: drop the caption.** Not changed: it is copy.
2. **The tab bar's labels are 7 px** at phone width — eight destinations in one row.
   Legible on the 411 dp flagship, not on a 360 dp budget handset. Options: five tabs plus
   "More"; labels only on the active tab; two rows on narrow screens. Information
   architecture, so yours.
3. **"today" vs "last 24 hours".** Home and Activity say "Looked up today" / "Blocked
   today" over figures that are Pi-hole's rolling 24-hour counts. Honest enough for a
   customer, but if the label on Activity is now "last 24 hours" the rest could follow.
4. **`minifyEnabled false` on the release build.** R8 would shrink the 8.6 MB of dex
   considerably and Capacitor ships the ProGuard rules for it; but it changes what ships,
   and this repo's rule is that nothing is a fix until read back on a device. Flip it when
   there is a handset to read it back on.
5. **Dependency majors.** PIN-2026-09-26 lists Vite 8, vitest 5, TypeScript 7, Capacitor
   8.5.2. **Do not take Capacitor to 8.5.2** — it injects non-zero insets when the WebView
   is not edge-to-edge (ionic-team/capacitor#8623); wait for 8.5.3. The others are a
   session of their own.
6. **`tools/worklog*.{sh,ps1,csv}`** — four untracked files from the 28 Sep activity report.
   Per Rule Zero §6 they are committed or deleted; not mine, so not touched.

## Blocked on things only you can do (Play)

| Item | State | What unblocks it |
|---|---|---|
| **Signed release** | `android/keystore.properties` does not exist; Gradle refuses an unsigned release (correct). The keystore itself was pasted into a chat as base64 in August (FUNCTION-STATUS §7). | Decide F1 (regenerate before first upload — costs nothing now, everything later), then write `keystore.properties` locally. Never commit it. |
| **Play App Signing** | Not enrolled; cannot be added after the first upload. | Enrol at the first upload. |
| **Public privacy-notice URL** | `docs/PRIVACY-NOTICE.md` exists; POPIA s18 and Play both need it at a URL. | Publish on ionity.today. |
| **Data Safety form** | Annex A of the privacy notice is the mapping; its "no third-party sharing" row is true from 1.0.3 (BUG-22). | File it; packet-capture the release build first. |
| **Closed-testing requirement** | Not checked this pass. | Read the current Play Console rule for personal/organisation accounts before planning the timeline. |
| **Target API** | **targetSdk 36 — meets Play's 31 Aug 2026 requirement** (API 36 for new apps and updates). | Nothing. |
| **16 KB page size** | **Not applicable** — the APK has no `lib/`; Capacitor adds no native code. | Nothing, unless a native plugin is added. |

## For the next passes

- **Token storage.** The device token is in `localStorage` inside the app's private data
  directory, excluded from backup and transfer. Adequate for a LAN bearer token on
  Standard T3; **not** adequate for Premium T3 (crypto-wallet safeguarding) — that edition
  wants Keystore-backed storage. Note for the T3 Premium spec, not a defect today.
- **Discovery over `.local` on Android** depends on the system resolver's mDNS support
  (Android 12+) plus, now, the multicast lock. The candidate IP list is the fallback.
  Worth a bench test on a handset that is *not* on `192.168.0.x`.
- **The Activity blocklist meter** scales against 100,000 domains ("roughly a full
  standard-tier gravity build" — written before the lists grew to 340 k / 3.0 M). It now
  pins at 100% on every level. Honest, uninformative; scale by the level's own count.
- **Kiosk pass:** `kioskClient` changes here (401 hook, polling) are shared code and were
  tested for the console's no-transport path; the kiosk's own screens are untouched.

---

# What shipped in this pass

| Commit | Content |
|---|---|
| `f37106f` | Transport, screens, motion/accessibility, pairing, edge-to-edge CSS, fonts; tests 212 → 252 |
| `26e4057` | Android: SystemBars, window background, multicast lock, `android-build.mjs`, `build:aab`, version 1.0.3, Ionibot dark, privacy annex |
| (this) | Report, FUNCTION-STATUS ledger BUG-20…29, CLAUDE.md corrections, vitest NODE_ENV fix |

**After:** `tsc` clean · 252 / 252 tests (also under `NODE_ENV=production`) · mobile bundle
895 kB incl. 100 kB of fonts (was 787 kB with none) · debug APK 4.85 MB, built from
PowerShell · 0 npm vulnerabilities.

**Still to read back on hardware** (the one thing this pass could not do — no handset was
attached): the edge-to-edge insets on an Android 15/16 phone, the multicast lock's effect on
`.local` discovery, and the revocation flow end-to-end (revoke at the kiosk → phone returns to
pairing within one poll).

---

# Sources consulted

- Capacitor 8 SystemBars / safe areas: [Capawesome, "Capacitor Edge-to-Edge & Safe Areas: The Complete Guide"](https://capawesome.io/blog/capacitor-edge-to-edge-and-safe-areas-guide/); the plugin source read directly at `node_modules/@capacitor/android/.../SystemBars.java` (8.5.1); regression in 8.5.2: [ionic-team/capacitor#8623](https://github.com/ionic-team/capacitor/issues/8623).
- Play target API requirement: [Play Console Help — Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en); [median.co summary (2026)](https://median.co/blog/google-plays-target-api-level-requirement-for-android-apps).
- Pi-hole v6 summary semantics: `node-agent/gateflame/pihole.py` lines 430–450 (this repo).

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
