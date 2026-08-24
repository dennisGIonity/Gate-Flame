```
========================================================================================
GATE^FLAME — FULL STATUS REPORT
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-024-STATUS | Version: 1.0 | Updated: 2026-08-24 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

Everything below was **measured on 2026-08-24**, against the live node
`GF-72TYTITQ` and a clean checkout. Nothing is quoted from a commit message.

---

# 1 — HEADLINE

**The box filters. For the first time since it was built.**

Verified by query, not by dashboard:

| Domain | Answer via `192.168.0.10` |
|---|---|
| `ad.doubleclick.net` | `::` — blocked |
| `pagead2.googlesyndication.com` | `::` — blocked |
| `googleadservices.com` | `::` — blocked |
| `google-analytics.com` | `::` — blocked |
| `scorecardresearch.com` | `::` — blocked |
| `github.com` *(control)* | real address — correct |

Gravity holds **82,562 domains**. Live counters: **130,066 looked up, 895
blocked, 11 devices seen**.

This morning every one of those five returned a real address while the product
reported `active`.

---

# 2 — TEST COUNTS

| Suite | Tests | Result |
|---|---|---|
| node-agent (pytest) | **552** | all pass |
| feed-receiver (pytest) | **83** | all pass |
| frontend (vitest) | **178** | all pass |
| **Total** | **813** | **all pass** |
| `tsc --noEmit` | — | clean |
| Build targets | 3 | mobile, kiosk, web — all build |

Frontend breakdown: apiClient 41 · IoniBot 42 · useGateFlameEngine 19 ·
gateflameApi 18 · useAppStore 18 · format 19 · kioskConsole 11 ·
discoveryCandidates 8 · importCycles 2.

**Not in CI:** the 83 feed-receiver tests. Ruff is still `continue-on-error`.

---

# 3 — WHAT EXISTS AND WORKS

## 3.1 Node agent — 23 Python modules, 26 API routes

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app, all 26 routes, filtering payload assembly |
| `security.py` | LAN-only gate; scope enforcement; kiosk scope from loopback socket |
| `storage.py` | SQLite/WAL — node identity, pairing codes, devices, filter settings |
| `telemetry.py` | Real host stats: psutil, `/sys/class/thermal`, `vcgencmd` |
| `pihole.py` | Pi-hole v6 authenticated REST client, session-cached |
| `blocklists.py` | Applies threat level + categories to Pi-hole; `reconcile()` |
| `threat_level.py` | Three cumulative levels → blocklist URLs |
| `content_categories.py` | Four content categories, all off by default |
| `filtering_state.py` | Pause durations, expiry, human descriptions |
| `threats.py` | Blocked-query log, Pi-hole v6 API |
| `clients.py` | Passive LAN discovery — `ip neigh` + lease files, no probing |
| `services.py` | Module registry; honest capability reporting |
| `netcheck.py` | **New today** — exposes the network-shape check over HTTP |
| `netclaim.py` | Decides how far to go (pure, no I/O) |
| `netapply.py` | Executes plans; dry-run by default |
| `router_handshake.py` | Credential lifecycle, read-back, rollback |
| `router_adapters.py` | UPnP identification; credentialed login deliberately unbuilt |
| `posture.py` | Read-only security posture audit |
| `firewall.py` | nftables bouncer |
| `dpi.py` | SNI/Host flow observation |
| `wan.py` | WAN quality and budget |
| `health_feed.py` | Outbound-only, health-fields-only, off by default |
| `config.py` | Environment-driven configuration |

**Ten shell scripts**: `install.sh`, `deploy-on-pi.sh`, `validate-on-pi.sh`,
`install-dns-stack.sh`, `install-kiosk.sh`, `install-watchdog.sh`,
`dns-watchdog.sh`, `gateflame-netcheck.sh`, `gateflame-ra-advertiser.sh`,
`gateflame-env-set.sh`.

## 3.2 API surface

```
GET    /api/v1/system/status              LAN only
GET    /api/v1/system/kiosk               LAN only
POST   /api/v1/pair/request               kiosk
POST   /api/v1/pair/claim                 LAN only
GET    /api/v1/pair/devices               read
DELETE /api/v1/pair/devices/{id}          kiosk
POST   /api/v1/pair/devices/revoke-all    kiosk
GET    /api/v1/telemetry/summary          read
GET    /api/v1/threats/recent             read
GET    /api/v1/clients                    read
GET    /api/v1/services                   read
GET    /api/v1/modules/{id}/metrics       read
POST   /api/v1/services/{id}/start        control
POST   /api/v1/services/{id}/stop         kiosk
POST   /api/v1/firewall/bounce            control
DELETE /api/v1/firewall/bounce/{addr}     control
GET    /api/v1/firewall/bounced           read
GET    /api/v1/wan/summary                read
GET    /api/v1/posture/audit              read
GET    /api/v1/posture/netcheck           read      ← new 2026-08-24
GET    /api/v1/flows/recent               read
GET    /api/v1/filtering                  read
PUT    /api/v1/filtering/threat-level     control
PUT    /api/v1/filtering/categories       control
POST   /api/v1/filtering/pause            control
POST   /api/v1/filtering/resume           control
```

The asymmetry is deliberate: **starting** a module is `control` so protection
can be restored remotely; **stopping** one is `kiosk` so a stolen phone cannot
switch the product off.

## 3.3 On-device console (kiosk)

Lock screen plus eight panels — Overview, Filtering, Threats, Network, Modules,
Firewall, WAN, System. Every panel wired to a real route. Authority derived from
the socket, so a LAN viewer gets a correct read-only console rather than buttons
that 401.

## 3.4 Phone app — rebuilt 2026-08-24

Seven screens in `src/mobile/`: **Home** (gravity hero + verdict), **Activity**,
**Blocked**, **Network**, **Health**, **Settings**, **Play** (Ionicrobes).
IoniBot rides above every screen as a bubble.

Shares the console's engine outright — one description of every endpoint,
response type, formatter and honesty rule. Bundle **285 kB** (was 841 kB).

## 3.5 IoniBot — the offline assistant

Deterministic tree over five local probes. No model, no cloud, no backend.
Seven diagnostic states, 33 screens, 42 tests. Rewritten 2026-08-24 for ADR-001.

---

# 4 — IMPLEMENTED FAIL-SAFES

## 4.1 Access and identity

1. **LAN-only gate** ahead of every route — RFC1918, loopback, link-local only.
2. **Kiosk scope is synthesised from a loopback source address**, never from a
   bearer token. Physical presence cannot be forged remotely.
3. **Pairing codes are single-use**, expire, and are issued only to a loopback
   caller.
4. **Five wrong guesses locks the code**; per-IP rate limiting on top.
5. **Tokens stored as salted hashes**, never in the clear.
6. **`revoke_all()` never touches `provisioned`** — a lost phone cannot re-arm
   first-boot admin.
7. **Revocation reaches the handset**: an *authenticated* 401 clears the token
   and returns to pairing. Narrow by design — a wrong pairing code also returns
   401 and must not wipe a good token.
8. **`assertPrivateHost()`** refuses cleartext to anything that is not the
   customer's own LAN.

## 4.2 Never claiming more than is true

9. **Null is never zero.** `pihole.summary()` returns `None` per field when
   Pi-hole did not supply it; surfaces render an em-dash plus the node's own gap.
10. **Module registry reports `not_implemented` with a named gap**, never a
    faked `running`.
11. **`protectionStatus` cannot say `active` over a box that is not filtering** —
    `unconfigured` when there is no Pi-hole URL, `degraded` when the lists are
    not loaded. *Added 2026-08-24.*
12. **Every Pi-hole write is checked and read back.** A registered list that
    downloads zero domains is a failure. *Added 2026-08-24.*
13. **A stale error is dropped when Pi-hole contradicts it** — a false
    "degraded" is as harmful as a false "active". *Added 2026-08-24.*
14. **`DataSourceBanner`** flags any fabricated value on the web surface;
    `VITE_STRICT_LIVE` forbids silent fallback to demo data.
15. **Discovery identity guard** — a captive portal returning 200 is not
    mistaken for a node; `nodeId` and `agentVersion` must both be present.

## 4.3 Never breaking the household

16. **Bypass mode** — after five consecutive failed minutes the watchdog drops
    to an unfiltered resolver on the same address, so the internet comes back
    and the box says so loudly.
17. **The watchdog probes both listeners**, loopback *and* the LAN address.
    Loopback alone was blind to the only address the household uses.
18. **No secondary DNS, ever** — clients query both in arbitrary order, making
    protection intermittent and inexplicable.
19. **`netapply` dry-runs by default**; a blocked remedy never becomes an
    action, an unknown remedy is reported rather than dropped, weakest tier
    first, and a failure stops the sequence.
20. **`netclaim.Capabilities.max_tier`** caps a standard box at `OFFER` even on
    hardware that could forward at line rate. Capability is not permission.
21. **Router handshake reads back** before claiming success, rolls back on
    failure, and discards the password.
22. **`LOGIN_SUPPORTED_MODELS` is empty**, with a test asserting that is
    correct — no guessing at a router's private crypto.
23. **Pause always has an expiry**; open-ended durations require confirmation
    and are not offered on the phone at all.
24. **`until_reboot` pauses actually end at reboot** — cleared on startup.
25. **`reconcile()` on boot** — a box whose blocklist is empty repairs itself
    instead of waiting for a human to toggle something. *Added 2026-08-24.*
26. **Image architecture is gated** before any container is deployed.
27. **Health feed is outbound-only, health-fields-only, and off by default.**

## 4.4 Stopping regressions

28. **`importCycles.test.ts` fails on any cycle** in `src/` and prints the path.
    Written after an import cycle killed the app on a real handset.
29. **IoniBot copy discipline** — jargon allow-list is per-screen *and*
    per-word, so an exemption cannot widen into a blanket.
30. **`unknown` never resolves to a confident state** in IoniBot; a check that
    could not run is never counted as a pass.
31. **ADR-001 regression tests** — no screen may tell a customer that a dead box
    takes their internet down; `IB-110` may not send them back to DHCP.
32. **Every discovery candidate must carry `:8080`**, pinned by test.
33. **CI blocks tracked build output and secrets**, and asserts the Android
    `applicationId` in five places.

---

# 5 — WHAT DOES NOT WORK / IS NOT BUILT

## 5.1 Blocking the product

- 🔴 **No history database.** Five tables, none of them telemetry. Every chart
  is instantaneous polling; a reboot is amnesia. "Yesterday" is impossible.
- 🔴 **The router does not forward to the box.** Only Wabakipi is filtered,
  because its DNS is set by hand. The household is not yet protected.
- 🔴 **No plug-and-play.** No custom image, no first-boot provisioning, no OTA,
  no factory reset. The box still needs a human with SSH.
- 🔴 **Pairing still requires SSH** to read the code. No button, no display,
  no QR.
- 🔴 **No Play Store path.** No listing, no signed release, no privacy URL.

## 5.2 Known defects and gaps

- 🟡 **Dual-homed on one /24** — eth0 `.10`, wlan0 `.13`, port 53 on `.10`
  only. Detected and deliberately not auto-fixed.
- 🟡 **Router advertises IPv6 with no default route** — phones prefer it, stall
  on every AAAA, and drop Wi-Fi. Self-heal written, not yet live.
- 🟡 **`/api/v1/pair/router/revert` does not exist**, so IoniBot's IB-605
  tidy-up fails honestly. Post-ADR-001 this is hygiene, not rescue.
- 🟡 **The web demo screens remain** — `DeviceOnboardingSimulator`,
  `ServerSyncArchitecture` (mints a fake `gf_live_…` token),
  `ExportPackagingCenter`, `DeploymentScriptViewer`, `FutureFeatureRoadmap`,
  `ContainerArchitectureView`. Not in the phone or kiosk bundles. Decision
  pending.
- 🟡 **feed-receiver's 83 tests are not in CI**; ruff is non-blocking.
- 🟡 **Version disagreement** — git tag `v1.0.2`, `android/version.properties`
  `VERSION_NAME=1.0.1`.
- 🟡 **`vcgencmd`, `nft` and AF_PACKET paths** have never been proven
  *enforcing* on real hardware — only in container fallbacks.

## 5.3 Credentials — all open

- 🔴 **Pi-hole admin password exposed** in a session transcript today.
- 🔴 **Two GitHub PATs and the `GEMINI_API_KEY`** — open since 14 August. A
  live plaintext copy of the Gemini key remains in
  `TempGateFlameBuild\.env.local`.
- 🔴 **Release keystore not backed up**, fingerprint not recorded. No recovery
  path if the file is lost.

---

# 6 — HONEST ASSESSMENT

The **software is in good shape**: 813 tests, one engine shared by both
surfaces, and an honesty architecture that today proved it can catch its own
lies once it is asked the right question.

The **product is not**. A box that filters one workstation because that
workstation's DNS was set by hand is a demonstration, not an appliance. The
distance from here to a sealed unit someone else can plug in is the plug-and-play
work, the history database, and the router handshake — and none of those are
started.

The most valuable thing learned today is a process fact, not a technical one:
**four independent layers all reported healthy over a box that had never
filtered a single query.** Every one of them was truthful about what it measured.
None of them measured the thing that mattered. That is now fixed in five places,
and it is the pattern to watch for everywhere else.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
