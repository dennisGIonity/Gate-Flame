# Gate^Flame Kiosk — Google AI Studio build prompt

Paste everything between the rules into AI Studio. It is written to produce a
UI that keeps the visual language of the existing onboarding screen but is
wired to the node's real API, and that structurally cannot invent data.

---

You are building the on-device kiosk display for **Gate^Flame**, a network
security appliance built on a Raspberry Pi 5. The Pi plugs into a home or small
office router, runs Pi-hole DNS filtering plus a Python agent, and this screen
is the appliance's own face — a Chromium browser running fullscreen on the
device itself, at 1920×1080, viewed from across a room.

Build a **single-page React + TypeScript app styled with Tailwind CSS**. No
router. No backend of your own. It talks to a local HTTP agent on
`http://localhost:8080`.

## THE ONE RULE THAT OVERRIDES EVERYTHING

**Never display a value the API did not return.**

This is a security product. A fabricated number on this screen is a false claim
about someone's network. The previous version of this screen showed invented
Wi-Fi networks and a hardcoded IP address, and that is exactly what you must
not reproduce.

Concretely:

- `null` from the API means **unknown**. Render an em-dash `—` and, where the
  API supplies a `gap` string, show that text in muted type beneath.
- An empty array means **nothing observed**. Render a deliberate empty state
  ("No threats recorded yet"), never placeholder rows.
- Do not seed state with example data. Do not use `Math.random()` for anything
  that represents a measurement. Do not write fallback constants like
  `?? 1247`.
- Decorative animation is welcome. Decorative animation with **words on it** is
  not, unless those words came from the API.
- If you need something to look alive before data arrives, use a skeleton
  shimmer, not fake numbers.

## THE REAL API

Base URL `http://localhost:8080`. These are actual responses captured from a
running node — match these shapes exactly.

### `GET /api/v1/system/status`
```json
{ "nodeId": "GF-72TYTITQ", "agentVersion": "0.1.0", "provisioned": false }
```

### `GET /api/v1/telemetry/summary`
Note how many fields are legitimately `null` — this is the normal state of a
node without Pi-hole installed, and the UI must look composed, not broken.
```json
{
  "totalQueriesToday": null,
  "queriesBlockedToday": null,
  "blockPercentage": null,
  "domainsOnGravity": null,
  "activeClientsCount": null,
  "dataSavedMB": null,
  "avgLatencyMs": null,
  "uptimeSeconds": 636,
  "host": {
    "cpuPercent": 35.0,
    "memUsedMB": 2371,
    "memTotalMB": 16214,
    "diskUsedPercent": 37.1,
    "uptimeSeconds": 636,
    "tempC": 52.4,
    "throttleFlags": "0x0"
  },
  "piholeReachable": false,
  "gap": "Pi-hole not configured or unreachable — query/block counts unavailable"
}
```

### `GET /api/v1/clients`
```json
{ "clients": [
  { "ip": "192.168.0.7", "mac": "2c:a1:eb:40:1a:00", "hostname": null, "interface": "eth0" },
  { "ip": "192.168.0.1", "mac": "78:20:51:9f:1e:8b", "hostname": null, "interface": "eth0" }
]}
```
`hostname` is frequently `null`. Show the IP as the primary identifier and the
MAC as secondary. Never invent a device name from the MAC vendor prefix.

### `GET /api/v1/services`
```json
{ "modules": [
  { "id": "module_telemetry", "label": "System Telemetry", "status": "running" },
  { "id": "module_passive_discovery", "label": "Passive Client Discovery", "status": "running" },
  { "id": "module_dns_filter", "label": "DNS Filtering", "status": "degraded",
    "gap": "Pi-hole not configured or unreachable" },
  { "id": "module_firewall_bounce", "label": "Firewall Bounce", "status": "stopped" },
  { "id": "module_dpi_flow", "label": "Deep Packet Inspection (headers only)", "status": "stopped" },
  { "id": "module_wan_audit", "label": "WAN Quality & Budget", "status": "degraded",
    "gap": "no WAN interface configured — set GATEFLAME_WAN_INTERFACES" },
  { "id": "module_zero_trust", "label": "Zero-Trust Posture", "status": "stopped" }
]}
```
`status` is one of `running` | `stopped` | `degraded` | `not_implemented`.
When a `gap` is present it must be visible — it is the module explaining
exactly what it needs. Never render a green indicator next to a module that
carries a gap.

### `GET /api/v1/threats/recent?limit=20`
```json
{ "entries": [], "source": "none",
  "gap": "no threat data source configured — Pi-hole query log or DPI capture required" }
```

### `POST /api/v1/pair/request`
```json
{ "code": "112514", "expiresAt": "2026-08-15T18:56:17Z", "attemptsRemaining": 5 }
```
Only callable from the device itself. This is the pairing flow: physical
presence at the appliance is the authorisation.

### Also available
`GET /api/v1/pair/devices`, `GET /api/v1/wan/summary`,
`GET /api/v1/posture/audit`, `GET /api/v1/flows/recent`,
`GET /api/v1/system/kiosk`.

**There is no Wi-Fi scanning endpoint. Do not build a network picker.** The
appliance is wired via Ethernet. A screen offering to choose an uplink would be
fiction.

## SCREENS

One page, four regions, no navigation chrome. A kiosk has no keyboard and often
no mouse.

**1 — Header.** Product mark, node ID from `/system/status`, the node's own LAN
IP, agent version, and a live/degraded indicator. The IP must come from the
data, never a literal.

**2 — Hero panel.** The headline state: is filtering active, how many devices
are on the network, uptime. Where Pi-hole is unreachable this panel says so
plainly and looks intentional about it.

**3 — Module grid.** One card per module from `/services`. Status colour, label,
and the gap text when present. This is the honest heart of the screen.

**4 — Right rail.** Live host telemetry — CPU, memory, disk, temperature,
throttle flags — plus the connected client list.

**Pairing overlay.** A prominent "Pair a phone" button. Pressing it calls
`POST /api/v1/pair/request` and displays the six-digit code very large, with a
live countdown to `expiresAt`. This is the single most important interaction on
the screen: it is how a customer gets the mobile app working without a terminal.

## VISUAL LANGUAGE

Keep the aesthetic of the existing screen — it was the good part.

- **Background** near-black navy `#080D16`, with a very soft radial glow toward
  the centre and a barely-there particle drift. Calm, not busy.
- **Cards** `#111A28` at ~80% opacity with `backdrop-blur`, 1px border
  `#1E293B`, radius 16px, generous padding.
- **Selected / active** state: 2px cyan border `#38BDF8` with an outer glow
  `0 0 24px rgba(56,189,248,0.25)`.
- **Brand accents** — Ionity blue `#006FD3`, Ionity orange `#FF8700`. Use blue
  for structure and orange sparingly, for genuine attention only.
- **Status colours**: running `#10B981`, degraded `#F59E0B`, stopped `#64748B`,
  fault `#E11D48`.
- **Type**: Inter or system sans for prose; JetBrains Mono or ui-monospace for
  every number, ID, IP and MAC. Numbers must be tabular so they don't jitter as
  they update.
- **Icon chips**: 40px rounded square, `#0F1B2D` fill, cyan glyph, matching the
  existing rows.
- **Footer**: small, uppercase, wide letter-spacing, muted `#475569` —
  `IONITY GATE^FLAME NODE` with the node ID.
- **Scale for distance.** This is read from two metres away. Body text no
  smaller than 16px; headline metrics 48–72px.
- Motion should be slow and continuous. No spinners that imply activity that
  isn't happening.

## BEHAVIOUR

- Poll `/telemetry/summary`, `/services`, `/clients` every 4 seconds.
  `/threats/recent` every 10.
- Use `AbortController`; never let polls stack up.
- On fetch failure show a clear "Node unreachable" state with the last-good
  timestamp. Do not silently keep showing stale numbers as if they were live.
- No `localStorage`, no cookies. The screen is stateless.
- Handle a fresh node gracefully: `provisioned: false`, zero paired devices,
  empty everything. That is day one, and it should look designed.

## DELIVERABLE

A single self-contained React + TypeScript component tree using Tailwind
utility classes, with a small typed API client module. Include the TypeScript
interfaces for every response shape above. Comment anywhere a `null` or empty
case is handled, explaining what the user sees and why.

---

## After AI Studio: how this lands in the repo

The generated app becomes the new `src/main-kiosk.tsx` entry and its
components. To wire it in:

1. Drop the components into `src/components/kiosk/`.
2. Point `src/main-kiosk.tsx` at the new root component.
3. `npm run build:html-kiosk` — produces `dist-kiosk/`.
4. `scp` the bundle to the Pi and run `sudo bash install-kiosk.sh ~/dist-kiosk`.

The agent serves it at `http://localhost:8080/device-kiosk/`, and Chromium
displays it fullscreen via `gateflame-kiosk.service`.

**Reuse rather than regenerate:** `src/services/gateflameApi.ts` and
`src/hooks/useConnection.ts` already implement the live/demo connection state
and the honest-gap plumbing correctly. Prefer wiring the new UI to those over
writing a fresh fetch layer.

## To be deleted once the replacement lands

1,526 lines of AI-Studio-era demo furniture, referenced from `App.tsx` and
`main-kiosk.tsx`:

| Component | Lines |
|---|---|
| `DeviceOnboardingSimulator.tsx` | 722 |
| `ExportPackagingCenter.tsx` | 403 |
| `ServerSyncArchitecture.tsx` | 246 |
| `DeploymentScriptViewer.tsx` | 155 |

Do not delete them before the new kiosk works — `main-kiosk.tsx` imports
`DeviceOnboardingSimulator` eagerly, so removing it now leaves a blank screen.
