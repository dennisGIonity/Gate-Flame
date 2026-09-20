```
========================================================================================
GATE^FLAME — LIVE PROOF-OF-FUNCTION CAPTURES
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-16-PROOF | Version: 1.0 | Captured: 2026-09-16 23:16-23:20 SAST
Classification: INTERNAL | Building Tomorrow, Today.
========================================================================================
```

Every image in this folder is a real screenshot taken **live, right now (2026-09-16,
~23:16-23:20 SAST)**, against the actual node `GF-72TYTITQ` at `192.168.0.10:8080` and a
freshly-started local instance of the fleet dashboard. None of these are mockups. Where
something didn't work, the screenshot shows that honestly instead of being left out or
faked — that's the whole point of this folder.

## What each file shows

**01-node-system-status.png** — `GET /api/v1/system/status`, unauthenticated (this route
is meant to answer without a token). Real, live response: node ID, agent version,
`provisioned: true`, storage healthy. Proves the box is up and answering right now.

**02-node-feed-health.png** — `GET /api/v1/system/feed`, returns `404 Not Found`. This is
the **expected, honest result today** — the BUG-07 fix (this route) exists in the
`E:\Gateflame` source and is documented in `FUNCTION-STATUS-AND-BUGS.md`, but has not yet
been deployed to the physical Pi (the Pi is not a git repo; it needs an `scp` deploy per
`tools/install-pi-update.sh`). This screenshot is proof of the current real gap, not proof
the fix doesn't work — the fix passed all 634 local tests (see `TEST-REPORT-2026-09-15.md`
§2-3). Once deployed, re-running this same capture should show a 200 with health fields.

**03-node-services-modules.png** — `GET /api/v1/services`, returns `401` /
`insufficient_scope`, requiring `read`, `control` or `kiosk` scope. This is the module
registry endpoint refusing an unauthenticated browser — correct behaviour, not a bug. A
paired phone or the kiosk's own session would carry the right scope.

**04-kiosk-remote-view.png** — the box's own kiosk console (`/device-kiosk/`), loaded from
a LAN browser that is not the appliance itself. Shows the real, live clock on the box
(23:17, Wednesday 16 September — matches the capture time) and the actual refusal screen:
**"Protection status withheld... Read it on the appliance's own screen, or in the paired
app."** This is the security boundary working exactly as designed (see CLAUDE.md — "no
enforcement without consent, and no honest-looking screen showing invented data").

**05-fleet-dashboard-unauth-failclosed.png** — the fleet dashboard's own static shell,
loaded without credentials. It renders the branded UI (confirming the styling-unification
work from this project) and then **fails closed**: "Fleet server unreachable... nothing
here would describe the fleet as it is now, so nothing is shown" — rather than showing
placeholder or fabricated device data. This is the dashboard's own designed behaviour when
its API calls aren't authenticated.

**05-fleet-dashboard-authenticated-api.png** — the same dashboard's real API
(`/api/v1/fleet/summary`), this time with the correct admin credentials. Live JSON:
`{"total":0, ..., "remoteControl":false}`. Two things proven here: the dashboard really is
running and answering (not a mockup), and `remoteControl` really is hardcoded `false` in
the live response — the no-remote-control commitment from item 1 of the wrap-up list,
confirmed from the wire, not just from reading the source.

## What is deliberately NOT in this folder, and why

- **The fleet dashboard's fully populated, logged-in UI** (the styled device-card view). The
  dashboard's frontend authenticates purely via the browser's native HTTP Basic-Auth
  cache, which a one-shot headless capture cannot carry from address-bar credentials into
  its own `fetch()` calls — that's a limitation of *this capture method*, not of the
  dashboard. It has been confirmed working two ways instead: the raw authenticated API
  response above, and the interactive browsing already recorded in
  `TEST-REPORT-2026-09-15.md` §5. There is also nothing to show yet regardless — this
  instance has zero real devices reporting to it, which is the correct state until a node
  is pointed at it (see `HANDOVER-STEP-BY-STEP-2026-09-15.md` §4).
- **Mobile app screens.** ADB wireless-debugging pairing had expired again at capture
  time — same blocker recorded in `TEST-REPORT-2026-09-15.md` §6. The most recent real
  on-device screenshots are the ones already described there, not re-captured tonight.
- **Anything from the Pi over SSH** (container logs, `pihole -g`, etc.) — no SSH key was
  loaded in this session. Same blocker as `TEST-REPORT-2026-09-15.md` §6.
- **GIFs / motion.** Everything above is a single still frame. No screen-recording tool was
  confirmed available on this machine tonight, so static screenshots are what's real here
  rather than claiming a recording that wasn't actually made.

## How to re-run this yourself

Every capture above came from an ordinary headless Edge screenshot against a URL — nothing
hidden:

```
msedge --headless --disable-gpu --screenshot=out.png "http://192.168.0.10:8080/api/v1/system/status"
```

For the kiosk (needs JS to finish rendering before the shot is taken):

```
msedge --headless --disable-gpu --virtual-time-budget=8000 --screenshot=out.png "http://192.168.0.10:8080/device-kiosk/"
```

For an authenticated API route, credentials go straight in the URL:

```
msedge --headless --disable-gpu --screenshot=out.png "http://admin:<password>@127.0.0.1:8091/api/v1/fleet/summary"
```

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
