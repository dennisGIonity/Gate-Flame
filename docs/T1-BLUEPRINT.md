```
========================================================================================
GATE^FLAME — T1 BLUEPRINT: BUILD PATTERNS FOR A TIER-ONE GATE^FLAME
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-10-002-T1BP | Version: 1.0 | Updated: 2026-10-02 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# What this is — and what it is not

**Two different projects, two different clients.**

| | ESP32-MCP (`E:\.claude\Ionity\.ESP32-MCP`, repo `Esp32-MCP`) | Gate^Flame T1 (`t1/`, this repo) |
|---|---|---|
| Client | A different client | Gate^Flame households |
| Job | Fleet telemetry, sensors, actuators, edge inference | DNS filtering |
| Port | :8099 | :8095 |

This document takes the **build patterns** from ESP32-MCP v2.0.1 (read 2026-10-02) — *how* that
project gets one image onto many boards, provisions them, updates them and manages them — and
writes them down as the blueprint for building T1 the same way.

**Rules:**

- **No code, configuration, data, credentials or client-specific features are copied.**
  Everything below gets rebuilt in `t1/`.
- **ESP32-MCP is never edited from here**, and Gate^Flame is never merged into it.
- Where a T1 rule already exists (signed filters, counters-only telemetry, the five-state
  status words, ADR-001 upstream-only), **T1's rule wins.**

---

# Where T1 stands today (v0.1, 2026-09-25)

| Area | T1 today | Gap |
|---|---|---|
| Filter | Bloom filter, ECDSA-signed, stored in FFat, re-verified on boot | — (ahead of ESP32-MCP here) |
| Wi-Fi + server address | **Compiled in.** `build-flash.ps1` writes `secrets.h`, compiles, then deletes it | **One build per network.** Does not scale past the lab |
| Device identity / token | **One fleet token for every board** | Per-device token needed before sale |
| Firmware updates | **None (USB only)** | Needs OTA before sale |
| Flashing | arduino-cli on this PC | No customer- or installer-friendly path |
| Server discovery | mDNS `_gft1._tcp` | No fallback order written down |
| Telemetry when the server is down | Not buffered | Counters lost while offline |
| Hardening | No secure boot, no flash encryption | Needed before sale |

---

# The blueprint — seven patterns, in build order

## 1. One image, provisioned afterwards *(the biggest win)*

**Pattern:** Build **one firmware image per chip variant**, containing no Wi-Fi password, no
server address and no token. Everything that changes per network or per unit goes into **NVS**
(the ESP32's key-value flash partition) *after* flashing, over the same USB cable.

**For T1:**

- **Stays compiled in:** the filter-signing public key (`pubkey.h`) — this is what makes a board
  a Gate^Flame board.
- **Moves to NVS:**
  - Wi-Fi SSID and password
  - server address (IP, name, or blank for mDNS)
  - static IP / gateway (optional)
  - the per-device token (pattern 3)
  - threat level
  - label
- **First boot:** a board with no Wi-Fi settings waits on serial. It does not loop trying an
  empty SSID.
- **Result:** `build-flash.ps1` stops writing `secrets.h`, and the Wi-Fi password stops passing
  through the compiler.

## 2. A small provisioning line protocol over serial

**Pattern:**

- **Host to board:** one JSON object per line.
- **Board to host:** one prefixed JSON reply per line, so it stands out from ordinary log output.
- **Operations:**
  - `hello` / `get`: identity, firmware version, chip, MAC, provisioned yes/no, current settings
    **without secrets**, only `has_pass: true`
  - `set`: any subset of fields; replies with the list of fields it changed
  - `scan`: the Wi-Fi networks the board can see. An ESP32 is 2.4 GHz only, and this catches
    "it's on the 5 GHz network" before anyone wastes time on it
  - `test`: join Wi-Fi and reach the server **without rebooting**, and report the exact failure
    (SSID not found / wrong password / timeout / server unreachable)
  - `reboot`, `factory_reset`

**For T1:** name it `gf-t1-prov/1` with prefix `GF-T1-PROV`, so it can never be confused with
the other client's protocol.

- **`test` checks one extra thing:** that the board can download and **verify** a signed filter
  from the server.
- **No secret is ever echoed back or written to a log.**

This is *"never claim success without a read-back"* done at the device: a wrong password shows
up at the bench, not as a support call an hour later.

## 3. Identity from the silicon, one token per device

**Pattern:**

- **Device id:** comes from the eFuse MAC (`gft1-<mac>`). It is never typed and can never be
  changed.
- **Label and site:** stored in NVS and changeable remotely.
- **Token:** each board gets its own, generated at provisioning time. The server stores only a
  hash of it.

**For T1:**

- **Replaces the single fleet token**, which the T1 README already lists as a must-fix before sale.
- **Enrolment:** the provisioning step has the server issue the token when the board is
  enrolled, so one lost or stolen board can be cut off without reflashing every other board.

## 4. A one-click flasher that proves the result

**Pattern:** a web page (Chrome/Edge Web Serial + esptool-js) or a CLI twin. Each step has to
pass before the next one starts:

1. **Identify** the chip and the USB type. A CH340/CP210x bridge and native USB need different
   images: the wrong one flashes fine and then never answers.
2. **Download** the image named in a manifest and **check its sha256** before writing anything.
3. **Flash**, either a full erase or *update-only*. Update-only reads the partition table and
   skips NVS, so the settings survive.
4. **Wait** for the new firmware's `hello`.
5. **Provision** with `set`.
6. **Run `test`.**
7. **Reboot**, then **verify from the server side** that the board shows as online and its
   status reads **PROTECTED**.

**For T1:** serve it from the T1 server at `:8095/flasher/`. `build-flash.ps1` already does
step 7 well ("waits for the board, not for the flasher"), so keep that. The CLI twin is the
bench and production-jig path.

⚠ **Distribution is Google Play only** (decided 2026-08-24). This flasher is an
**installer/factory tool**, not a customer download. Customers receive boards already flashed
and set up from the app.

## 5. Signed OTA, staged

**Pattern:**

- **USB is used only for the first flash.** After that, updates go over the network.
- **OTA is disabled until a password or key has been provisioned.** There is no compiled-in
  default.
- **Rollouts are staged:** 1 → 10 → 100 → the rest, with the version breakdown watched on the
  fleet summary between waves.

**For T1:**

- **Signing:** the firmware is signed like the filters (ECDSA, verified on the board before it
  is swapped in) — not just password-protected.
- **Partitions:** an A/B app partition pair with rollback if the new image doesn't report
  PROTECTED within N minutes.
- **Version reporting:** the server's dashboard shows the firmware version per board, and the
  staged rollout happens from there.

## 6. Finding the server, in a fixed order, and coping without it

**Pattern:**

- **Server lookup order**, the same on every node, written down:
  1. the address pinned in NVS
  2. mDNS
  3. a documented fallback
- **When the server is unreachable:** readings go into a small ring buffer in RAM. Each one
  carries its **age** (`age_ms`) rather than a wall-clock time, and the server backdates it on
  arrival.

**For T1:**

- **Server lookup:** NVS server, then `_gft1._tcp`, then nothing. There is no hard-coded IP: a
  household is not the lab.
- **Filtering never depends on the server.** It already doesn't: the filter lives in FFat.
- **Only the counters** are buffered, and `age_ms` makes the load-shedding gaps show up honestly
  on charts instead of as a burst of readings all stamped at reconnect.

## 7. The server side: built to carry a fleet

**Patterns worth rebuilding in `t1/server/`:**

- **Registry + batched writer:**
  - the hot state for each device lives in memory
  - one writer task commits in batches of about 200 rows
  - the database commits roughly once a second, whatever the fleet size
- **Health windows:**
  - online / stale / offline worked out from when a board last reported
  - **a board that has said it is going offline (power-saving, update) is not shown as crashed**
- **Retention:** an hourly prune with a configurable number of days, and SQLite WAL truncated
  after each prune. The other project had its WAL grow to 150 MB before this was fixed.
- **Open metrics map:** a new counter is stored, charted and queryable through MCP with no
  server change.
- **MCP gateway:** tool definitions kept separate from what they do; HTTP + stdio; write tools
  behind an admin token. T1 already has `t1_*` tools; add a `fleet_summary`-style "start here"
  tool and a firmware-version breakdown.
- **Emulator + load simulator:** `sim-device.py` exists; add an N-board load simulator before
  claiming any fleet size.

---

# Deliberately NOT carried over

| From the other project | Why T1 doesn't take it |
|---|---|
| Sensors, actuators, relays, PWM, state modes, edge-inference models | That client's product. A DNS filter has no outputs to drive |
| An MCP server **on the board** | It adds attack surface to a security device. T1 stays a thin client and MCP lives on the Ionity server (TIERING-PLAN) |
| A third-party metrics service on every reading | Breaks *"almost nothing leaves the LAN"* (Play data-safety, POPIA). Counters stay on the Ionity server |
| An MQTT broker | Not needed at household scale with a 60 s report. Revisit only if the T1 fleet outgrows HTTP — measure first |
| Their lab addresses, client sites, tokens, network names | Client data. Never copied |

---

# Before T1 is sold (combined checklist)

- [ ] Patterns 1–3: one image, NVS provisioning, per-device tokens
- [ ] Pattern 5: signed OTA with rollback
- [ ] Secure boot + flash encryption (so a board can't be read out or reflashed with someone else's firmware)
- [ ] Bench numbers measured: queries per second, added latency, Wi-Fi robustness (T1 README)
- [ ] DNS over TCP, response cache, DoT upstream (T1 README "not done yet")
- [ ] Load simulator run at the target fleet size
- [ ] Privacy: counters only by default; raw logs only on explicit consent (TIERING-PLAN)

**Suggested order:** 1 → 2 → 3 → 4 (CLI first, web page second) → 6 → 5 → 7. Provisioning
first because every later step assumes a board can be pointed at a network without a rebuild.
