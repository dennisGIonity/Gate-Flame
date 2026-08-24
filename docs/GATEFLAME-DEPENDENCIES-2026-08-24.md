```
========================================================================================
GATE^FLAME — DEPENDENCIES & THINGS NEEDING ATTENTION
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-024-DEPS | Version: 1.0 | Updated: 2026-08-24 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

Read off `package.json`, `requirements.txt` and the running box on 2026-08-24,
after the dependency cleanup in `2df4a13`.

---

# PART 1 — PHONE APP

## 1.1 Runtime dependencies

| Package | Version | Why it is there | Risk |
|---|---|---|---|
| `@capacitor/core` | ^8.4.2 | The native shell. Without it there is no app | Major-version upgrades have historically broken the cleartext policy — see 1.4 |
| `@capacitor/android` | ^8.4.2 | Android platform | Tracks Capacitor core; upgrade together |
| `react` / `react-dom` | ^19.0.1 | UI | Low |
| `lucide-react` | ^0.546.0 | Icons. Tree-shaken; only the used glyphs ship | Low. Pre-1.0, so pin before launch |
| `clsx` + `tailwind-merge` | ^2.1.1 / ^3.6.0 | Class composition in `lib/utils.ts` | Low |
| `@tailwindcss/vite` | ^4.1.14 | Tailwind v4 — no postcss config exists | Low |

**Not used by the phone app** and present only for the web demo surface:
`recharts` (~373 kB), `motion` (~129 kB), `zustand`. The phone bundle is
**285 kB** and contains none of them — the console's charts are hand-rolled SVG.

## 1.2 Deliberately NOT depended on

| Not installed | Why it matters |
|---|---|
| Any charting library | The plan forbids one. Every chart is hand-rolled SVG in `kioskUi.tsx` |
| `@capacitor/network` | IoniBot probe A1 degrades to `unknown`, and `unknown` never resolves to a confident state. Installing it unlocks more specific copy at the cost of a native rebuild. **Standing rule: IoniBot adds no required dependency** |
| A QR scanner | Needed for Sprint F.3. Will be the first new native dependency; budget an Android rebuild for it |
| Any analytics or crash SDK | Nothing about a customer's network should leave their LAN. If this ever changes it needs its own consent screen and POPIA review |

## 1.3 Needs tending — phone

| # | Item | Severity |
|---|---|---|
| P1 | **`android/keystore.properties` does not exist** — `build:apk` cannot sign a release. Debug builds are unaffected | 🔴 blocks Play |
| P2 | **Keystore not backed up, fingerprint not recorded.** Lose the file and the app can never be updated under the same listing | 🔴 |
| P3 | **`versionName` disagreement** — tag `v1.0.2` vs `version.properties` `1.0.1`. Settle before the first upload; Play rejects a reused `versionCode` | 🟡 |
| P4 | **`allowMixedContent: true` must survive every Capacitor upgrade.** Capacitor serves from `https://localhost`, so every LAN call is mixed content. Commit `7de065e` turned this off believing the network-security config replaced it — it does not, and the app silently lost its only function. Add the `aapt2` manifest test in Sprint G.4 | 🔴 |
| P5 | **`lucide-react` is pre-1.0.** Pin exactly before launch rather than carrying `^` | 🟡 |
| P6 | **No native secure storage.** The pairing token is in `localStorage`. The mobile plan (A4) asks for Android Keystore-backed storage — a rooted `adb` pull can currently read it | 🟡 |
| P7 | **Pairing is over plain HTTP.** Anyone on the Wi-Fi can read the token in transit. The plan's D1 decision — self-signed cert + pinning — is unanswered. **Retrofitting after units ship means re-pairing every device in the field** | 🔴 decide before hardware |
| P8 | Portrait layout verified only on a landscape emulator. The Android 13 instance crashed three times tonight | 🟡 |

## 1.4 Capacitor upgrade checklist

Because this has bitten once and cost the product its entire function:

1. `allowMixedContent` still `true` in `capacitor.config.ts`.
2. `network_security_config.xml` still referenced from the manifest.
3. `applicationId` still `today.ionity.gateflame`.
4. Install the built APK on a device and confirm it reaches a node.

---

# PART 2 — NODE AGENT (the box)

## 2.1 Python runtime

| Package | Constraint | Why | Risk |
|---|---|---|---|
| `fastapi` | >=0.115 | The API | `@app.on_event` is **deprecated** — two call sites in `main.py`. Migrate to lifespan handlers |
| `uvicorn[standard]` | >=0.30 | ASGI server | Low |
| `psutil` | >=6.0 | Real host telemetry | Low |
| `httpx` | >=0.27 | Pi-hole v6 client | Low |

Four runtime dependencies. That restraint is worth keeping — it is why the agent
installs cleanly on a 2 GB board.

## 2.2 System dependencies on the box

| Thing | Used by | Note |
|---|---|---|
| **Docker + compose** | Pi-hole and Unbound | `wabapi` is in the `docker` group, so most operations need no sudo |
| `pihole/pihole:latest` | DNS filtering | **EUPL-1.2 — check redistribution terms before shipping it pre-installed** (Sprint D.5). `latest` is a **floating tag**: pin a digest before manufacturing |
| `klutchell/unbound:main` | Recursive resolution | Also a floating tag. Pin it |
| `bash` | Every operational script | Not POSIX `sh`. `netcheck.py` reports an honest gap if absent |
| `ip`, `nft` | clients, firewall | `nft` needs `CAP_NET_ADMIN` |
| `avahi` | `gateflame.local` discovery | Publishes every address the box holds — a hazard while dual-homed |
| `vcgencmd` | Throttle detection | Pi-specific. Absent on Orange Pi — must degrade, not fail |
| `systemd` | Service, drop-ins, watchdog timer | Drop-ins live at `/etc/systemd/system/gateflame-node-agent.service.d/` |

## 2.3 Needs tending — box

| # | Item | Severity |
|---|---|---|
| B1 | **Pi-hole admin password exposed** in a session transcript today. `systemctl show -p Environment` dumps the whole environment — never run it in a shared context | 🔴 rotate |
| B2 | **Floating image tags.** `pihole:latest` can change under a shipped unit. TP-Link firmware taught this lesson: a silent upstream change in a customer's house is the worst failure shape | 🔴 pin before manufacturing |
| B3 | **Dual-homed on one /24** — eth0 `.10`, wlan0 `.13`, port 53 on `.10` only. ARP flux makes DNS intermittent and per-device. Detected, deliberately not auto-fixed | 🟡 |
| B4 | **Router advertises IPv6 with no default route.** Phones prefer it, stall on every AAAA, decide the Wi-Fi is broken, and drop to mobile data. Self-heal written, not deployed | 🟡 |
| B5 | **Router is not forwarding to the box.** Only Wabakipi is filtered | 🔴 |
| B6 | **`@app.on_event` deprecated** — two sites in `main.py` | 🟢 |
| B7 | **Telnet is open on the router, port 23.** Worth closing regardless of Gate^Flame | 🟡 |
| B8 | **`open-webui` is running on the box.** Not mentioned in any Gate^Flame doc. On a 16 GB Pi 5 it is harmless; on a 2 GB base-tier board it would not fit. Establish what put it there before the BOM freeze | 🟡 |
| B9 | **`/api/v1/pair/router/revert` does not exist.** IoniBot IB-605's tidy-up fails honestly. Post-ADR-001 this is hygiene, not rescue | 🟢 |
| B10 | **`NODE_ENV=development` on the Pi** — produces React dev bundles, ~2× size, leaking dev internals | 🟡 |
| B11 | **No history database.** See Sprint B | 🔴 |
| B12 | **`nft` and AF_PACKET never proven enforcing** on real hardware — only container fallbacks | 🟡 |

---

# PART 3 — BUILD AND TOOLING

## 3.1 Toolchain

| Tool | Version | Note |
|---|---|---|
| Node | 24.x | |
| TypeScript | ~5.8.2 | `tsc --noEmit` is the lint step |
| Vite | ^6.2.3 | Three configs: `vite.config.ts`, `vite.standalone.config.ts`, `vite.chunks.config.ts` |
| Vitest | ^3.2.7 | 178 frontend tests |
| JDK | Adoptium 21 | `C:\Users\DGMic\.gradle\jdks\eclipse_adoptium-21-amd64-windows.2` |
| Android SDK | compileSdk 36, minSdk 24 | `C:\Users\DGMic\AppData\Local\Android\Sdk` |
| Python | 3.11+ on the box; `.venv` in `node-agent/` | |

**Removed 2026-08-24** (`2df4a13`): `canvas-confetti` + types, `autoprefixer`,
`tsx`, `vite-plugin-singlefile`, and the two orphan vite configs that were its
only consumers. `motion` was removed and immediately restored — the first check
grepped the bare specifier and missed six files importing `motion/react`.

## 3.2 Needs tending — tooling

| # | Item | Severity |
|---|---|---|
| T1 | **`NODE_ENV=production` + npm `omit=dev` machine-wide on wabakipi.** Every `npm install` silently strips devDependencies; `npm ci` installs 136 packages instead of 324 and `cap sync` fails outright. Always `set NODE_ENV=` first | 🔴 recurring |
| T2 | **Windows OpenSSH is broken** — every binary exits 255 with no output. Only Git's copy works. **Never set `GIT_SSH_COMMAND`**: the global `core.sshCommand` uses an 8.3 short path deliberately | 🔴 |
| T3 | **feed-receiver's 83 tests are not in CI** | 🟡 |
| T4 | **Ruff is `continue-on-error`** — 51 violations reported and ignored | 🟡 |
| T5 | **No CI job proves filtering works.** Everything green today over a box that had never filtered. Sprint G.5 and G.6 | 🔴 |
| T6 | **BlueStacks Android 13 instance unstable** — crashed three times tonight, likely RAM with two instances. Android 11 instance is reliable | 🟢 |
| T7 | `cmd.exe` `\"` toggles quoting rather than escaping, so any `|` after an odd number becomes a real pipe. Write a `.sh`, scp it, run it | 🟢 |

---

# PART 4 — THE ONE-PAGE ACTION LIST

**Do this week**

1. Deploy the two staged agent modules — one `sudo`.
2. Rotate the Pi-hole password.
3. Point the router's upstream DNS at the box, and verify by query.
4. Revoke the two GitHub PATs and the Gemini key.
5. Back up the keystore twice; record its SHA-256.
6. Create the Play Console account — the queue starts the moment you do.

**Decide before hardware is ordered**

7. **P7** — self-signed TLS with pinning, or plain HTTP for v1? Changes the QR
   payload, and retrofitting means re-pairing every device in the field.
8. **B2** — pin the Pi-hole and Unbound image digests.
9. **A.4** — does the EX511 fall back when its only static upstream dies?
10. Base-tier board confirmed as Orange Pi Zero 2W class.

**Decide before the app is published**

11. The web demo screens — delete, or gate behind `VITE_USE_MOCK_DATA`? One of
    them mints a fake `gf_live_…` token that looks like a production credential.
12. Whether Ionicrobes ships in v1 or becomes its own project.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
