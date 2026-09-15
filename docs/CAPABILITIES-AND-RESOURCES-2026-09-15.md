```
========================================================================================
GATE^FLAME — CAPABILITIES & RESOURCE USAGE
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-15-CAP | Version: 1.0 | Updated: 2026-09-15 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Classification: INTERNAL | Building Tomorrow, Today.
========================================================================================
```

Written for the project testing team. Two things live here: what the system can do
(by module, not by marketing language), and what it actually costs to run, measured on
the real unit — not a spec sheet.

## Part A — Capabilities, by module

Source: `node-agent/gateflame/services.py` `MODULE_DEFS`, the single registry every
surface (kiosk, app, fleet) reads from. Each module honestly reports `running`,
`degraded` (with a named gap and remedy), `stopped`, or `not_implemented` — never a
faked `running`. Standard tier only; premium-only modules are noted.

| Module | What it does | Kind | Standard-tier state today |
|---|---|---|---|
| System Telemetry | CPU / memory / disk / temperature / throttle, uptime | Passive (always on) | ✅ Running |
| Passive Client Discovery | Sees devices on the LAN without probing them | Passive | ✅ Running (needs `ip`/iproute2, present) |
| DNS Filtering | The product: blocks ads, trackers and chosen categories at the resolver | Passive, reports Pi-hole reachability | ✅ Running — box reachable, Pi-hole answering |
| Firewall Bounce | Drop a device off the network | Active, needs `CAP_NET_ADMIN` | ⬛ Stopped by capability — standard tier does not claim the gateway (ADR-001); the capability check is real, not policy-only |
| Deep Packet Inspection (headers only) | Flow-level visibility, premium only | Active, needs `CAP_NET_RAW` | ⬛ Premium only, not standard |
| WAN Quality & Budget | Link quality + data-cap tracking | Active | 🟡 Degraded — no `GATEFLAME_WAN_INTERFACES` configured on this box (deliberately never guessed) |
| Zero-Trust Posture | Audits (never changes) sshd/exposure config | Read-only audit | Reports its own capability live |

Beyond the module registry, the product surfaces these capabilities across its three
faces:

**Mobile app:** pairing/token issuance, node auto-discovery, live protection status,
query/blocked history, network device list, box health, threat-dial + category
controls + pause, Shield (VPN) country picker and per-device naming, a startup splash.
Not yet live: Shield `.ovpn` handoff end-to-end, Ionity's own VPN exit servers,
Profiles (Standard/Family/Strict/Focus — route exists, agent not deployed),
Accessibility settings (same reason), IoniBot beyond rendering, a signed release build.

**Kiosk (the box's own screen):** lock + hold-to-unlock, Overview, Filtering, Threats,
Network, Modules, WAN, System, Shield panel, a read-only view for any other LAN device
that explicitly refuses to leak data remotely (proven live this session — see the test
report §4). PIN unlock and idle re-lock are built but unset/untimed. Pairing overlay
issues codes with a countdown.

**Fleet dashboard (operator console, this session's focus):** per-device health
check-in ingest, a searchable/sortable/filterable device list, fleet-wide summary
tiles and 7-day trend charts, per-device history at four resolutions (24h/7d/30d/90d),
an operator's own record per box (label, customer reference, tags, billing state), an
append-only support-note log, and server-computed "support findings" that translate a
box's last check-in into what a support person should check — all read-only by
Dennis's explicit decision; no remote-control channel exists or is planned for this
surface. New this session: `GET /api/v1/system/feed` on the node side, so a stale feed
URL is visible locally instead of silently going dark (see BUG-07 in
`FUNCTION-STATUS-AND-BUGS.md`).

**Deliberately absent (ADR-001, and Dennis's own product calls — not gaps):**
secondary DNS, per-device filtering history on the standard tier, remote control into
a customer's box, and pointing devices at the box directly instead of the router.

## Part B — Resource usage, measured on the real unit

**Node identity, live right now:** `GF-72TYTITQ`, agent `0.1.0`, provisioned,
`192.168.0.10:8080`, storage healthy at `/opt/gateflame/.DUMP` — read directly from
`GET /api/v1/system/status` during this session (see test report §3).

**Host resources**, from the mobile app's Health screen against this same box earlier
today (2026-09-15, real hardware, not simulated):

| Metric | Value |
|---|---|
| CPU | 25% |
| Temperature | 51.8°C |
| Storage used | 40.5% |
| Memory | 2.5 / 15.8 GB |
| Uptime | 3 days 4 hours |
| WAN link quality | Honestly reported as unavailable — "no WAN interface configured," never a guessed number |

**Traffic being handled**, same reading: 207,207 DNS queries looked up, 52,991 blocked
(25.6%), across 12 paired/known devices, 9 devices freshly seen on the network scan.

**Node-agent test suite performance:** 634 tests complete in **11.6 seconds** on the
development workstation (`E:\Gateflame\node-agent`, `pytest -q`) — not a production
metric, but a useful number for the testing team estimating their own CI time.

**Fleet dashboard**, started fresh this session: `uvicorn` process, SQLite backing
store (`fleet.db`, not yet created — no writes have landed since nothing is posting to
it yet), binds `0.0.0.0:8091`, answered `/healthz` and every read route in well under a
second locally. No load or stress test has been run against it — it has never carried
more than the zero to one nodes it has seen in development.

**What is not measured, and why:** kiosk-side resource cost of rendering the console
itself (Chromium in `--kiosk` mode on the Pi) was not separately profiled this
session — the Health module already reports the box's total CPU/memory/temp inclusive
of everything running on it, and there is no isolated per-process breakdown built.
Network bandwidth consumed by the DNS filter itself (as opposed to what it saves by
blocking) has never been measured — Dennis's own framing is that a warm cache is
*faster* than not having the box at all (<1ms vs 20-40ms to the ISP), which is a
latency claim, not a bandwidth one, and the two should not be conflated in reporting
this to the testing team.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
