```
========================================================================================
GATE^FLAME — ESP32 / LAB PARTS INVENTORY (for later models)
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-024-ESP32 | Version: 1.0 | Updated: 2026-09-24 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# ESP32 / Lab parts inventory for later Gate^Flame models

**Status:** this is a catalogue only. Nothing here is being built into Gate^Flame now.
The three repos stay as they are, read-only from Gate^Flame's side. None were edited,
committed or pushed while this was written.

**Scope:** three sibling repos, read on 2026-09-24:

| Repo | Local path | Remote | One line |
|---|---|---|---|
| ESP32-MCP | `E:\.ESP32-MCP` | github.com/dennisGIonity/Esp32-MCP | Fleet server, MCP gateway, dashboard and ESP32/Pico firmware, plus a logging LAN DNS forwarder |
| Ionity-ESP32-Reporter | `E:\.Ionity-ESP32-Reporter` | github.com/dennisGIonity/Ionity-ESP32-Reporter | The Kelvin Drive "RouterProject" network sentinel (MikroTik CRS326), with an MCP server and an ESP32-S3 sentinel sketch |
| Ionity-Lab | `E:\.IONITY-LAB` | github.com/dennisGIonity/Ionity-Lab (private) | The isolated IoT bench: H3C lab router, shared MQTT broker, laptop dual-network scripts, Pi 5 Gate^Flame pause/resume |

**How "later models" is read here.** "Zero" means the Orange Pi Zero 2W-class base in
`docs/BASE-MODEL-DIRECTIVE.md`. "Cubie A7A" means the Cubie A7A-6GB that the BOM actually
prices (see `CLAUDE.md`, and `docs/STATUS-2026-09-13.md` item 15). "Pico" and "ESP32-lite"
mean microcontroller-class companions. "Fleet console" means `E:\Gateflame\fleet`, which is
the billable surface.

**A physical limit that shapes the whole table:** an ESP32 or a Pico cannot *be* the
Gate^Flame filter. The live blocklist is 3,081,748 domains (CLAUDE.md). An ESP32-S3 has at
most a few MB of PSRAM, and the RP2350 has 520 KB of SRAM. So on the MCU tiers these parts
can only build a **companion** device: a status display, a mains/load-shedding sensor, an
identify LED, or a health reporter. They cannot be a resolver. That conclusion is my
engineering judgement from the numbers. No repo says it.

---

## 1. ESP32-MCP (`E:\.ESP32-MCP`)

### Purpose
The design goal is "one binary on the device, one server for the fleet, one MCP endpoint for
the AI", scaling to 1000+ ESP32 nodes (`README.md`). The lab has three live boards:
2x ESP32-S3 over MQTT and 1x Pico 2 over a USB serial bridge (`docs/LAB.md`).

### Architecture (`docs/ARCHITECTURE.md`, `server/app/`)

| Component | File | What it does |
|---|---|---|
| FastAPI app, lifespan, WS broadcaster | `server/app/main.py` | Wires store, registry, MQTT, DNS, mDNS and MCP. Pushes a dashboard frame every 2 s |
| Settings | `server/app/config.py` | `IONITY_*` env via pydantic-settings. Port 8099 |
| MQTT bridge | `server/app/ingest/mqtt_bridge.py` | paho-mqtt on its own thread with `call_soon_threadsafe`. Replaced aiomqtt because the Windows Proactor loop lacks `add_reader()` |
| mDNS advert | `server/app/ingest/discovery.py` | Advertises `ionity-fleet.local` and `_ionity-fleet._tcp.local.` with TXT `path/mcp/mqtt/fleet` (zeroconf) |
| Logging DNS forwarder | `server/app/ingest/dns_resolver.py` | Pure-stdlib asyncio UDP/53 forwarder with a TTL cache (15 s–1 h clamp) and SERVFAIL on upstream failure. ARP-based LAN naming with a small OUI table |
| Fleet registry and alerts | `server/app/fleet/registry.py` | Hot state in RAM. A queue is drained in batches of 200 per commit. Server-side thresholds (`_evaluate_alerts`, line 154) |
| Storage | `server/app/storage/{base,sqlite_store,dns_mixin}.py` | `Store` interface with a SQLite driver. `telemetry_metric` narrow table. DNS tables `dns_queries` and `lan_devices` |
| MCP JSON-RPC | `server/app/mcp/{server,tools}.py` | `initialize`, `tools/*`, `resources/*`, `ping`, batch |
| stdio bridge | `server/mcp_stdio_proxy.py` | Answers `initialize` and `tools/list` locally so the client survives a dead backend. Forwards calls. Autostarts `scripts/start_lab.ps1` |
| Dashboard | `dashboard/{index.html,app.js,style.css}` | Static SPA at `/` |
| Serial bridge | `scripts/serial_bridge.py` | Forwards `TLM {json}` lines from RP2040/RP2350 USB ports (VID 0x2E8A) to HTTP ingest |
| Simulator / purge | `scripts/fleet_simulator.py`, `scripts/purge_devices.py` | Fake N devices (`transport:"sim"`), and cleanup |
| Flasher | `scripts/add_device.ps1` | Detects the chip with esptool, compiles, flashes, then waits for a *fresh* reading before tagging |
| Infra | `docker-compose.yml`, `infra/Dockerfile`, `infra/mosquitto/config/mosquitto.conf` | Mosquitto 1883/9001 and the server on 8099 |

**Ports:** HTTP/WS/MCP 8099; MQTT 1883 (plus 9001 WebSockets under Docker); DNS 53/udp;
mDNS 5353.

**MQTT topics** (`docs/TELEMETRY-SCHEMA.md`, `mqtt_bridge.py`):
```
ionity/<site>/<device_id>/telemetry    device->server  QoS0
ionity/<site>/<device_id>/status       device->server  QoS1 retained + LWT
ionity/<site>/<device_id>/cmd          server->device  QoS1
ionity/<site>/<device_id>/cmd/result   device->server  QoS1
ionity/broadcast/cmd                   server->all     QoS1
```

**HTTP routes** (`server/app/api/routes.py`): `POST /api/v1/telemetry` (up to 500 per batch,
`X-Fleet-Token` header), `POST /api/v1/devices/register`, `GET /api/v1/fleet/summary`,
`GET /api/v1/devices`, `GET /api/v1/devices/{id}`, `POST /api/v1/devices/{id}/cmd`,
`GET /api/v1/telemetry/query`, `GET /api/v1/telemetry/aggregate`, `GET /api/v1/alerts`,
`GET /api/v1/dns/{summary,devices,domains,recent,search}`, `GET /api/v1/lan/devices`,
`POST /api/v1/mcp/rpc`, `GET /api/v1/health`, `WS /ws/fleet`.

**MCP tools (13)** (`docs/MCP-SERVER.md`, `server/app/mcp/tools.py`). Server identity is
`ionity-esp32-fleet-mcp` v1.0.0, protocol `2024-11-05`.
- Fleet: `fleet_summary`, `list_devices`, `get_device`, `query_telemetry`, `aggregate_metric`,
  `get_alerts`, `send_command` (reboot / identify / ping / set_meta, per device or broadcast).
- LAN DNS: `dns_summary`, `dns_by_device`, `dns_top_domains`, `dns_search`, `dns_recent`,
  `list_lan_devices`.
- Resources: `ionity://fleet/summary`, `ionity://fleet/devices`, `ionity://fleet/schema`.

### Hardware targets

| Target | Evidence | Notes |
|---|---|---|
| ESP32-S3, 16 MB flash, CH340 (COM8, `esp32-98a316e5d18c`) | `firmware-arduino/Esp32_MCP_Node/sketch.yaml`, `docs/LAB.md` | FQBN `esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=min_spiffs`. Core esp32 3.3.11 |
| ESP32-S3, native USB-Serial-JTAG (COM10, `esp32-fc012cd8ea14`) | `docs/LAB.md` | Needs `esptool --before usb-reset`, not DTR/RTS |
| ESP32 classic (WROOM-32), ESP32-C3 | `firmware/platformio.ini`, `sketch.yaml` profiles | Pin maps in `config.h` |
| Raspberry Pi Pico 2 (RP2350), no radio | `firmware-arduino/Pico_MCP_Node/` | Reports over USB serial via the bridge. Profiles for pico / picow / pico2 / pico2w |
| I2C OLED (SSD1306 default, SH1106 option) at 0x3C/0x3D | `firmware-arduino/Esp32_MCP_Node/Oled.ino` | Auto-scans pin pairs (5/6, 17/18, 8/9 …), skips USB/flash/UART0/strap pins, caches the result in NVS, and can be set remotely with `set_display`. **None found** on either S3 (`docs/HANDOFF.md`) |
| PlatformIO S3 env | `firmware/platformio.ini` | `esp32-s3-devkitc-1`, `default_8MB.csv`, plus an OTA env |

### Firmware versions
- `firmware-arduino/Esp32_MCP_Node`: **1.1.0** (`config.h` line 15; OLED auto-detect and
  `set_display`). The file header still says "Version 1.0.0" (`Esp32_MCP_Node.ino` line 2).
- `firmware-arduino/Pico_MCP_Node`: **1.0.0**.
- `firmware/` (PlatformIO): **1.0.0**, stale (see known issues).

### Telemetry schema (`docs/TELEMETRY-SCHEMA.md`)
The fields are `device_id` (the only required one), `site`, `group`, `label`, `fw`,
`product`, `uptime_s`, `seq`, an open `metrics{}` map, and `net{ip, transport}`. `transport`
is one of `mqtt|http|serial|sim` (`server/app/models.py:15`). Numeric and boolean metrics also
go into `telemetry_metric`. The reserved alert metrics are `temp_c` (>80), `rssi_dbm` (<-85),
`packet_loss_pct` (>20) and `free_heap_bytes` (<20000). Health states are
`online | alerting | stale (45 s) | offline (135 s or LWT)`. Payloads must stay under 1 KB.

### Provisioning (`docs/DEVICE-PROVISIONING.md`)
1. Build once with per-batch `secrets.h`.
2. Flash with esptool, or `add_device.ps1`.
3. The node self-registers on its first reading.
4. Press Identify, then `set_meta` writes site/group/label to NVS and reboots.
5. Updates after that go over OTA (espota), rolled out in stages of 1, 10, 100, then the rest.

`device_id` comes from the eFuse MAC (`esp32-aabbccddeeff`) or the RP2350 chip ID
(`pico-<id>`). The server is found in this order: NVS `server_ip`, then mDNS `ionity-fleet`,
then the compiled fallback `192.168.0.3`. It re-resolves after 5 failed sends
(`firmware-arduino/Esp32_MCP_Node/config.h`).

### Done / stubbed / planned
- **Done (Phase 0, v1.0.0, 2026-09-21, `docs/ROADMAP.md`):** one-binary firmware, MQTT with
  HTTP fallback, LWT, 40-slot buffer, OTA, registry, batched writer, alerts, MCP, dashboard,
  simulator. Also, from `docs/HANDOFF.md` 2026-09-23: fw 1.1.0 on both S3s, the OLED scan,
  and the lab moved out to Ionity-Lab.
- **Stubbed:** a filtering resolver. The `blocked` column exists and is always 0
  (`dns_mixin.py`, `dns_resolver.py:_record`). `TimescaleStore` is interface only
  (`storage/base.py`). `POST /devices/register` returns a hard-coded 10000 ms interval.
- **Planned:** Phase 1 hardening (MQTT TLS 8883, `IONITY_REQUIRE_TOKEN=true`, dashboard
  auth, signed OTA, pytest coverage, NSSM service). Phase 2 scale (Timescale, rollups).
  Phase 3: **Eskom load-shedding enrichment** lifted from RouterProject, groups as objects,
  alert routing, a `get_device_logs` tool, staged OTA orchestration. Phase 4: anomaly
  detection and an `explain_fleet_change` tool.
- **Handoff open items:** laptop NIC metrics and firewall rules for the lab, the H3C DHCP
  reservation, reflashing ESPs onto the H3C WiFi, moving the Pi 5 to the H3C, and finding
  the OLED board.

### Tests
`server/tests/test_fleet.py` has 5 async smoke tests: ingest/summary, open metrics stored,
alert raise/clear, health windows, MCP dispatch. HANDOFF records "tests 5/5". There are no
DNS resolver tests and no firmware tests.

### Known issues (observed in code/docs)
1. **The PlatformIO firmware is stale.** `firmware/include/config.h` still compiles
   `SERVER_HOST "192.168.2.11"` and has no mDNS lookup (`firmware/src/main.cpp:317`). LAB.md
   lesson 1 ("never compile the server's IP into a board") is only implemented in the
   Arduino build.
2. **Doc drift.** `README.md` says "Seven tools". `docs/MCP-SERVER.md` and the code say 13.
3. **`server/requirements.txt` lists `aiomqtt`, not `paho-mqtt`,** but the bridge imports
   `paho.mqtt.client`. It only works because aiomqtt pulls paho in transitively.
4. **The ARP naming loop is Windows-only.** It runs `arp -a` with a regex that expects
   `IP  MAC` columns (`dns_resolver.py:_refresh_arp`). Linux `arp -a` prints `(ip) at mac`,
   so on a Pi/Cubie the LAN list would get no MACs.
5. **Security defaults are bench-only:** anonymous MQTT (`mosquitto.conf`
   `allow_anonymous true`), `require_token=false`, and a default fleet token literal in
   `config.py`, `.env.example` and `scripts/serial_bridge.py`. `set_meta` and `set_display`
   are therefore open to anyone on the LAN who can reach the broker.
6. `config/device_labels.json` is **tracked** and holds household MAC-to-label entries
   (the Pi's eth0/wlan0, the Afrihost router).
7. There is no `.gitattributes`. `.gitignore` excludes `*.bin`/`*.elf`, and no binaries are
   tracked (checked with `git ls-files`), but nothing guards the class.

### Git state (2026-09-24)
Branch `main` tracks `origin/main` at `92c003c`, which matches `git ls-remote`
(`92c003ce…`). The working tree is clean. `git log --branches --not --remotes` is empty, so
nothing is unpushed. The last commits are all by `DennisIonity`, dated 2026-09-22/23
(`92c003c` "Lab moved to its own project Ionity-Lab", `62c484f`, `57b7e9f`, `f88373a`
"Dashboard v2", `78f2bea` "fw 1.1.0").

---

## 2. Ionity-ESP32-Reporter (`E:\.Ionity-ESP32-Reporter`)

### Purpose
This is the "Kelvin Drive Edge Network Sentinel & AI MCP Gateway" for a MikroTik
CRS326-24G-2S+ office site (`README.md`). It is deployed out-of-band on a mirror/management
port. **Its working tree is byte-identical to `E:\.ESP32-MCP\_reference\router-project`**:
`git diff --no-index --stat` shows only the `.git` directory as different. ESP32-MCP's
`docs/REUSE-AUDIT.md` is therefore the line-by-line audit of this repo too.

### Architecture
- `api/main.py`: FastAPI on **:8000**, with a lifespan that builds the engines and a WS
  telemetry broadcaster. `api/routes.py` has routes under `/api`: `telemetry/{live,
  stability, traffic, speedtest, speedtest/run, loadshedding, security, hardware-feed}` and
  `mcp/rpc`.
- `core/`: `probe_engine.py` (TCP-connect RTT to port 53, rolling jitter and loss),
  `traffic_analyzer.py` (stability score 0–100), `loadshedding.py` (EskomSePush
  `business/2.0` `/area?id=`, 900 s cache, plus `correlate_link_issue()` to tell mains loss
  from a fibre cut from congestion), `mikrotik_collector.py` (RouterOS REST/SNMP),
  `security_analyzer.py` (firewall-drop parsing), `speedtest_engine.py`.
- `mcp/mcp_server.py` and `mcp/tools_and_resources.py`: JSON-RPC over HTTP and stdio. The 6
  tools are `get_link_stability`, `get_traffic_feed`, `run_speedtest`,
  `get_loadshedding_status`, `get_security_alerts` and `get_network_datasheet`.
- `dashboard/`: a glassmorphic SPA (Chart.js).
- `config/config.yaml`: Kelvin Drive topology (WANs, VLANs, floors). `config/.env.example`
  key names: `ESKOM_API_KEY`, `MIKROTIK_HOST`, `MIKROTIK_USER`, `MIKROTIK_PASSWORD`,
  `MIKROTIK_SNMP_COMMUNITY`, `SENTINEL_PORT`, `SENTINEL_HOST`, `MCP_SERVER_PORT`,
  `IPINFO_TOKEN`.

### Hardware targets (`hardware/HARDWARE_DEPLOYMENT_GUIDE.md`, `hardware/esp32_sentinel/`)
The main target is an ESP32-S3 CoreBoard with an optional **W5500 SPI Ethernet** (CS 10,
MOSI 11, MISO 12, SCK 13, INT 14). It also has an **optocoupled 230 V mains sense on
GPIO 4** (HIGH = mains OK), an **SSD1306 0.96" OLED on I2C SDA 5 / SCL 6**, LEDs on GPIO 7/8,
and a buzzer/relay on GPIO 9. Linux gateway alternatives are the NanoPi R2S/R4S, a CM4, or a
mini PC. The sketch uses `ESP32Ping` and a hard-coded `SENTINEL_DEVICE_ID`
(`config.h:9`). No firmware version constant is present.

### Telemetry
The sketch POSTs a fixed `ProbeMetrics` struct (per-target latency, jitter, loss, stability
score, `mains_power_ok`, uptime, heap, chip temperature) to `/api/telemetry/hardware-feed`
every 3 s (REUSE-AUDIT). The server uses only `mains_power_ok` and `stability_score`
(`api/routes.py`).

### Provisioning
Manual: edit `config.h` per unit (WiFi, device ID, optional static IP) and flash. On the
router side, paste the RouterOS commands in the guide to create a read-only API user, SNMP,
traffic-flow and port mirror.

### Done / stubbed
There is no roadmap in the repo. **Most data paths fall back to invented values when the
real source is missing:**
- `probe_engine.py` returns `random.uniform(7.5, 14.5)` ms on a failed connect, and a random
  jitter.
- `mikrotik_collector.py:_generate_synthetic_telemetry` runs when `simulate_if_offline: true`.
- `security_analyzer.py:_init_mock_threats` and `simulate_random_threat` invent threats.
- `speedtest_engine.py` uses random speeds.
- `loadshedding.py:_generate_mock_status` runs when there is no API key
  (`mock_if_no_key: true`).

### Tests
`tests/test_{loadshedding,mcp_server,security_analyzer,traffic_analyzer}.py` (unittest style,
running against mocks).

### Known issues
- **Credential-looking literals are tracked.** A MikroTik read-only password appears in
  `README.md`, `hardware/HARDWARE_DEPLOYMENT_GUIDE.md`, `config/config.yaml` and
  `config/.env.example`, and there is an SNMP community `public`. REUSE-AUDIT already says
  to rotate these on the Kelvin Drive router. The values are not repeated here.
- The sketch sets a **static secondary DNS** (`STATIC_SECONDARY_DNS`,
  `esp32_sentinel.ino` `connectNetwork()`). This is harmless on a probe, but it is the
  pattern Gate^Flame forbids.
- README links point to `file:///e:/.RouterProject/...`, a path that no longer matches this
  clone.

### Git state (2026-09-24)
Branch `main` tracks `origin/main` at `e61594c` "Untrack pycache files" (2026-08-28). The
tree is clean and nothing is unpushed. The history has two identities: `dennisGIonity` (5
commits) and `Dennis Grobler` ("Add files via upload", the GitHub web UI). Both are Dennis,
per CLAUDE.md.

---

## 3. Ionity-Lab (`E:\.IONITY-LAB`)

### Purpose
The "isolated IoT test lab next to household internet: one setup shared by every Ionity
hardware project" (`README.md`). It owns the network, the laptop's dual-network setup, the
shared MQTT broker, the Pi 5 tools and the bench health check. Projects register in
`lab.json` under `projects` (currently only ESP32-MCP).

### Architecture and addresses (`lab.json`, `README.md`)

| Thing | Value |
|---|---|
| Household | TP-Link EX511 (Afrihost) `192.168.0.1`. 2.4 GHz ch 1/20 MHz/High, 5 GHz ch 36. Rule: internet only, **no lab DNS** |
| Lab router | H3C Magic `192.168.124.1`, subnet `192.168.124.0/24` |
| Lab WiFi | `IONITY-LAB` 5 GHz ch 149 (Pi 5, laptops, ESP32-C5). `IONITY-LAB-IOT` 2.4 GHz ch 11/20 MHz/**Low** (2.4-only S3 / Pico 2 W) |
| Laptop | Ethernet to an H3C **LAN** port, reserved `192.168.124.4` (MAC in `lab.json`). NIC metrics: household 10, lab 200 |
| Broker | `broker/run_broker.py`: amqtt MQTT 3.1.1, `0.0.0.0:1883`, anonymous, QoS 0/1, retained, LWT, its own `.venv` |
| Ports | mqtt 1883, http 8099, dns 53, mdns 5353 |
| Pi 5 | user `wabapi`, addresses tried in order `192.168.124.3`, `192.168.0.11`, `192.168.0.10`. Dashboard URL `http://ionity-fleet.local:8099/`, fallback `http://192.168.124.4:8099/` |

### Scripts
- `lab.ps1`: `start | restart | broker | stop | status | setup`. `START-LAB.cmd` wraps it.
- `network/setup_lab_network.ps1` (admin): WiFi carries internet, the cable is lab-only, the
  lab profile is Private, and firewall rules scope ports to `192.168.124.0/24`. It also
  demotes any adapter still holding lab DNS. Supports `-Undo`.
- `network/set_lab_wifi.ps1`: hidden password prompt that writes each project's git-ignored
  `secrets.h`.
- `network/lab_status.ps1`: one-look health check.
- `pi/gateflame-pause.sh` / `gateflame-resume.sh`: **reversible** pause. It discovers
  `gateflame*` units and containers instead of trusting a list, records prior
  enabled/active/restart-policy state in `/var/lib/ionity-lab/gateflame-paused.state`, moves
  the avahi service and cron files aside, and supports `--dry-run`. Resume restores
  containers before units.
- `pi/pi-gateflame.sh`: drives the above from Git-bash with `SSH_AUTH_SOCK` set. It never
  handles a secret itself; Dennis types the passphrase and the sudo password.
- `pi/lab-display-setup.sh` / `lab-display-remove.sh`: EDID detection, then an XDG autostart
  entry on the Pi OS desktop or a `cage` + Chromium systemd kiosk on Lite. It stops on
  DisplayLink rather than accepting a vendor EULA.
- `arduino/*.boards.local.txt`: makes S3 (CH340 1a86:7523, native 303a:1001) and Pico 2
  identify correctly in the IDE.
- `.gitattributes`: `*.sh eol=lf`, `*.ps1/*.cmd eol=crlf` (plus `pi/.gitattributes`).

### Tests
None.

### Known issues
- `lab.json` → ESP32-MCP env sets `IONITY_DNS_BIND={server_ip}`, which means the ESP32-MCP
  logging DNS listens on `192.168.124.4:53` in the lab. That is fine inside the lab, but see
  contradiction C3.
- There is a stale `data/broker_err.txt` in the tree. It is git-ignored under `data/`.

### Git state (2026-09-24): ⚠ possibly unpushed
Branch `main` has **no upstream configured** (`git status -sb` shows `## main` with no
tracking branch), and **no remote-tracking refs exist**. So
`git log --branches --not --remotes` lists all 3 commits, all by `DennisIonity` on
2026-09-23: `45bc98c`, `5eaaadc`, `7e51de7`. The repo is private, so an anonymous
`git ls-remote` returns "Repository not found", which settles nothing. **Verify from Git-bash
with `git push --dry-run origin main`, then push with `-u`.** This session did not push,
because these repos are read-only for this task.

---

## 4. Parts bin for later Gate^Flame models

Effort: **S** = lift and adapt in under a day, **M** = a few days with tests, **L** = a
redesign. The last column checks each part against Gate^Flame's decided rules.

| # | Part (path) | What it does | Fits | Effort | Conflicts with Gate^Flame rules |
|---|---|---|---|---|---|
| 1 | `E:\.ESP32-MCP\firmware-arduino\Esp32_MCP_Node\Oled.ino` | I2C OLED auto-detect (pin-pair scan, safe-pin exclusion, Heltec Vext handling, NVS cache, SSD1306/SH1106, remote `set_display`) | ESP32-lite companion; the idea also fits a Cubie/Zero front-panel status screen | S | None, **as long as the screen shows only what the node reports** (protectionStatus mapped `active→PROTECTED`, etc.). It must never show its own "safe" copy |
| 2 | `Esp32_MCP_Node.ino` identity + NVS pattern (eFuse-MAC `device_id`, `set_meta` → NVS → reboot) | One binary for N units, with per-unit metadata set after flashing | ESP32-lite, Pico (chip-ID variant in `Pico_MCP_Node.ino`) | S | None. Gate^Flame has its own node identity (`GF-…`), so do not introduce a second ID scheme on the box itself |
| 3 | Server discovery chain (NVS override → mDNS `ionity-fleet.local` → fallback, re-resolve after 5 fails) in `Esp32_MCP_Node/config.h` and `.ino`; advert in `server/app/ingest/discovery.py` | Survives a subnet change without reflashing | Any companion finding the box. The Zero/Cubie box already advertises `gateflame.local` (`gateflame-mdns-alias.service`) | S | None. This is the lesson Gate^Flame learned the hard way (the LAN moved to `192.168.124.x`) |
| 4 | MQTT contract + LWT (`docs/TELEMETRY-SCHEMA.md`, `mqtt_bridge.py`) | Persistent connection, retained status, offline in about 90 s with no polling | Fleet console *if* nodes ever report over MQTT; ESP32-lite reporting to the box | M | Gate^Flame's feed is HTTP check-in (`node-agent/gateflame/health_feed.py` → `fleet/app.py`). Adding MQTT is a second transport to secure (TLS, credentials). **Anonymous broker defaults must not ship** |
| 5 | Hot registry + batched writer + health windows (`server/app/fleet/registry.py`) | O(1) ingest, 1 commit/s, online/stale/offline | Fleet console at hundreds to thousands of boxes | M | Overlaps `E:\Gateflame\fleet\app.py` (its own SQLite `nodes/samples/samples_hourly`). Adopt the *pattern* (queue + batch) if the console hits write contention; do not run two fleet servers |
| 6 | Server-side alert engine (`registry.py:_evaluate_alerts`) | Change thresholds without reflashing | Fleet console | S | Must alert only on fields the node actually sends. No threshold may invent a status the node did not report |
| 7 | MCP gateway + stdio bridge (`server/app/mcp/*`, `server/mcp_stdio_proxy.py`) | One MCP endpoint over the whole fleet; survives a dead backend | Fleet console (support tooling for Ionity staff, not customers) | M | Keep it on the staff side. IoniBot is scoped as a **deterministic question menu, not live AI** (CLAUDE.md), so this must not become the customer chatbot. Must enforce fleet auth first; it has none today |
| 8 | `E:\.Ionity-ESP32-Reporter\core\loadshedding.py` (`get_loadshedding_status`, `correlate_link_issue`) | EskomSePush area status, and root-cause triage: mains loss vs area load shedding vs fibre break vs congestion | Fleet console (explains "box offline" vs "area on stage N"); Cubie/Zero local health | M | **`_generate_mock_status` must be deleted, not configured off.** With no key it invents a stage, which breaks "no invented data". Kelvin Drive strings are hard-coded in messages and must go. Also needs an API key (never in chat or git) |
| 9 | Mains-sense hardware: optocoupled 230 V on GPIO 4 (`hardware/HARDWARE_DEPLOYMENT_GUIDE.md`, `esp32_sentinel.ino`) | Measured on-site power loss, not inferred | Cubie A7A premium (GPIO) or an ESP32-lite companion; directly serves ADR-001's load-shedding rationale | M (hardware + safety) | None in principle. **230 V work needs a certified isolated module**; this is a hardware-safety note, not a code one |
| 10 | Probe engine TCP-connect RTT/jitter/loss (`Reporter\core\probe_engine.py`) | Link quality without ICMP privileges | Cubie/Zero local health; fleet console | S | **Remove the `random.uniform` fallbacks** (failed connect → invented 7.5–14.5 ms). A failed probe must read as a failure, and "cannot reach" must never share a sentence with "reached, nothing there" |
| 11 | USB serial bridge (`E:\.ESP32-MCP\scripts\serial_bridge.py`) + Pico `TLM {json}` lines | Lets a radio-less Pico report through a host | Pico companion plugged into the box's USB | S | Tags `transport:"serial"` honestly (good). Hard-codes the default fleet token. Labels come from a JSON file keyed by device ID |
| 12 | LAN device list: ARP + OUI + labels (`dns_resolver.py:_refresh_arp`, `oui_vendor`, `storage/dns_mixin.py:lan_devices`) | Who is on the network: IP, MAC, vendor, label | **Already exists in Gate^Flame**: `node-agent/gateflame/clients.py` (`ip neigh`, dedup across dual-homing, filters docker bridges and link-local) and `device_names.py` (OUI, randomised-MAC detection) | none, do not adopt | Gate^Flame's version is more correct on Linux (ESP32-MCP's is Windows `arp -a` only, and does not dedup dual-homed rows or skip docker bridges). At most, cross-check the two OUI tables |
| 13 | Logging DNS forwarder (`server/app/ingest/dns_resolver.py`) | A stdlib UDP forwarder with a TTL cache | Nothing on the product. It would duplicate Pi-hole + Unbound | none, do not adopt | **Conflicts on three rules**, see C1–C2. It logs per-client-IP query history (`dns_by_device`, `dns_search`), which is exactly the per-device history Dennis does not want. It is designed for devices pointed at it directly, which ADR-001 forbids |
| 14 | `E:\.IONITY-LAB\pi\gateflame-pause.sh` / `gateflame-resume.sh` | Reversible, state-recorded disable/enable of every `gateflame*` unit and container | Gate^Flame ops/dev tooling on any box (Pi 5 today, Cubie/Zero later) | S | None. It discovers the real names, which avoids the name-guessing trap in CLAUDE.md. It already uses the correct `gateflame-pihole` / `gateflame-unbound` names. It should live in `E:\Gateflame\tools\` if adopted (rule 6), not be copied loose |
| 15 | `pi/lab-display-setup.sh` EDID detect + desktop-vs-Lite branch (autostart or `cage`+Chromium) | Detects which screen is attached and picks the right kiosk method | The kiosk on Cubie/Zero ("the product IS the kiosk") | S–M | Overlaps `gateflame-kiosk.service`. Worth lifting only the EDID/desktop-detection logic, not a second kiosk unit |
| 16 | `lab.json` + `lab.ps1` project registry | One place that defines the bench | Gate^Flame dev bench | S | None. Keep it a lab, not a product dependency |
| 17 | `add_device.ps1` "wait for a *fresh* reading after reset" | Proves a flash worked by read-back, not by a stale row | ESP32-lite / Pico production jig | S | None. It embodies "never claim success without a read-back" |
| 18 | ESP32-S3 + W5500 SPI Ethernet pin map (Reporter guide) | Wired reporting for an MCU node | ESP32-lite companion that must not depend on WiFi | M | None |

### Parts deliberately left out
- `Reporter\core\mikrotik_collector.py`, `security_analyzer.py`, `speedtest_engine.py`,
  `traffic_analyzer.py`: site-specific to the MikroTik, and saturated with synthetic
  fallbacks. The only possible later use is a premium-tier MikroTik site module, and that
  would need its random paths removed first.
- ESP32-MCP `firmware/` (PlatformIO): superseded by `firmware-arduino/` and still compiles
  an IP. Take nothing from it except the `esp32c3` / `esp32dev` env stanzas.

---

## 5. Overlaps with Gate^Flame's own code

| ESP32 / lab part | Gate^Flame equivalent | Relationship |
|---|---|---|
| ESP32-MCP fleet server `:8099`, `GET /api/v1/fleet/summary`, `/api/v1/devices` | `E:\Gateflame\fleet\app.py`: `POST /api/v1/nodes/{id}/health`, `GET /api/v1/nodes`, `GET /api/v1/fleet/summary`, `/nodes/{id}/history`, `/admin`, `/notes` | **Same URL shape (`/api/v1/fleet/summary`), different products.** Gate^Flame's console is the billable surface and refuses to start without a token and an admin password (`fleet/README.md`). ESP32-MCP's has no auth by default. Do not merge them; lift patterns only |
| ESP32-MCP `lan_devices` + `dns_queries` | `node-agent/gateflame/clients.py`, `device_names.py`; Pi-hole query log | Gate^Flame already has the device **list**, and deliberately stops there (ADR-001, CLAUDE.md) |
| ESP32-MCP `DnsService` on :53 | `install-dns-stack.sh` → `gateflame-pihole` + `gateflame-unbound`; `dns-watchdog.sh` | Duplicate function, opposite deployment model (see C2) |
| ESP32-MCP mDNS `ionity-fleet.local` | `gateflame-mdns-alias.service` (`gateflame.local`) | Parallel. A companion would resolve `gateflame.local` |
| Ionity-Lab kiosk (`cage`+Chromium) | `gateflame-kiosk.service` | Parallel; see part 15 |
| Reporter `loadshedding.py` | No Gate^Flame equivalent (ADR-001 cites load shedding as the design driver but nothing measures it) | **Gap**: this is the one genuinely new capability |

---

## 6. Contradictions and risks

**C1. Per-device DNS history.** ESP32-MCP's headline feature is `dns_by_device`, "what's
going to what device" (`docs/LAN-DNS-VISIBILITY.md`, `docs/MCP-SERVER.md`). Gate^Flame has
decided against it: "Per-device history is not wanted. A device LIST is" (CLAUDE.md), and
the fleet feed carries "no domains, no client IPs, no hostnames" (`fleet/README.md`). If any
ESP32-MCP DNS code reaches a Gate^Flame model, it violates both.

**C2. Devices pointed straight at the resolver, and an optional secondary.**
`docs/LAN-DNS-VISIBILITY.md` tells the user to set the router's DHCP *Primary DNS handed to
clients* to the server. That is the model ADR-001 rejected on load-shedding grounds. The
same doc offers to "keep a secondary DNS and accept partial data", which contradicts "No
secondary DNS. Ever." It also concedes the host becomes a single point of failure, which is
exactly ADR-001's reason.

**C3. Lab DNS on the household router.** `E:\.ESP32-MCP\docs\LAB.md` "Still open" lists
"Router DHCP → DNS `192.168.0.3`". That is the household TP-Link, the same router
Gate^Flame's box serves. `E:\.IONITY-LAB\README.md` rule 1 forbids exactly this ("no lab
DNS … on the household network"). **Ionity-Lab is newer and right; the ESP32-MCP line is
stale and should not be actioned.** Doing it would put two resolvers in contention for
the household.

**C4. Invented data.** Ionity-ESP32-Reporter fabricates latency, jitter, threats, speed and
load-shedding stage whenever a source is missing (section 2). This directly breaks "no
honest-looking screen showing invented data". Any lifted module must have those paths
removed and pinned by a test that fails if they come back (CLAUDE.md: "tests are the
pinning mechanism").

**C5. Stale compiled IP.** ESP32-MCP `firmware/include/config.h` compiles `192.168.2.11`,
against its own documented lesson.

**C6. Identity in headers.** ESP32-MCP and Ionity-Lab document headers name Johan Wilhelm
van Antwerp as author. That is the template, as CLAUDE.md explains. The git history of all
three repos is Dennis only (`DennisIonity`, `dennisGIonity`, `Dennis Grobler`). **No foreign
git identity was found.**

**C7. Security carry-overs.** Anonymous MQTT (the lab broker and the Mosquitto config), the
default fleet token literal in three ESP32-MCP files, a MikroTik password literal in four
tracked Reporter files, and household MACs in a tracked `config/device_labels.json`. None of
this may be copied into Gate^Flame as-is. CLAUDE.md records a previously leaked key.

**C8. Rules that do not apply.** The Pi-hole v6 `X-FTL-SID` header rule does not apply,
because none of the three repos talk to Pi-hole. On binaries: no binaries are tracked in
ESP32-MCP or Reporter, but neither has a `.gitattributes`. Ionity-Lab has one, for line
endings only. Before any firmware image (`.bin`/`.uf2`) is ever committed for a later model,
it must go under Gate^Flame's existing `.gitattributes` and CI magic-byte gate. Never route
it through a text path.

---

## 7. Unpushed work
- **Ionity-Lab: 3 commits possibly unpushed** (`7e51de7`, `5eaaadc`, `45bc98c`). There is
  no upstream and there are no remote-tracking refs. Verify with `git push --dry-run` from
  Git-bash.
- ESP32-MCP: none (`92c003c` = origin).
- Ionity-ESP32-Reporter: none (`e61594c` = origin).
