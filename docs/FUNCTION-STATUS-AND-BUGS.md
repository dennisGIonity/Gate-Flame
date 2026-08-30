```
========================================================================================
GATE^FLAME — FUNCTION STATUS & OPEN BUGS
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-08-015-FUNC | Version: 1.0 | Updated: 2026-08-31 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Classification: INTERNAL | Building Tomorrow, Today.
========================================================================================
```

Every function across the four surfaces, whether it works, and how that was
established. Then every open bug and problem.

**Legend**

| | |
|---|---|
| ✅ | Works. Verified on real hardware or by a passing test. |
| 🟩 | Works, verified by build/type-check only — not exercised live. |
| 🟡 | Partly works, or works with a caveat you need to know. |
| 🔴 | Does not work / not built. |
| ⬛ | Deliberately absent. Not a gap. |

---

# 1 — NODE AGENT (`node-agent/gateflame/`, live on `GF-72TYTITQ`)

## Identity, pairing, auth

| Function | State | Evidence |
|---|---|---|
| `GET /system/status` | ✅ | 200 live; returns node id, version, provisioned |
| `GET /system/kiosk` | ✅ | 200; reports mount path + `consolePinEnabled` |
| `POST /pair/request` | ✅ | Covered by `test_pairing.py` |
| `POST /pair/claim` | ✅ | `test_pairing.py` |
| `GET /pair/devices` | ✅ | 200 live; 6 devices paired |
| `DELETE /pair/devices/{id}` | ✅ | `test_pairing.py` |
| `POST /pair/devices/revoke-all` | ✅ | `test_pairing.py`; provisioned survives revoke |
| Loopback-only `kiosk` scope | ✅ | `security.py`; measured 127.0.0.1 allowed / LAN 401 |
| `POST /console/unlock` (PIN) | 🟡 | Route live, returns **503** — no PIN set on this box. Lockout logic unit-tested but **never exercised with a real PIN** |

## Telemetry & health

| Function | State | Evidence |
|---|---|---|
| `GET /telemetry/summary` | ✅ | 200 live, real CPU/mem/disk/temp |
| `GET /services` | ✅ | 200; 7 modules, 3 running |
| `GET /modules/{id}/metrics` | 🟩 | Registered; not called live this run |
| `GET /posture/audit` | ✅ | 200 live |
| `GET /posture/netcheck` | ✅ | 200 live — **previously listed as missing; resolved** |
| Health feed → fleet | ✅ | Pi posting every 5 min, seen 171s ago |
| Per-node feed token | ✅ | Issued + stored; 6/6 rollout assertions pass |

## Filtering (the product)

| Function | State | Evidence |
|---|---|---|
| `GET /filtering` | ✅ | 200, `protectionStatus: active` |
| `PUT /filtering/threat-level` | ✅ | `test_filtering_api.py` |
| `PUT /filtering/categories` | ✅ | `test_content_categories.py` |
| `POST /filtering/pause` + expiry | ✅ | `test_filtering_state.py` |
| `POST /filtering/resume` | ✅ | same |
| Blocklist write + read-back | 🟡 | Works live (359,667 domains) but **3 unit tests are stale** — see BUG-03 |
| Actual DNS blocking | ✅ | `doubleclick.net → 0.0.0.0`; `ionity.today` resolves |

## Clients & device names (new)

| Function | State | Evidence |
|---|---|---|
| `GET /clients` | ✅ | 200; **17 raw rows → 4 real devices** |
| MAC de-duplication | ✅ | eth0/wlan0 merged, both interfaces kept |
| Container / link-local filtering | ✅ | Docker + `fe80::` correctly excluded |
| OUI vendor lookup | ✅ | Intel, TP-Link resolved live |
| Randomised-MAC detection | ✅ | Both handsets correctly flagged; no vendor invented |
| `PUT /clients/{mac}/name` | ✅ | Set, read back, cleared, restored — all live |
| Bad-MAC rejection | ✅ | **400**, not stored |
| DHCP hostname source | ⬛ | Always empty by design — the router runs DHCP (ADR-001) |

## Shield (VPN)

| Function | State | Evidence |
|---|---|---|
| `GET /vpn/regions` | ✅ | 200; real VPN Gate countries |
| `GET /vpn/continents` | ✅ | 200 |
| `GET /vpn/devices` | ✅ | 200 |
| `GET/PUT /vpn/devices/{mac}` | ✅ | 200 |
| `GET /vpn/devices/{mac}/vpngate-config` | 🟩 | Route live; **.ovpn fetch never exercised end-to-end** |
| Ionity's own exit servers (headscale) | 🔴 | `controlPlaneReachable: false` — do not exist |

## Network / firewall / WAN

| Function | State | Evidence |
|---|---|---|
| `GET /wan/summary` | ✅ | 200 |
| `GET /flows/recent` (DPI) | ✅ | 200 |
| `GET /firewall/bounced` | ✅ | 200 |
| `POST/DELETE /firewall/bounce` | 🟩 | `test_firewall.py`; **never fired on live hardware** |
| `netclaim` / `netapply` | 🟩 | Well tested; dry-run default. Capped at OFFER |
| Router credentialed login | ⬛ | Deliberately not built — see CLAUDE.md §4 |
| DNS watchdog + IPv6 self-heal | 🟡 | Written and tested; **not live on the Pi** |

---

# 2 — KIOSK CONSOLE (`src/components/kiosk/`, on the Pi's screen)

| Function | State | Evidence |
|---|---|---|
| Served at `/device-kiosk/` | ✅ | 200 live |
| Lock screen + hold-to-unlock | ✅ | Installed bundle verified |
| PIN unlock via `verifyPin` | 🟡 | Wired; **inert until a PIN is configured** |
| Idle re-lock (4 min) | 🟩 | Type-checked; not timed live |
| Overview / Filtering / Threats panels | ✅ | Backed by 200-answering routes |
| **Shield panel** | ✅ | Present in installed bundle; routes answer 200 |
| Network / Modules / Firewall / WAN / System panels | ✅ | All backing routes 200 |
| Read-only for LAN viewers | ✅ | `consoleAuthority()` from socket; `ViewerNotice` |
| Pairing overlay + real countdown | 🟩 | Not re-exercised this run |
| Unreachable / refused states | 🟩 | Unit-tested (`kioskConsole.test.tsx`, now passing) |

---

# 3 — MOBILE APP (`src/mobile/`, on the S10e)

| Function | State | Evidence |
|---|---|---|
| Pairing screen + token storage | ✅ | Phone is paired and showing live data |
| Node discovery | ✅ | Working — Home shows real figures |
| **Home** | ✅ | Screenshotted: Protected, 2 855 lookups, 14 blocked, 4 devices |
| **Activity** | 🟩 | Text trimmed, type-checked, not re-photographed |
| **Blocked (threats)** | 🟩 | same |
| **Shield** | 🟩 | Tab present; backing routes 200. **Rename UI not yet tapped on the handset** |
| **Network** | 🟩 | Trimmed; not re-photographed |
| **Health** | 🟩 | same |
| **Settings (Controls)** | 🟩 | same |
| **Play (Ionicrobes)** | 🟩 | Lazy-loaded; untouched |
| Ionibot assistant | 🟩 | Renders; not exercised |
| Decluttering | ✅ | Home verified by before/after screenshot |
| Bottom-card clearance under the bubble | ✅ | Fixed 7rem → 10rem after seeing it |
| Token-rejection → re-pair | 🟩 | Coded; not forced |

---

# 4 — FLEET DASHBOARD (`fleet/`, on the workstation)

| Function | State | Evidence |
|---|---|---|
| Ingest `POST /nodes/{id}/health` | ✅ | Live Pi posting every 5 min |
| Per-node token enrolment | ✅ | 6/6 assertions |
| Backwards-compatible rollout | ✅ | Old agent keeps working until it activates |
| Basic-auth on dashboard | ✅ | Unauthenticated `GET /` → 401 |
| `GET /healthz` | ✅ | 200, unauthenticated by design |
| `GET /api/v1/nodes` + filters/sort | ✅ | 200; filtering server-side |
| `GET /fleet/summary` | ✅ | Tiles + trend + tag/billing counts |
| `GET /nodes/{id}` | ✅ | Detail renders |
| `GET /nodes/{id}/history` | ✅ | 12 points, resolution labelled |
| `PUT /nodes/{id}/admin` | ✅ | Round-tripped; chips appear in summary |
| `POST /nodes/{id}/notes` | ✅ | Persisted |
| Hourly rollup + retention | 🟩 | Code runs hourly; **90-day pruning never observed** |
| SVG graphs | ✅ | Render from real data; gaps break the line |
| Search / tag / billing filters | ✅ | Exercised in the browser |
| **Remote support actions** | 🔴 | **Not built.** No channel back to a node |
| Survives reboot | 🔴 | Hand-started script; dies with its terminal |

---

# 5 — OPEN BUGS AND PROBLEMS

## 🔴 Blocking / important

| # | Problem | Detail |
|---|---|---|
| **BUG-01** | **Test suite will not run from a fresh clone** | Three test files import `gateflame.main`, which builds `Store(config.db_path)` at import and tries to `mkdir /var/lib/gateflame`. Any non-root user gets `PermissionError` and **collection aborts**. Needs `GATEFLAME_DB_PATH` set, which is documented nowhere. Fix: default to a temp path under pytest, or add a `conftest.py` that sets it. |
| **BUG-02** | **`NODE_ENV=production` breaks the frontend test suite** | 34 tests fail with `React.act is not a function` because React loads its production build, which has no `act()`. Already documented as breaking `npm ci`; it breaks vitest too. Fix: set `NODE_ENV` in `vitest.config.ts`, or clear it in an npm pretest script. |
| **BUG-06** | **Fleet server does not survive a reboot** | Started by hand from `start-fleet.ps1`. If the workstation restarts or the terminal closes, every box keeps posting into nothing. Needs a scheduled task/service, or to move to always-on hardware. |
| **BUG-07** | **Fleet feed URL is a hardcoded DHCP address** | `50-feed.conf` on the Pi points at `192.168.0.6`. The workstation is on DHCP and **has already moved once** (.7 → .6). When it moves again the dashboard goes quiet with no warning. Needs a reservation, a hostname, or mDNS. |
| **BUG-11** | **Release keystore has no verified backup** | `~/.gateflame-signing/gateflame-release.jks` is irreplaceable. SHA-256 is recorded; the file is not backed up. Losing it means never updating the Play listing again. |
| **BUG-12** | **Live secrets still in plaintext** | Two GitHub PATs and `GEMINI_API_KEY` in `TempGateFlameBuild\.env.local`. Revoke and rotate. |

## 🟡 Real, not urgent

| # | Problem | Detail |
|---|---|---|
| **BUG-03** | **5 stale backend tests** | 3 blocklist tests expect 1 list URL where `threat_level.py` now supplies 3 (commit `dd76ec7`), plus 2 fixture-drift failures in the watchdog and filtering-honesty suites. Proven pre-existing at `3f08d33`. They make a green run impossible, which erodes the value of the suite. |
| **BUG-04** | **Console PIN never exercised with a real PIN** | `GATEFLAME_CONSOLE_PIN` is unset, so `/console/unlock` returns 503 and the kiosk stays hold-to-unlock. The lockout path (5 strikes / 60s) has unit tests but no live proof. |
| **BUG-05** | **`.ovpn` handoff never tested end-to-end** | `vpngate-config` route answers, but nobody has fetched a config and opened it in an OpenVPN client. The share-sheet path on Android is untested. |
| **BUG-08** | **90-day retention never observed** | The rollup thread runs hourly and the SQL is written, but no data is old enough to have been rolled up or pruned. First real proof is 7 days away. |
| **BUG-09** | **Pi's own resolver points at the router** | `/etc/resolv.conf` → `192.168.0.1`. A lookup on the Pi resolves trackers normally. Known fault #2; blocked on the router decision. |
| **BUG-10** | **DNS watchdog / IPv6 self-heal not deployed** | Written, tested, syntax-clean — still not live on the Pi. This is the fix for phones dropping Wi-Fi. |
| **BUG-13** | **Six mobile screens changed but not visually checked** | Only Home was screenshotted before/after. The others were text-edited, type-checked and built, but not looked at on the handset. |
| **BUG-14** | **Shield rename never tapped on the phone** | The API is proven live; the mobile UI that calls it has not been used by a human. |
| **BUG-15** | **Doctor still reports 1 orphan commit + 3 upstream-less branches** | `73e3056` exists in one clone only; `GateFlame-Repo/chore/repo-hygiene`, `GateFlame-Repo/fix/mobile-hookup`, `gf-scratch/deploybundle` have no upstream. `SAVE-EVERYTHING.cmd` clears it. |
| **BUG-16** | **Android rotates the wireless-debug port every toggle** | A stored `IP:port` is single-use. Use `adb mdns services` to discover it, never a saved value. |
| **BUG-17** | **Uncommitted third-party edits in the tree** | `android/version.properties`, `vite.standalone.config.ts`, untracked `debug.cjs` — not mine, deliberately not touched. |

## ⬛ Deliberately absent — do not "fix"

| Thing | Why |
|---|---|
| Router credentialed login | Would need reverse-engineering TP-Link's private handshake; breaks silently on firmware updates in a customer's house |
| Secondary DNS | Clients query resolvers in arbitrary order, making protection intermittent and inexplicable |
| Per-device attribution on the standard box | ADR-001: the router asks on behalf of the house. Pi-hole sees the router |
| Remote control today | No channel back to a node. A button that cannot work is worse than none |
| Device names in the health feed | Household data stays on the box (PAIRING-AND-TELEMETRY §4.1) |

---

# 6 — THE NEXT DECISION

**The Headscale control plane.** The persistent per-box tunnel chosen for
remote support and Shield's missing exit servers are the *same* piece of
infrastructure. Standing it up once unblocks both — `controlPlaneReachable`
is false for exactly this reason.

Three answers needed before any code is worth writing:

1. **Where it is hosted.** Not the fleet box — see BUG-06.
2. **What the consent notice says.** This is a live inbound path into a
   customer's home. POPIA applies, and Play's data-safety form must match.
3. **Whether it is premium-only.** A product call, not a technical one.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
