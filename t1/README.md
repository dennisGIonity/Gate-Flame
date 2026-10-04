```
========================================================================================
GATE^FLAME — STANDARD T1: ESP32-S3 DNS FILTER + IONITY SERVER
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-09-025-T1 | Version: 0.2 | Updated: 2026-10-03 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Standard T1

T1 is the lowest tier in `docs/TIERING-PLAN.md`: an **ESP32-S3 that filters DNS**, with the
heavy lifting done on the Ionity server (running on this PC for now). It is a separate
build from `E:\.claude\Ionity\.ESP32-MCP`, which is **not touched**: T1 has its own port (**8095**), its
own mDNS service (`_gft1._tcp`), its own MCP tool names (`t1_*`) and its own firmware.

> 📐 **Next build steps: `docs/T1-BLUEPRINT.md`** — build patterns (one image + NVS provisioning,
> per-device tokens, verified flasher, signed OTA) taken from ESP32-MCP as *ideas only*. That is a
> different client's project; no code or data comes across.

```
 household devices ──DHCP DNS──▶ ROUTER ──upstream DNS──▶ T1 (ESP32-S3) ──▶ 9.9.9.9 / 149.112.112.112
                                   ▲  falls back on its own                  │
                                   └── if T1 is down (ADR-001) ──────────────┘ counters only
                                                                              ▼
                                  Ionity server (this PC, :8095): builds + signs filters,
                                  fleet API, dashboard, MCP gateway for AI
```

## Run it

| Step | Command | What proves it worked |
|---|---|---|
| 1. Start the server | `tools\T1-SERVER.cmd` | Dashboard at http://127.0.0.1:8095/ shows three filters built |
| 2. Firewall, once, admin PowerShell | `New-NetFirewallRule -DisplayName "GateFlame T1 server 8095" -Direction Inbound -Protocol TCP -LocalPort 8095 -Action Allow -Profile Private` | boards can report |
| 3. Flash + provision a board | `tools\T1-BUILD-FLASH.cmd` (asks SSID + Wi-Fi password locally; `-ProvisionOnly` re-writes settings without re-flashing) | Script prints `TEST PASSED (wifi > server > enrol > auth > signature)` then `REPORTED: gft1-… PROTECTED` — it waits for the board, not for the flasher |
| 4. Point the **router's upstream DNS** at the board's IP | router UI (reserve the IP in DHCP, or `-StaticIp`) | dashboard: queries climbing, blocked % > 0 |

No hardware yet? `t1\server\.venv\Scripts\python.exe t1\scripts\sim-device.py --forget`
runs the full device contract (signed download, telemetry, commands) against the server.

## What is where

| Path | What |
|---|---|
| `firmware/GF_T1_Node/` | Arduino sketch (esp32 core 3.3.x). `gf_bloom.h` + `gf_dns.h` are the filter and DNS core, **shared with the host tests** |
| `server/t1server/` | FastAPI server: `bloom.py` builder, `signing.py` (ECDSA P-256), `lists.py`, `service.py`, `app.py`, `mcp.py` |
| `server/static/` | Dashboard |
| `server/mcp_stdio.py` | stdio bridge for Claude Desktop (config in its docstring) |
| `server/tests/` | 15 tests; two compile the firmware headers with gcc and prove C and Python read the same file identically |
| `server/data/` | **git-ignored**: signing private key, tokens, filters, SQLite. Back up `data/keys/` — losing it means reflashing every board |
| `scripts/` | `start-server.ps1`, `build-flash.ps1`, `compile-check.ps1`, `sim-device.py` |

## How it filters — and the honest limits

- **Lists:** exactly the T3 box's `node-agent/gateflame/threat_level.py` (low / medium / high),
  imported, not copied, so a level means the same lists on every tier. Build of 2026-09-25:
  **low 340,446 domains = 0.61 MB, medium 3,023,751 = 5.43 MB, high 3,037,423 = 5.46 MB.**
- **Bloom filter, 0.1 % false positives, k = 10.** A false positive blocks a good site; the
  dashboard's *Check a domain* says whether a block is a real list entry or a false positive,
  and the **allow-list** fixes it fleet-wide.
- **Exact matching**, like Pi-hole gravity on T3 — `x.ads.com` is not blocked because `ads.com` is.
- **Signed**: the board refuses any filter or allow-list whose ECDSA signature does not verify
  against the key compiled in; the flash copy is re-verified on every boot.
- **Survives power cuts**: the filter is kept in FFat, so after load shedding the board filters
  again without the server.
- **Status** uses the T3 vocabulary: active / paused / bypass / degraded / applying.
- **Privacy:** telemetry is counters only. **No domain name leaves the board.**
- **One image, provisioned after flashing (0.2.0).** No Wi-Fi password, server address or token is
  compiled in. They are written to the board's NVS over serial (`gf-t1-prov/1`, which
  `build-flash.ps1` drives) or through the setup hotspot `GateFlame-T1-XXXX`, which opens by itself
  on an unprovisioned board and again after 3 minutes without Wi-Fi. A board refuses a settings
  write unless every field validates, and never echoes a secret.
- **Per-device tokens.** A board enrols once with the enrolment token (`python -m t1server
  enrol-token`), receives a token of its own (stored hashed server-side), and erases the enrolment
  token. The enrolment token can only enrol. A re-flashed or revoked board needs an admin reset
  (`/devices/{id}/token/reset`, or the MCP tool).
- **Signed OTA with rollback.** The server stages a firmware image to a rollout (canary devices +
  a stable-hash percentage). The board streams it into the idle app slot, checks SHA-256 **and** the
  ECDSA signature before finalising, reboots, and has 10 minutes to reach the server, load its
  filter and keep answering DNS, otherwise the bootloader returns to the old image.
- **DNS over TCP (RFC 7766)** and a **PSRAM response cache** (1024 entries, 2-way, TTL-aged, 0x20
  case echoed). The filter verdict is taken before the cache is read; only allowed answers are stored.
- **Backups:** `tools\T1-BACKUP.cmd` zips the signing key, tokens and database. **Lose the signing
  key and every board in the field refuses every update.** Keep a copy off this PC.
- **Survives a reboot of this PC:** `tools\install-t1-autostart.ps1` (Task Scheduler, same pattern
  as the fleet's). Not proven until you reboot and see `/api/t1/v1/health` answer.
- **Verified here:** 55 server tests (identity, rollout, OTA artefacts, backup, firmware contract),
  296 host checks of the firmware's pure-C headers under ASan/UBSan, and the sketch compiles clean
  with arduino-cli for `esp32s3` (36 % of a 3 MB app slot, 23 % of internal RAM).
- **NOT verified (needs the hardware on a bench, Dennis):** the sketch has **never run on a
  board** in its 0.2.0 form. Still to measure on real hardware: queries/second, latency added,
  Wi-Fi robustness, an actual OTA round trip *including a deliberate bad image to watch the
  rollback*, TCP under load, and the hotspot on an iPhone and an Android handset.
- **Not done, deliberately:** DoT to upstream, secure boot / flash encryption (without them the
  signed-update key protects updates but not a physical attacker with the board). Both are needed
  before T1 is **sold**; neither blocks the lab.
