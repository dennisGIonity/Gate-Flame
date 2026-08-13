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
Lucide · Capacitor 8 (Android) · `@google/genai` (Gemini, server-side)

## Quick start

```bash
git clone https://github.com/dennisGIonity/Gate-Flame.git
cd Gate-Flame
npm install
cp .env.example .env.local     # then fill in your own GEMINI_API_KEY
npm run dev                    # http://localhost:3000
```

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

Copy `.env.example` → `.env.local`. **Never commit `.env` or `.env.local`** — they are
git-ignored, and any key that reaches a public commit must be rotated immediately.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API calls. Injected automatically by AI Studio at runtime. |
| `APP_URL` | Host URL of the applet. Injected by AI Studio with the Cloud Run service URL. |

## Contributing

The repo is public — anyone can read and clone. Team members added as **collaborators**
can push directly. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch and commit
convention.

## Related links

The complete index of every Gate^Flame link — AI Studio, Antigravity, Android Studio,
GitHub and the Ionity properties — lives in [`docs/LINKS.md`](docs/LINKS.md).

## License

Governed by **Policy 986 AED**. License **AED 900** (Hardware & Software);
**CC BY-NC-SA 4.0** where stated. See [LICENSE](LICENSE).

© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
