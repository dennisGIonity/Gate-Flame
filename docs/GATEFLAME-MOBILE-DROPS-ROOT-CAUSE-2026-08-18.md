```
========================================================================================
GATE^FLAME — MOBILE DISCONNECTS: ROOT CAUSE, FIXES, AND FULL FEATURE STATUS
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-018-RCA | Version: 1.0 | Updated: 2026-08-18 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

Everything in this document was **measured on the live network on 2026-08-18**,
not read from a commit message or an earlier document. Where something could not
be measured, it says so.

---

# 1 — THE HEADLINE

**The box is not the fault. The network around it is, and nothing in the product
could see that.**

A 240-query soak from a desktop on the same Wi-Fi as the phones, through
`192.168.0.10`, over four minutes:

```
total=240   fails=0   slow=0   avg=51ms
```

Zero failures. Filtering verified working: `doubleclick.net → 0.0.0.0`,
`github.com → real address`. The resolver is healthy and has been the whole time.

Four separate faults were found. Each one on its own reproduces "phones drop,
desktop is fine". Together they explain it completely.

---

# 2 — ROOT CAUSE

## 2.1 🔴 PRIMARY — the router advertises IPv6 that does not work, and names itself as DNS

Measured on this LAN:

| Fact | Value |
|---|---|
| IPv6 prefix advertised | `fd00::/64` — **PrefixOrigin = RouterAdvertisement** |
| IPv6 DNS server advertised (RDNSS) | `fe80::7a20:51ff:fe9f:1e8b` — **that is the router** (MAC `78-20-51-9f-1e-8b` = `192.168.0.1`) |
| IPv6 default route (`::/0`) | **NONE** |
| IPv6 internet reachable | **No** — `2606:4700:4700::1111` port 53 unreachable |
| AAAA records served by the box | **Yes, for everything** — google, facebook, netflix all return AAAA |

This is the phone-killer, and it explains the desktop/phone split exactly:

1. The router hands every device an IPv6 address **and tells it to use the router
   as the IPv6 DNS server**. Android and iOS prefer IPv6. **Your phones have not
   been asking the box anything — they ask the router.** Confirmed: querying the
   router's link-local address returns `doubleclick.net → 192.178.54.14`,
   unfiltered.
2. The phone believes the network is IPv6-capable, so it tries **AAAA first** on
   every connection. There is no IPv6 route to the internet, so every one of
   those attempts stalls until Happy Eyeballs gives up.
3. Android's connectivity validator runs over both families. The IPv6 half keeps
   failing, so the OS marks the Wi-Fi **"Connected, no internet"** and — on
   Samsung in particular — **drops to mobile data and re-associates**.

That is "mobile devices keep losing connection", precisely.

**Why the desktop is immune:** Windows implements the RFC 6724 policy table,
which ranks ULA (`fc00::/7`) **below** IPv4. Windows never prefers the broken
path. Android does not de-prioritise a router-advertised ULA that comes with
RDNSS. This is why every test you have run from the PC has looked perfect.

## 2.2 🔴 The router is not forwarding to the box at all

| Query | Answer | Meaning |
|---|---|---|
| `doubleclick.net` via `192.168.0.10` (the box) | `0.0.0.0` | box is filtering |
| `doubleclick.net` via `192.168.0.1` (the router) | `192.178.54.46` | **router is using its own upstream** |

The network-wide DNS cutover **did not take effect**, whatever the router's web
UI said when you saved it. Every device that takes DNS from DHCP is being handed
the router, and the router is answering from its own resolver. Only devices with
DNS set manually — your PC, which is set to `192.168.0.10` and nothing else — are
actually protected.

## 2.3 🟠 The Pi is dual-homed on one subnet, and DNS answers on only one address

| Address | MAC | Port 8080 (API) | Port 8081 (Pi-hole) | **Port 53 (DNS)** |
|---|---|---|---|---|
| `192.168.0.10` | `88-a2-9e-27-a1-8d` | ✅ | ✅ | ✅ **answers** |
| `192.168.0.13` | `88-a2-9e-27-a1-8f` | ✅ | ✅ | 🔴 **silent — times out** |

Both interfaces (Ethernet and Wi-Fi) are up on `192.168.0.0/24`. `docker-compose`
publishes port 53 on `.10` only. Two consequences:

- **ARP flux.** Linux answers ARP for an address out of whichever interface the
  request arrived on (`arp_ignore` defaults to `0`). A client can ask "who has
  `192.168.0.10`" and be handed the *other* interface's MAC. Phones re-ARP every
  time they sleep, wake or roam; a stationary desktop holds one entry for hours.
  This makes the fault intermittent and per-device — which is what you observed.
- **Discovery can hand out the dead address.** avahi publishes both addresses for
  `gateflame.local`, and the mobile app's first discovery candidate is
  `gateflame.local:8080`. A client can reach the API on `.13` perfectly and have
  no resolver behind it.

## 2.4 🔴 The watchdog could not see any of this

`dns-watchdog.sh` probed `127.0.0.1:53` **and nothing else**. Compose publishes
port 53 on two sockets — loopback and the LAN address — and **they fail
independently**. In every state where the LAN listener is dead and loopback is
alive, the watchdog reported healthy: no restart, no recreate, no bypass, no log
line, and a household with no DNS.

That is why there was nothing in the logs.

---

# 3 — WHAT I FIXED

Branch **`fix/mobile-dns-drops`**, commit **`65dce06`**, on `E:\Gateflame`.
7 files changed, 740 insertions.

| # | File | Fix |
|---|---|---|
| 1 | `node-agent/dns-watchdog.sh` | `dns_answers()` now requires **both** `127.0.0.1:53` **and** the LAN address to answer. A LAN-only failure logs `SILENT OUTAGE` distinctly, because the remedy differs — a restart fixes a dead container, a missing LAN publish needs docker to rebind. |
| 2 | `dns-stack/docker-compose.yml` | Publish address `192.168.0.10` → `${GATEFLAME_LAN_IP}`. It was **hardcoded**: docker cannot bind an address the host does not have, so one DHCP renumber turns every subsequent boot into a total DNS outage until a human edits YAML. |
| 3 | `dns-stack/docker-compose.bypass.yml` | Same fix, and it mattered more here — bypass is the *recovery* path, and it was hardcoded to fail in exactly the scenario it exists to recover from. |
| 4 | `dns-stack/docker-compose.yml` | **Pi-hole rate limiting set to 0.** Default is 1000 queries/60s **per source address**. Once the router forwards, the whole household is one source address. On trip FTL *refuses* every further query until the window rolls — whole-house DNS blackouts in one-minute blocks, invisible in every UI. This would have bitten you the moment §2.2 was fixed. |
| 5 | `node-agent/install-dns-stack.sh` | Removed the closing instruction to set **"secondary 1.1.1.1"** — it contradicted the product design, the watchdog's own header, and bypass mode. Clients query primary and secondary in arbitrary order, so a share of queries would bypass filtering in *normal* operation. Replaced with correct guidance plus an explanation of what actually handles the box dying. |
| 6 | `node-agent/install-dns-stack.sh` | Now **fails** if Pi-hole answers on loopback but not on the LAN address. Warns on two addresses in one subnet, and on IPv6 advertised without a default route. Writes `GATEFLAME_LAN_IP` into `dns-stack/.env` from the live routing table on every run. |
| 7 | `node-agent/gateflame-netcheck.sh` | **New.** A read-only, outward-looking check: router forwarding, IPv6, dual-homing, LAN listener, rate limiting, bypass state, watchdog timer. Everything the box asserted about *itself* passed while the household was broken. `--json` for machine use. |
| 8 | `node-agent/tests/test_dns_watchdog_lan.py` | **New, 5 tests.** The watchdog now stops after its definitions when sourced with `GATEFLAME_WATCHDOG_LIB=1`, so the health decision can be exercised with stubbed probes. **Verified non-vacuous** — the pre-fix logic reports `healthy` for loopback-up/LAN-down and the new tests catch it. |
| 9 | `node-agent/gateflame/posture.py` | `pathlib.Path` → `PurePosixPath` on appliance paths. On Windows the containing directory resolved to backslashes and was **silently dropped from the audit** — a world-readable `/var/lib/gateflame` passed clean. This was failing on `main` before I touched anything (verified against a pristine `main` worktree). |

## Verification of the fixes

| Check | Result |
|---|---|
| node-agent pytest | **446 / 446 pass** (was 441 + 5 new, and 1 previously-failing now fixed) |
| feed-receiver pytest | **83 / 83 pass** |
| frontend vitest | **109 / 109 pass** |
| `tsc --noEmit` | **clean** |
| `bash -n` on all three shell scripts | **clean** |
| Both compose files parse as YAML | **yes** |
| Non-vacuity of the new tests | **proven** — old logic reports `healthy`, new logic reports `unhealthy` |
| **Total** | **638 tests, 638 pass** |

---

# 4 — WHAT I COULD NOT DO, AND WHY

I want to be exact about this rather than imply more coverage than I have.

**SSH to the Pi is blocked.** The key is offered and **the Pi accepts it** —
`Server accepts key: id_ed25519 SHA256:8AQd4NPdbhkzEXYT4Em4Xy9Lj2wlmMZg6dYDX2lrpEI`
— but the private key is `aes256-ctr`/`bcrypt` encrypted, no agent holds it
(`ssh-add -l`: nothing; the Windows `ssh-agent` service is running but empty),
and a passphrase cannot be supplied non-interactively. So:

- **The fixes above are in the repo, not yet on the box.** They take effect when
  you run the two commands in §5.
- Every authenticated agent route returns `401` to me, which proves the auth
  layer works but means I could not exercise their behaviour live. The node also
  reports `provisioned: false` — **it has never been paired** — and pairing is
  loopback-only by design, so it cannot be driven from here.

To let me finish on the box in a future session, load the key once:

```cmd
"C:\Program Files\Git\usr\bin\ssh-add.exe" C:\Users\DGMic\.ssh\id_ed25519
```

---

# 5 — DO THESE FOUR THINGS, IN THIS ORDER

Each one can mask the next, so the order matters.

### 1. Turn IPv6 off on the router  ⏱ 2 min · **biggest single win**

Router admin → IPv6 → **Disable**. Then on each phone, forget and rejoin the
Wi-Fi (or toggle airplane mode) so the IPv6 address and RDNSS entry are dropped.

This alone should stop the disconnects. It also stops the phones bypassing the
filter entirely.

*If you want IPv6 on this LAN, that is a real project: the box filters IPv4 only
today, so working IPv6 means unfiltered phones until Gate^Flame serves DNS over
IPv6 too. That belongs on the roadmap, not in tonight's fix.*

### 2. Make the router actually forward  ⏱ 5 min

Router → DHCP/LAN → DNS server = **`192.168.0.10`**, and **nothing in the
secondary field**. Save, then reboot the router so leases are re-issued.

Verify from the PC — this is the test that does not lie:

```cmd
nslookup doubleclick.net 192.168.0.1
```

**Must return `0.0.0.0`.** A real address means it did not take, whatever the UI
said.

### 3. Decide the Pi's second interface  ⏱ 2 min · needs SSH

Two addresses on one `/24` is an unstable foundation for an appliance. Pick one
link — Ethernet is the right answer for a box that serves DNS — and drop the
other:

```bash
nmcli connection show                      # find the Wi-Fi connection name
sudo nmcli connection down "<wifi-name>"
sudo nmcli connection modify "<wifi-name>" connection.autoconnect no
```

Then re-run the installer so the stack rebinds to the surviving address.

### 4. Deploy the fixes to the box  ⏱ 5 min

```bash
cd /home/wabapi/node-agent
git pull                                   # after the branch is pushed
sudo bash install-dns-stack.sh             # rewrites .env, rebinds, verifies LAN listener
bash gateflame-netcheck.sh                 # must come back all-PASS
```

`gateflame-netcheck.sh` will re-check items 1–3 for you and tell you if any of
them did not take.

> ⚠️ **The branch is not pushed.** `fix/mobile-dns-drops` @ `65dce06` is local to
> `E:\Gateflame`. Same blocker as `fix/mobile-hookup`: the SSH key
> (`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILnQo9e8yMHc8S4pf79Uuy62+5xBM/e1DIlZUR93GisY dennis@wabakipi`)
> still is not registered at <https://github.com/settings/keys>.

---

# 6 — EVERY FEATURE AND FUNCTION, WITH VERIFIED STATUS

Legend:
**🟢 LIVE** — measured on the running node today ·
**🟩 TESTED** — covered by passing tests, not exercised on hardware ·
**🟡 UNPROVEN** — code exists, never run on real hardware or not verifiable this session ·
**🔴 BROKEN/MISSING**

## 6.1 Node-agent API — 25 routes, read live from `openapi.json` on `192.168.0.10:8080`

| Route | Status | Evidence |
|---|---|---|
| `GET /api/v1/system/status` | 🟢 **LIVE** | `200` → `{"nodeId":"GF-72TYTITQ","agentVersion":"0.1.0","provisioned":false}` |
| `GET /api/v1/system/kiosk` | 🟢 **LIVE** | `200` → `{"mounted":true,"path":"/device-kiosk","directory":"/opt/gateflame/kiosk","gap":null}` |
| `GET /device-kiosk/` | 🟢 **LIVE** | `200`, 2 211 bytes — real console served |
| `GET /openapi.json` · `GET /docs` | 🟢 **LIVE** | `200` on **both** `.10` and `.13` |
| `POST /api/v1/pair/request` | 🟡 UNPROVEN | loopback-scoped by design; node never paired |
| `POST /api/v1/pair/claim` | 🟩 TESTED | `test_pairing.py` — salted hashes, 5-guess lockout, per-IP rate limit |
| `GET /api/v1/pair/devices` | 🟢 auth ✅ / 🟡 function | `401` unauth — auth layer proven, behaviour not |
| `DELETE /api/v1/pair/devices/{id}` | 🟩 TESTED | |
| `POST /api/v1/pair/devices/revoke-all` | 🟩 TESTED | |
| `GET /api/v1/telemetry/summary` | 🟢 auth ✅ / 🟡 function | `401` unauth |
| `GET /api/v1/threats/recent` | 🟩 TESTED | `test_threats_v6.py` — ported to Pi-hole v6 API |
| `GET /api/v1/clients` | 🟢 auth ✅ / 🟡 function | `401` unauth |
| `GET /api/v1/services` | 🟢 auth ✅ / 🟡 function | `401` unauth |
| `GET /api/v1/modules/{id}/metrics` | 🟩 TESTED | |
| `POST /api/v1/services/{id}/start` · `/stop` | 🟩 TESTED | `test_services_firewall.py` |
| `POST /api/v1/firewall/bounce` | 🟡 **UNPROVEN** | `nft` proven only in container fallback — **never proven enforcing** |
| `DELETE /api/v1/firewall/bounce/{addr}` | 🟡 UNPROVEN | same |
| `GET /api/v1/firewall/bounced` | 🟢 auth ✅ / 🟡 function | `401` unauth |
| `GET /api/v1/wan/summary` | 🟢 auth ✅ / 🟡 function | `401` unauth |
| `GET /api/v1/posture/audit` | 🟩 TESTED | 56 tests; **one was failing on `main` — fixed today** |
| `GET /api/v1/flows/recent` | 🟡 **UNPROVEN** | DPI/AF_PACKET never proven capturing real hostnames |
| `GET /api/v1/filtering` | 🟢 auth ✅ / 🟡 function | `401` unauth |
| `PUT /api/v1/filtering/threat-level` | 🟩 TESTED | `test_threat_level.py` |
| `PUT /api/v1/filtering/categories` | 🟩 TESTED | `test_axis_independence.py` — content/threat axes independent |
| `POST /api/v1/filtering/pause` · `/resume` | 🟩 TESTED | `test_filtering_api.py` — pause-with-expiry |

## 6.2 Service modules — 7, from `services.py`

| Module | Status | Note |
|---|---|---|
| `module_dns_filter` | 🟢 **LIVE — working** | blocking + clean resolution both verified from the LAN today |
| `module_telemetry` | 🟩 TESTED | counters unverifiable remotely (401) |
| `module_zero_trust` | 🟩 TESTED | posture audit, 56 tests |
| `module_wan_audit` | 🟩 TESTED | `test_wan.py` |
| `module_passive_discovery` | 🟡 UNPROVEN | needs `ip neigh` on real hardware |
| `module_firewall_bounce` | 🟡 UNPROVEN | never proven enforcing |
| `module_dpi_flow` | 🟡 UNPROVEN | never proven capturing |

## 6.3 DNS filtering stack

| Item | Status | Evidence |
|---|---|---|
| Pi-hole v6 blocking | 🟢 **LIVE** | `doubleclick.net`, `ads.google.com`, `analytics.google.com` → all `0.0.0.0` |
| Unbound recursion | 🟢 **LIVE** | clean lookups resolve; captive-portal domains all resolve correctly |
| DNS on `192.168.0.10:53` | 🟢 **LIVE** | 240/240 queries, 0 fail, 0 slow, avg 51 ms |
| DNS on `192.168.0.13:53` | 🔴 **SILENT** | UDP + TCP both time out — see §2.3 |
| Pi-hole admin UI `:8081` | 🟢 LIVE | reachable on both addresses |
| Rate limiting | 🔴→🟩 **fixed in repo** | was default 1000/60; now `0` |
| Bind address hardcoding | 🔴→🟩 **fixed in repo** | now `${GATEFLAME_LAN_IP}` |
| Bypass mode | 🟡 UNPROVEN | never triggered on hardware; bind fix removes its worst failure mode |
| Watchdog | 🔴→🟩 **fixed in repo** | loopback-only → both listeners, 5 new tests |
| IPv6 filtering | 🔴 **NOT IMPLEMENTED** | IPv4 only. This is why §2.1 lets phones bypass entirely. |

## 6.4 Frontend — 28 components in `src/`

| Group | Components | Status |
|---|---|---|
| **Kiosk console** | `KioskApp`, `kioskUi`, `panels`, `panelsSystem`, `ConsoleLock` | 🟢 **LIVE** — served at `/device-kiosk`, 11 tests |
| **Kiosk legacy** | `GateFlameKiosk.tsx` | 🟡 the file itself says delete it after Gate 1 |
| **Pairing** | `AppPairingScreen`, `KioskPairingScreen` | 🟩 TESTED — never completed against a real node (`provisioned: false`) |
| **Dashboard** | `MobileDashboard`, `DNSTrafficChart`, `ThreatCategoryChart`, `DynamicModuleTab` | 🟩 TESTED |
| **Honesty** | `DataSourceBanner` | 🟩 TESTED |
| **Chrome** | `AppLayout`, `LazyFallback`, `LiveBackground`, `GravityParticleCanvas`, `SettingsManager` | 🟩 TESTED |
| **Dead code** | `Header.tsx`, `Footer.tsx` | 🔴 never imported — deletion is in the unpushed `chore/cleanup-2026-08-17` |
| **🔴 Demo screens still shipping** | `ServerSyncArchitecture`, `DeviceOnboardingSimulator`, `ExportPackagingCenter`, `DeploymentScriptViewer`, `ContainerArchitectureView`, `FutureFeatureRoadmap` | 🔴 **reachable in the shipping web app**. `ServerSyncArchitecture.tsx:146` still mints `gf_live_ionity_${Math.random()}` and labels it *"API Token"* — a random string wearing a production-credential prefix. |
| **Other** | `IonicrobesGame` | 🟡 unrelated to product function |

**Services layer:** `apiClient` (35 tests), `gateflameApi` (18), `nodeDiscovery`,
`serviceManager`, `mockAdapter` — 🟩 all TESTED. `discoveryCandidates` 8 tests.
`useAppStore` 18. `useGateFlameEngine` 19.

## 6.5 Android app

| Item | Status |
|---|---|
| Debug APK builds and installs | 🟢 verified 2026-08-18 (4 598 674 bytes) |
| App identity `today.ionity.gateflame` | 🟩 frozen, asserted in 5 places by CI |
| 26 launcher PNGs + `gradle-wrapper.jar` | 🟢 magic bytes valid |
| Import-cycle crash | 🟢 fixed (`73e3056`) + `importCycles.test.ts` guards any cycle |
| Mixed content / node reachability | 🟢 fixed (`c0c7563`) |
| Revocation handling | 🟢 fixed — authenticated `401` clears token, returns to pairing |
| **Release keystore** | 🟢 exists — 🔴 **backups unverified, no SHA-256 recorded. No recovery path if lost.** |
| Signed release build | 🔴 needs `keystore.properties` / `GATEFLAME_KEYSTORE_*` — passwords are yours |
| Play Store listing | 🔴 not started |

## 6.6 Build, test and CI

| Item | Status |
|---|---|
| node-agent pytest | 🟢 **446 / 446** |
| feed-receiver pytest | 🟢 **83 / 83** — 🔴 **still not in CI** |
| frontend vitest | 🟢 **109 / 109** |
| `tsc --noEmit` | 🟢 clean |
| Total | 🟢 **638 / 638** |
| ruff | 🔴 51 violations, `continue-on-error: true` — non-blocking |
| Nightly run on real hardware | 🔴 does not exist — the only CI that could ever prove filtering works |
| `NODE_ENV` on wabakipi | 🔴 still `production` + npm `omit=dev` — silently strips devDependencies |
| `NODE_ENV` on raspberrypi | 🔴 still `development` — produces ~2× React **dev** bundles |

## 6.7 Still open, unchanged from the 2026-08-18 scan

| # | Item | Status |
|---|---|---|
| 1 | Revoke the two GitHub PATs | 🔴 open since 14 Aug |
| 2 | Revoke `GEMINI_API_KEY` — live plaintext copy in `TempGateFlameBuild\.env.local` | 🔴 open |
| 3 | Back up the keystore twice + record SHA-256 | 🔴 open |
| 4 | Branch protection on `main` | 🔴 unverified |
| 5 | POPIA review; hosting location of `feeds.ionity.today` (s72) | 🔴 open |
| 6 | **No history database** — 5 tables, no telemetry/rollup/event table, no `/history/*` route. A reboot is amnesia. | 🔴 open |
| 7 | Version disagreement — git tag `v1.0.2` vs `android/version.properties` `1.0.1` | 🔴 open |
| 8 | Address conflict — `docs/LINKS.md` says `192.168.1.x`, reality is `192.168.0.10` | 🔴 open |
| 9 | Base-model contradiction — Pi 5 vs Orange Pi Zero 2W | 🔴 open |
| 10 | Two unpushed branches: `fix/mobile-hookup`, `fix/mobile-dns-drops` | 🔴 blocked on the SSH key |

---

# 7 — THE ONE THING WORTH TAKING FROM THIS

Every check the box performed on itself passed, in every one of the four fault
states. The resolver was healthy. The containers were up. Loopback answered.
The tests were green. And the household's phones could not stay online.

The product's health model was **inward-facing**, and the product is not the box
— it is the box's effect on the network around it. `gateflame-netcheck.sh` and
the watchdog's second probe are the beginning of an outward-facing health model,
and §6.7 item 6 (no history) is the other half: without stored history there is
no way to notice that something has been intermittently wrong for three days.

For a retail appliance, "it works when I test it" is not the bar. The bar is
"it notices, and says so, when it stops working for someone else."

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
