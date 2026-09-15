```
========================================================================================
GATE^FLAME — HANDOVER TO PROJECT TESTING TEAM
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-15-HANDOVER | Version: 1.0 | Updated: 2026-09-15 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Classification: INTERNAL | Building Tomorrow, Today.
========================================================================================
```

This is the one page a tester should read before opening anything else in the zip.
It says what is in the box, in what order to stand it up, and what "working" looks
like at each step. Read `TEST-REPORT-2026-09-15.md` and
`CAPABILITIES-AND-RESOURCES-2026-09-15.md` alongside this for the full picture — this
page is the runbook, those are the record.

## What's in this zip

```
fleet-dashboard/     the operator console — source + run script
mobile-app/          the installable Android debug build
kiosk/                the box's own on-screen console — built bundle
docs/                 this guide, the test report, the capabilities/resource doc
```

Not included, deliberately: the release signing keystore, any live API token or
password, and the fleet server's live database. Nothing in this zip can act as a
credential for anything real.

## 1. Fleet dashboard — stand it up on any Windows or Linux machine with Python 3.10+

```
cd fleet-dashboard
python -m venv venv
./venv/Scripts/pip install -r requirements.txt        (Windows)
./venv/bin/pip install -r requirements.txt             (Linux/macOS)
```

Set three environment variables before starting it — it refuses to start without them,
on purpose:

```
GATEFLAME_FLEET_TOKEN=<any string — this is the shared enrolment secret nodes use
                        the FIRST time they check in>
GATEFLAME_FLEET_ADMIN_USER=admin
GATEFLAME_FLEET_ADMIN_PASSWORD=<pick one — this logs you into the dashboard itself>
```

Then:

```
./venv/Scripts/uvicorn app:app --host 0.0.0.0 --port 8091      (Windows)
./venv/bin/uvicorn app:app --host 0.0.0.0 --port 8091           (Linux/macOS)
```

Or on Windows, copy your three values into a `fleet.env.ps1` file (see
`fleet-dashboard/fleet.env.ps1.example`) and just run `start-fleet.ps1` — it sets the
variables and starts the server for you, and prints the exact URL to browse to and the
exact URL nodes should post health check-ins to.

**What "working" looks like:** browsing to `http://<that machine's IP>:8091/` prompts
for the admin user/password you set, then shows "0 devices registered" — that is
correct and expected until a real Gate^Flame box is pointed at it (step 3).

## 2. Mobile app — install the debug build

```
adb install -r mobile-app/GateFlame-Mobile-debug.apk
```

Needs a phone with USB or wireless debugging enabled once, same as any Android debug
build. This is version code 14 (1.0.2), rebuilt 2026-09-15 with the fix that made the
app work on a real handset for the first time (see `TEST-REPORT-2026-09-15.md` §7 and
BUG-19 in the main repo's `docs/FUNCTION-STATUS-AND-BUGS.md`). **It is a debug build,
not signed for the Play Store** — that is a separate, later step (release keystore
decision, tracked in the main repo).

**What "working" looks like:** the app opens to a pairing screen, discovers a
Gate^Flame node automatically if one is on the same LAN, and after pairing shows real
numbers (queries looked up, blocked, devices) rather than placeholders or a blank
screen.

## 3. Kiosk — the box's own console

This is not something you install standalone — it's a static bundle a Gate^Flame
node-agent serves at `/device-kiosk` once told where to find it
(`GATEFLAME_KIOSK_DIR` pointing at the `kiosk/` folder in this zip). If you have a
node-agent running (see the main repo's `node-agent/install.sh` for a full box, or
just point an existing dev instance's `GATEFLAME_KIOSK_DIR` at this folder and
restart it), browsing to `http://<that box's IP>:8080/device-kiosk/` should show the
console.

**What "working" looks like, and a genuinely useful thing to know before you file a
bug:** if you open it from a laptop browser on the LAN rather than on the box's own
attached screen, it will correctly refuse to show live protection data and tell you
so — "This is not the appliance console… reads refused with HTTP 401." **That is the
security model working, not a bug.** To see real data you need either the box's own
screen, or a phone paired through it (step 2).

## 4. Pointing a real node at the fleet dashboard, to see real data end-to-end

On the node-agent (the Raspberry Pi or whatever box is running it), set:

```
GATEFLAME_FEED_ENABLED=true
GATEFLAME_FEED_URL=http://<fleet dashboard machine's IP>:8091/api/v1/nodes
GATEFLAME_FEED_TOKEN=<the same GATEFLAME_FLEET_TOKEN you set in step 1>
```

and restart the agent. It posts within one interval (15 minutes by default,
`GATEFLAME_FEED_INTERVAL_SECONDS` to change it). Refresh the fleet dashboard — the box
should appear, with real CPU/memory/disk/temperature and module status.

**If it does not appear after 15+ minutes:** the node-agent now reports its own feed
health at `GET /api/v1/system/feed` (LAN-only, added 2026-09-15) —
`{enabled, url, lastSuccessAt, consecutiveFailures, lastError}`. If
`consecutiveFailures` is climbing, the URL/token pair is wrong, or the fleet
dashboard's machine has moved address since — the same drift problem documented as
BUG-07 in the main repo, and exactly why this route exists now instead of a silent log
line nobody sees.

## 5. Known, intentional gaps — not bugs to file

- The fleet dashboard has no remote-control button anywhere, on purpose — it is
  read-only by design. Do not file "can't restart a device from the dashboard" as a
  bug; it's documented in the dashboard's own "Remote support" panel and in
  `docs/FUNCTION-STATUS-AND-BUGS.md`.
- The kiosk refusing to show data to a browser that isn't the appliance itself (§3
  above) is the same kind of intentional boundary.
- A standard-tier box does not claim the household's gateway or run firewall/DPI
  modules — that is `ADR-001` in the main repo, not a missing feature.

## 6. If something in this zip does NOT match `TEST-REPORT-2026-09-15.md`

That report says exactly what was tested and what was not (three items were blocked
this session pending an SSH key load and a fresh phone pairing — see its §6). If you
find something that report claims works and it does not, that is the priority bug to
report back — it means something regressed between packaging and your test, which is
itself worth knowing.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
