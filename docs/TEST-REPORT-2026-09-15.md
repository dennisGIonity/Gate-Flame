```
========================================================================================
GATE^FLAME — END-OF-BUILD TEST REPORT
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-15-TEST | Version: 1.0 | Updated: 2026-09-15 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Classification: INTERNAL | Building Tomorrow, Today.
========================================================================================
```

Written for handover to the project testing team. Every line below says what was
actually run, against what, and what the result was — not what the code is supposed to
do. Where something could not be tested this session, that is stated as plainly as a
pass, with the reason and what unblocks it. This document and its companions
(`CAPABILITIES-AND-RESOURCES-2026-09-15.md`, the handover zip) are the point-in-time
record for **2026-09-15**.

**Legend:** ✅ tested and passed on real hardware/live data · 🟡 tested, real but partial
· 🔴 blocked this session (reason given) · ⬛ deliberately not built (see CLAUDE.md/ADR-001)

---

## 1 — Automated test suites

| Suite | Result | Evidence |
|---|---|---|
| `node-agent` (pytest) | ✅ **634 passed**, 5 warnings (FastAPI deprecation notices only, no failures) | Run twice this session — once before the health-feed change, once after — both clean. `E:\Gateflame\node-agent`, `python -m pytest -q` |
| Frontend (vitest) | 🟡 Fixed (BUG-01/BUG-02) 2026-09-13, confirmed passing 2026-09-14/15 in the mobile-app verification pass | Not re-run in this exact session; no frontend source changed since the last confirmed green run |
| `fleet/test_support_findings.py` | ✅ Present and part of the 634 (fleet's own module is imported and exercised by the node-agent suite's collection) | — |

## 2 — Rule Zero / repo health

`tools\doctor.cmd` run at session start:

- Identity: ✅ `DennisIonity <dennis@ionitynetwork.onmicrosoft.com>`, no author override
- 19 checkouts on this machine (14 are Antigravity IDE snapshots) — historic, not a
  regression introduced this session
- 2 unpushed commits in `C:\Users\DGMic\GateFlame-Repo` (dated 2026-08-18) and 1 in
  `TempGateFlameBuild` (dated 2026-09-06) — **pre-existing, in read-only clones**,
  not `E:\Gateflame`. Flagged for Dennis to run `SAVE-EVERYTHING.cmd` on those clones
  before either is ever deleted; not touched this session per Rule Zero (`E:\Gateflame`
  is the only clone that gets edited)
- `E:\Gateflame` itself: clean, on `fix/mobile-dns-drops`, in sync with `origin` both
  before and after this session's commits

## 3 — Node agent (`GF-72TYTITQ`, live Pi) — reachability & real API calls

Every row below is a live HTTP call made against `192.168.0.10:8080` during this
session, not a code read.

| Call | Result |
|---|---|
| `GET /api/v1/system/status` | ✅ `200` — `{"nodeId":"GF-72TYTITQ","agentVersion":"0.1.0","provisioned":true,"storageHealthy":true,"storageRoot":"/opt/gateflame/.DUMP"}` |
| `GET /api/v1/system/kiosk` | ✅ `200` — `{"mounted":true,"path":"/device-kiosk","directory":"/opt/gateflame/kiosk","gap":null,"consolePinEnabled":false}` |
| `GET /api/v1/system/storage` (no token) | ✅ correctly refused — `401 insufficient_scope`, requires `read`/`control`/`kiosk` |
| `GET /api/v1/system/feed` (the new route added this session) | 🔴 `404` on the live box — **expected**: this route exists only in the repo, not yet deployed to the Pi. See §5 |
| `/device-kiosk/` over the network (no pairing) | ✅ correctly refused data, by design — see §4 |

**Reading:** the box is live, provisioned, storage-healthy, and enforcing scope exactly
as documented. Nothing above was invented; every value is what the box returned.

## 4 — Kiosk

| Item | Result |
|---|---|
| Reachable from LAN | ✅ answers, real node id/version in the footer |
| Lock screen | ✅ renders; correctly shows **"Protection status withheld"** rather than a
  borrowed or fabricated number when viewed over the network — this is the
  `DataSourceBanner`/loopback-only design working exactly as intended, not a bug |
| Read-only remote view | ✅ explicit, honest screen: *"This is not the appliance
  console… reads refused with HTTP 401… look at the screen attached to the appliance,
  or pair a phone."* Confirms `security.py`'s loopback-only `kiosk` scope live, not
  just in the test suite |
| Overview / Filtering / Threats / Network / Modules / WAN / System / Shield panels | 🔴
  **Not re-tested this session.** These require either physical presence at the box's
  own attached screen or an SSH session to the Pi (to view over loopback) — neither
  was available this session (see §6). Last proven working: 2026-08-31 per
  `FUNCTION-STATUS-AND-BUGS.md` §2, and indirectly via the mobile app pulling the same
  backend data on 2026-09-15 (§7) |
| Firewall bounce | ⬛ route answers, never fired on hardware — pre-existing gap, not
  attempted this session (touching live firewall rules on Dennis's household network
  without him present is exactly what "Never do" in CLAUDE.md rules out) |

## 5 — Fleet dashboard

Started locally this session (`fleet\start-fleet.ps1`, fresh `fleet.env.ps1` generated
— see the handover guide for credentials) and tested live in a browser.

| Item | Result |
|---|---|
| Service starts, binds, answers | ✅ `GET /healthz` → `{"ok":true}`. Address **had moved
  again** by the time this ran — `192.168.0.4`, not the `.3` on record from 2026-08-31.
  Live proof that BUG-07's underlying DHCP-drift problem is real and current, not
  theoretical |
| Dashboard page + styling | ✅ loads, correct dark theme, tiles, search, sort, the
  gate+flame mark — same visual language as kiosk/app after this session's fix (§8) |
| Empty-state honesty | ✅ `0 devices registered`, and the empty-state copy correctly
  reads *"No devices have reported in yet"* rather than a fabricated row — matches the
  project's own no-invented-data rule |
| Search / filter / clear filters | ✅ typed a node id, filter applied and URL-backed,
  "Clear filters" appeared and worked, no console errors at any point |
| Node detail, admin fields (label/tags/billing), notes, history charts | 🔴 **Could
  not be exercised against real data.** Zero nodes are currently posting to this
  dashboard — the Pi's health feed is off by default (`GATEFLAME_FEED_ENABLED=false`,
  a deliberate consent-gated default per `docs/PAIRING-AND-TELEMETRY.md` §4.3) and
  turning it on + pointing it at this dashboard requires SSH access to the Pi, which
  this session did not have (§6). **Did not fabricate a test node to work around this**
  — the fleet dashboard's own footer says "no domains, no client ips, no device names,"
  and inventing sample rows would be the exact class of dishonesty the project exists
  to avoid |
| Remote support panel | ✅ correctly states "Not available yet" rather than offering a
  button that would do nothing — matches Dennis's explicit read-only-only decision for
  this dashboard |

## 6 — What blocked full coverage this session, and what unblocks it

Three things were genuinely out of reach this session, through no code fault:

1. **No SSH key loaded for `raspberrypi`.** Host key was new (never connected from
   this Windows account before — accepted safely with `StrictHostKeyChecking=accept-new`
   after independently confirming the box's identity over HTTP first), but
   `wabapi@raspberrypi` then refused with `Permission denied (publickey)`. Dennis's own
   `GATEFLAME-load-ssh-key.cmd` needs to run once per boot per CLAUDE.md — it had not
   been run this session. **Unblocks:** kiosk loopback view, wiring the Pi's feed to
   the fleet dashboard, and running `install-pi-update.sh` to actually deploy this
   session's node-agent changes (see §5 in `FUNCTION-STATUS-AND-BUGS.md`, BUG-07 entry).
2. **ADB wireless-debugging session had expired.** The phone paired and worked
   perfectly earlier the same day (BUG-19 fix, verified on-device — see §7 below), but
   that pairing does not survive indefinitely and `adb devices` returned nothing by the
   time this segment of work started. **Unblocks:** re-enable Developer options →
   Wireless debugging on the phone, then a fresh pairing code, same as earlier today.
3. **Claude's own browser tooling refuses navigation to adult-content domains
   outright**, at the tool level, before any Gate^Flame filtering is even reached. This
   is a hard safety boundary in the tool itself, not a Gate^Flame limitation, and it
   means the literal "open a browser and show it blocks porn" demo cannot be produced
   by Claude directly. A safe substitute (navigating to a known ad-tracker domain
   instead) also could not distinguish "Gate^Flame blocked this" from "the browser
   tool's own safety layer blocked this," so it was not used as evidence either — see
   §9 for what proof exists instead, and what a person with the actual phone in hand
   can add in under a minute.

None of these are code defects. All three are "needs Dennis (or the paired phone) in
the loop" items, which is exactly what a handover to a testing team should say plainly
rather than paper over.

## 7 — Mobile app (carried forward from earlier today, 2026-09-15, real hardware)

Full detail lives in `STATUS-2026-09-13.md`'s mobile-app table and `FUNCTION-STATUS-AND-BUGS.md`'s
BUG-19 entry; summarised here because it is the same day's evidence and belongs in one
test report:

- **Root cause found and fixed same-day:** the app had never worked on any real handset
  since 2026-08-14 (mixed-content blocking; `capacitor.config.ts`'s fix never reached
  the native build until `npx cap sync android` ran). Rebuilt via
  `npm run build:apk-debug` **from Git-bash** (the POSIX Gradle step fails under
  PowerShell/cmd — documented as BUG-19 and in `CLAUDE.md`).
- Verified on Dennis's own Samsung Galaxy S10e over `adb` wireless debugging: Home
  (Protected, 207,207 looked up, 52,991 blocked / 25.6%, 12 devices), Activity, Blocked
  (real domains — `self.events.data.microsoft.com`, `googleads.g.doubleclick.net`,
  `an.facebook.com`), Network (9 devices, real vendor/MAC), Health (25% CPU, 51.8°C,
  40.5% storage, 2.5/15.8GB RAM, uptime 3d4h), Controls/Settings, Shield country list
  and device rename, and the startup splash — all ✅ against the live box, not stubs.
- Not re-tested this session (ADB disconnected, §6): Shield `.ovpn` handoff, IoniBot,
  Play tab interaction, and a fresh pairing-flow run. These were already 🔴/untested
  before today per `STATUS-2026-09-13.md` and remain so.

## 8 — Styling unification (this session)

- Compared fleet dashboard's tokens against `src/index.css` and kiosk's
  `kioskUi.tsx` `COLORS`/`StatusPill` directly (not by re-reading fleet's own claim to
  match).
- Found and fixed one real mismatch: fleet's fault-red was `#f43f5e` (rose-500, matches
  the *main app's* rose, not kiosk's); kiosk's canonical `COLORS.fault` is `#E11D48`.
  Per CLAUDE.md ("the product IS the kiosk"), kiosk wins. Fixed in
  `fleet/static/index.html`.
- Found and fixed a real component-logic gap: kiosk's `StatusPill` never lets a
  module carrying a `gap` render green ("running"); fleet's module chips did. Ported
  the same downgrade rule into fleet's `renderNode()`.
- Radius scale and neutral-vs-tinted pill styling differ between kiosk and fleet —
  **flagged, not changed.** Visual/UX calls are Dennis's per CLAUDE.md, not something
  to decide unilaterally.

## 9 — Proof of function captured this session

Screenshots/text captures taken this session (see the handover zip's `proof/` folder):

1. Fleet dashboard — live, correct empty state, styled correctly.
2. Fleet dashboard — search filter applied + "Clear filters" working.
3. Kiosk lock screen over the network — "Protection status withheld," proving the
   loopback-only design is enforced live, not just documented.
4. Kiosk read-only explainer — "This is not the appliance console… reads refused with
   HTTP 401," proving `security.py`'s scope gate live.
5. `GET /api/v1/system/status` raw response — real node identity live on the network.

What is **not** in this set, and why: the mobile app's real-data screens (Home,
Blocked, Network, Health) were captured earlier the same day during the BUG-19
verification pass and already live in `STATUS-2026-09-13.md`'s revision history rather
than duplicated here. A literal DNS-category-block demo (the "porn block" example)
needs either the paired phone (ADB, currently disconnected) or Dennis's own browser on
a device using the box as its resolver — Claude's own browser tool refuses the
navigation needed to demonstrate it directly (§6, item 3).

---

## Summary for the testing team

The backend (node-agent) is solid: 634 tests green, live box reachable, real data,
correct auth enforcement at every boundary tried. The kiosk's security model is
proven live, not just asserted. The fleet dashboard runs, is now visually unified with
the rest of the product, and is honest about having no nodes yet. The mobile app was
proven working on real hardware for the first time ever earlier today, with a fix that
is now written up so it can't silently regress again (BUG-19).

What is left is not "untested code" — it is three access items (SSH key, ADB pairing,
and one tool-level safety boundary) that need a human with physical or credentialed
access to close out. They are listed exactly, with the exact unblock, in §6.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
