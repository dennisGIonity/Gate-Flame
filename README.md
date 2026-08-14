<div align="center">

# Gate^Flame Network Security Node

**Mobile command dashboard, device onboarding simulator, and server sync architecture
for the Gate^Flame digital perimeter security node.**

Ionity (Pty) Ltd — AEDI · Building Tomorrow, Today.

</div>

---

```
========================================================================================
GATE^FLAME NETWORK SECURITY NODE — SOURCE REPOSITORY
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013 | Version: 1.0 | Updated: 2026-08-13 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

## Overview

Gate^Flame is a digital perimeter security node — a Pi-hole–class DNS/network guard with a
glass-panel command surface. This repository holds the full front-end and mobile build
chain for the node's control application.

| Surface | Entry point | Build target | Ships as |
|---|---|---|---|
| Desktop / web dashboard | `index.html` → `src/main.tsx` | `vite.config.ts` | Web |
| Mobile dashboard | `mobile.html` → `src/main-mobile.tsx` | `vite.mobile.config.ts` | Inside the APK |
| Device kiosk | `kiosk.html` → `src/main-kiosk.tsx` | `vite.kiosk.config.ts` | **HTML served by the node** |
| Standalone bundle | `build-standalone.js` | `vite.standalone.config.ts` | Web |
| Android APK | `android/` (Capacitor) | `capacitor.config.ts` | `org.ionity.gateflame` |

> **The kiosk is not an Android app.** It runs as Chromium in `--kiosk` mode in the
> `gateflame-display-kiosk` container on Raspberry Pi OS / Armbian, pointed at
> `KIOSK_URL=http://localhost:8080/device-kiosk`. The Pi does not run Android.
> There is exactly **one** APK — the customer's companion app.
>
> Do not add `capacitor.config.json` or `capacitor.kiosk.config.json`.
> `@capacitor/cli` resolves `.ts` **before** `.json`, so a `.json` sitting alongside
> `capacitor.config.ts` is silently ignored.

## Stack

React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS 4 · Zustand · Recharts · Motion ·
Lucide · Capacitor 8 (Android)

## Quick start

```bash
git clone https://github.com/dennisGIonity/Gate-Flame.git
cd Gate-Flame
npm install
npm run dev                    # http://localhost:3000
```

No environment file is needed to run it. The app looks for a Gate^Flame node on
the LAN — `gateflame.local` over mDNS first, then the common private addresses —
and if none answers it falls back to **clearly-labelled simulated data**.

To pin a specific node, or to force demo mode, copy `.env.example` to
`.env.local`. Every variable in it is optional.

> **On simulated data.** When no node is connected, the app shows a
> non-dismissible `SIMULATED DATA — NOT YOUR NETWORK` banner and marks every
> affected card. Set `VITE_STRICT_LIVE=true` to disable the fallback entirely
> and surface connection errors instead — recommended for QA, so a broken API
> cannot hide behind plausible-looking numbers.

### Android

```bash
npm run build:apk          # bump version, build, sync, sign, print fingerprint
npm run build:apk-debug    # debug build; installs alongside a release build
```

`build:apk` produces a **signed release** APK at `release/GateFlame-Mobile.apk`.

Two things must be set up before the first unit ships, and both are irreversible
afterwards:

| | |
|---|---|
| **Signing key** | Read [`android/KEYSTORE.md`](android/KEYSTORE.md) **first**. An APK signed with a different key can never update one already installed — every customer would have to uninstall and re-pair. The keystore cannot be regenerated if lost. |
| **`versionCode`** | Single-sourced in [`android/version.properties`](android/version.properties), bumped by `npm run version:bump`. Android refuses to install an APK whose `versionCode` is ≤ the installed one. |

The build **refuses** to emit an unsigned release rather than silently falling back
to the debug key. Override deliberately with
`./gradlew assembleRelease -PallowUnsignedRelease=true`.

Pairing, the support feed and APK distribution are specified in
[`docs/PAIRING-AND-TELEMETRY.md`](docs/PAIRING-AND-TELEMETRY.md).

## Environment

All optional. Copy `.env.example` → `.env.local` if you need any of them.
**Never commit `.env` or `.env.local`** — they are git-ignored, and any key that
reaches a public commit must be rotated immediately.

| Variable | Purpose |
|---|---|
| `VITE_NODE_BASE_URL` | Pin a node instead of discovering one, e.g. `http://192.168.1.105`. |
| `VITE_USE_MOCK_DATA` | Force simulated data even when a node is reachable. Demo switch. |
| `VITE_STRICT_LIVE` | Never fall back to simulation — show connection errors instead. |
| `VITE_API_TIMEOUT_MS` | Request timeout. Default `4000`. |
| `VITE_POLL_INTERVAL_MS` | Telemetry poll interval. Default `4000`. |

Only `VITE_`-prefixed variables reach the client, and everything that does is
readable in the shipped bundle — **none of these is a secret**. The node device
token is not a build-time value: it is issued at pairing and lives only in the
handset.

> `GEMINI_API_KEY` and `APP_URL` were previously documented here as required.
> Neither was ever read — no `import.meta.env` reference, no `define:` block in
> any Vite config, and `@google/genai` imported by no source file. They were AI
> Studio scaffolding and have been removed rather than left implying a setup
> step that does nothing.

## Contributing

The repo is public — anyone can read and clone. Team members added as **collaborators**
can push directly. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch and commit
convention.

## Documentation

| Document | Covers |
|---|---|
| [`docs/PAIRING-AND-TELEMETRY.md`](docs/PAIRING-AND-TELEMETRY.md) | **The backend contract.** Six-digit pairing, scopes, and the health-only support feed with its POPIA reasoning. Read this before implementing `node-agent`. |
| [`android/KEYSTORE.md`](android/KEYSTORE.md) | Release signing — generation, 3-2-1 backup, verification. Read before the first unit ships. |
| [`docs/LINKS.md`](docs/LINKS.md) | Complete index of every Gate^Flame link — AI Studio, Antigravity, Android Studio, GitHub and the Ionity properties. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch and commit convention, and the hard rules. |

## License

Governed by **Policy 986 AED**. License **AED 900** (Hardware & Software);
**CC BY-NC-SA 4.0** where stated. See [LICENSE](LICENSE).

© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
