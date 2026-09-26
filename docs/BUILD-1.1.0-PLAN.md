```
========================================================================================
GATE^FLAME T3 STANDARD — BUILD 1.1.0 WORK PLAN (DEMO / TESTER RELEASE)
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-09-026-PLAN | Version: 1.0 | Updated: 2026-09-26 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

## The ask (Dennis, 2026-09-25)

> "take only the T3 Standard model, the kiosk + apk & chatbot + dashboard for server + and
> the server build for now on Ionity offline server running https://ionity.wifi.storage …
> Build it ready to migrate to a real server … make sure everything works 100% … create
> distributable zip with all parts inside so i can hand over to a tester as a demo model."

Scope = **Standard T3 only** (Radxa Cubie A7A 6 GB / lab Pi 5 16 GB). T1 (`t1/`), Premium T3,
T2, T4 and `E:\.ESP32-MCP` are **out of scope and not touched**.

## Parts

| Part | Where | Runs on |
|---|---|---|
| Node agent + DNS stack + watchdog + installers | `node-agent/` | the box (Pi 5 / Cubie A7A) |
| Kiosk console (IoniBot included — Dennis 2026-08-31: *"make sure all three gets these editions"*) | `src/components/kiosk/`, `kiosk.html` | the box's own screen |
| Android app + IoniBot | `src/mobile/`, `src/ionibot/`, `android/` | phone |
| Fleet dashboard (the billable surface) | `fleet/` | Ionity offline server now, real server later |
| Ionity offline server front door | `ionity-local-drive` repo (separate), `/gateflame/*` bridge | the laptop today (`192.168.0.3` / lab `192.168.124.4`) |

## Shared contracts added in 1.1.0 (additive only — nothing existing changes shape)

### `GET /api/v1/dns/history?window=24h|7d|30d` (scope `read`)
Proxied from Pi-hole's own history (`/api/history`, `/api/history/database`), so it is real
from the first minute — no new storage on the box.

```json
{ "window": "24h", "stepSeconds": 600, "resolution": "10 minute totals", "source": "pihole",
  "points": [ { "t": 1790000000, "total": 120, "blocked": 14, "cached": 40, "forwarded": 66 } ],
  "gap": null }
```
On any failure: `points: []` and `gap` names what could not be read. Never 500.

### `GET /api/v1/history/system?window=24h|7d|30d` (scope `read`)
A 60 s on-box sampler (CPU, memory, temperature, disk) in the `.DUMP/history` data root.

```json
{ "window": "24h", "stepSeconds": 300, "resolution": "5 minute averages",
  "points": [ { "t": 1790000000, "cpu": 12.5, "memPct": 41.0, "tempC": 52.3, "diskPct": 18.2 } ],
  "since": 1789990000, "gap": null }
```
`since` is the first sample ever stored, so a screen can say "history since …" truthfully.

## Rules every change follows (from CLAUDE.md — load-bearing)

- No invented data. Unknown is `null` + a named `gap`, never `0`.
- Five `protectionStatus` values `active|paused|bypass|degraded|unconfigured`, `applying` is a boolean.
- The UI renders node-supplied copy verbatim (threat levels, categories, pause labels).
- No secondary DNS, ever. ADR-001 stands: the router forwards to the box.
- "Cannot reach it" and "reached it, nothing there" never share a sentence.
- Every behavioural fix gets a test; the test is checked by reintroducing the bug.
- Nothing binary through a text path. No credentials in chat, code or docs.
- Git only from Git-bash on Windows, identity `DennisIonity`, never from the Linux sandbox.
