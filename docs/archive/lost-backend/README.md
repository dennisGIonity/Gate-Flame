```
========================================================================================
GATE^FLAME — RECOVERED: THE LOST DOCKER BACKEND (A8)
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-020-A8 | Version: 1.0 | Recovered: 2026-09-20 SAST
Governance: Policy 986 AED | Classification: INTERNAL
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
========================================================================================
```

# What this is

Three commits of real work that existed **nowhere but a single 361 MB file on one
machine**. Extracted here on 2026-09-20, which is what the 2026-08-18 audit recommended
and nobody ever did.

| SHA | Date | Subject |
|---|---|---|
| `105629a9f4594e66611f9b95d1d0fa3a3b14419e` | 2026-08-09 13:09 | Implement GateFlame backend API, telemetry, network scanner, and container orchestration |
| `c44c51b3a8c176b9ff15475e469482728c1b48c5` | 2026-08-11 14:23 | (working commit — Dockerfile and React changes) |
| `09ec6d3498a4614ce2c782a56c74aaece47a8f69` | 2026-08-11 14:23 | feat: complete backend API integration, Pi-hole polling, and mobile nodeIP routing |

**None of these SHAs exist on GitHub.** Verified again on 2026-09-20: all four bundle
heads were missing from `E:\Gateflame`'s object database, while the nine *other* bundles
beside it were confirmed fully contained and are therefore genuinely redundant.

Source: `C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\E-App-SAFETY-2026-08-16.bundle`

# The part that actually mattered

```
server.js            6,863 b   the Express backend
securityAPI.js       6,417 b   the security API surface
networkScanner.js    6,533 b   the LAN scanner
containerManager.js  4,313 b   container orchestration
docker-compose.yml   1,963 b
Dockerfile             517 b
package.json         2,091 b
```

Plus the React frontend of that era under `src/`, and the Android project under
`android/`. 223 files, 1.2 MB.

# What was dropped, and why

The bundle was 361 MB because `.jdk`, `.jdk21`, `.gradle`, `node_modules` and build
output had been committed into it. Excluded on extraction: toolchains, dependency trees,
`.idea/`, `dist*`, `release/` (two 4.5 MB APKs and a tarball), `dist-standalone/`, and
three `.zip` archives of the project itself. All of it is regenerable or was never
source; keeping it is the mistake that made the bundle 361 MB in the first place.

# Status of this code

**Historical reference only. Do not build from it.** The node-agent in this repo is a
ground-up rebuild that exceeded this backend — 43 route decorators and 634 passing tests
against the 13 routes specified here. This directory exists so that three commits of
Dennis's work are not one disk failure away from gone, which is the condition they sat in
from 2026-08-16 to 2026-09-20.

Two files here are the ancestors of things later deleted from the live tree on purpose:
`src/components/DeviceOnboardingSimulator.tsx` and `src/components/ServerSyncArchitecture.tsx`
— the latter being the component that carried the fabricated `gf_live_` credential for
three and a half weeks (see `docs/MERGE-2026-09-12-finishing-touches.md` §A1).

**Once this is pushed, the 361 MB bundle has no unique content left and can go.**

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
