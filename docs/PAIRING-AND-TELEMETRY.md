```
========================================================================================
GATE^FLAME — DEVICE PAIRING & TELEMETRY FEED SPECIFICATION
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-PAIR | Version: 1.0 | Updated: 2026-08-13 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Pairing and telemetry — the contract

This is the contract the rebuilt `node-agent` backend must implement, and the one
the mobile app builds against. It supersedes the "device ID inserted into the
mobile APK" approach.

## 1. The product shape it assumes

```
  ┌─────────────────────────────────────┐
  │  Pi appliance (sold as a unit)      │
  │                                     │
  │  node-agent  ──── nine modules      │
  │  Pi-hole / unbound                  │
  │  kiosk: Chromium --kiosk  ──────────┼──▶ 3.5" / 7" touch screen
  │         http://localhost:8080/...   │
  └───────────────┬─────────────────────┘
                  │ LAN only (RFC1918)
                  ▼
        customer's phone — one universal APK
```

The kiosk is **not** an Android app. It is Chromium in `--kiosk` mode in the
`gateflame-display-kiosk` container on RPi OS / Armbian. Only one APK exists:
`org.ionity.gateflame`, the customer's companion app.

## 2. Why the device ID is not baked into the APK

The proposal was to insert a device ID into the mobile APK per unit. That costs
more than it looks:

| Consequence | Detail |
|---|---|
| One APK build per unit sold | A compile-and-sign step in manufacturing, per device |
| No single download | The kiosk page cannot serve one file; it must serve *this customer's* file |
| Updates multiply | Every bug fix means N rebuilds and N signatures, not one |
| Signing risk scales | Every extra signing operation is another chance to use the wrong key |
| Nothing is gained | A baked-in ID is not a secret — `unzip` the APK and read it |

That last row is the decisive one. An identifier compiled into a public download
is not a credential; it is a label. Anyone who obtains one APK obtains the ID.

## 3. Pairing — six-digit code, physical presence

**One universal APK.** The credential is standing in front of the appliance.

```
1. Customer installs the app (see §5) and opens it.
2. App discovers the node: mDNS `gateflame.local`, else a subnet sweep of
   the phone's own /24, else manual IP entry.
3. App: "Enter the code shown on your Gate^Flame screen."
4. Customer taps PAIR on the kiosk. The node generates a six-digit code and
   displays it on its own screen. Nothing leaves the appliance.
5. Customer types the code into the app.
6. Node verifies and issues a long-lived device token bound to that handset.
7. App stores the token. Pairing complete. The code is destroyed.
```

Properties, and why each one matters:

| Property | Value | Reason |
|---|---|---|
| Code length | 6 digits | 10⁶ space, short enough to read off a small screen |
| Validity | 5 minutes | Bounds an offline guessing window to ~10⁵ attempts/sec impossibility |
| Uses | Single | A code that worked once must never work twice |
| Failed attempts | 5, then destroy | Caps online guessing at 5 × 10⁻⁶ |
| Rate limit | 1 attempt / 2 s per source IP | Makes even the 5 attempts slow |
| Displayed on | The node's own screen only | Never sent over the network, never emailed |
| Scope of issuance | Kiosk / loopback only | A remote caller cannot ask for a code |

**A node you cannot touch cannot be adopted.** That is the security property, and
it is worth more than a baked-in ID because it cannot be extracted from a file.

### 3.1 Endpoints

```http
POST /api/v1/pair/request          scope: kiosk (loopback only)
  → 201 { "code": "418207", "expiresAt": "...", "attemptsRemaining": 5 }

POST /api/v1/pair/claim            scope: none (LAN, unauthenticated)
  { "code": "418207", "deviceName": "Dennis — Pixel 8" }
  → 200 { "deviceToken": "...", "nodeId": "GF-A7K2-9QX4", "nodeName": "...",
          "scopes": ["read","control"] }
  → 401 { "error": "invalid_code", "attemptsRemaining": 3 }
  → 410 { "error": "code_expired" }
  → 429 { "error": "rate_limited", "retryAfterSeconds": 2 }

GET    /api/v1/pair/devices        scope: read      list paired handsets
DELETE /api/v1/pair/devices/{id}   scope: kiosk     revoke one handset
```

> **Carry the revoke-all fix forward.** In the lost build, revoking every device
> counted only unrevoked tokens and so returned the node to first-boot state,
> where any tokenless loopback caller got admin. The `provisioned` flag must be
> persisted and must never be un-set by revocation. This is the one defect in
> that list that turns a lost phone into a node takeover.

### 3.2 Scopes

| Scope | Granted to | Allows |
|---|---|---|
| `read` | Any paired handset | Telemetry, logs, module status |
| `control` | Any paired handset | **Start** a module, pause protection, whitelist |
| `kiosk` | Loopback at the appliance only | **Stop** a module, revoke devices, factory reset |

Starting a module remotely is fine — restoring protection is what a remote is
for. **Stopping** one requires physical presence: it persists across reboots and
tears down the firewall table, so a stolen phone must not be able to switch the
product off.

### 3.3 `nodeId`

Generated **on the node at first boot**, not assigned at manufacture:
`GF-` + 8 base32 characters from the SoC serial plus a random salt.

Printed on the kiosk's About screen and on the enclosure label. This is the ID
that appears in the support feed (§4) and the one a customer reads out on a
support call. It identifies a unit; it authorises nothing.

## 4. The support feed — health only

You asked for the kiosk to report back to Ionity's feeds. It can, and here is the
line to draw.

### 4.1 The line

| Send | Never send |
|---|---|
| `nodeId`, firmware/agent version | Domain names queried or blocked |
| Uptime, restart count | Client IPs, MACs, hostnames |
| Per-module status (`running` / `degraded` / `stopped`) and the named gap | Threat log entries |
| Error and exception counts by class | DNS query volumes per client |
| CPU / RAM / disk / thermal, SoC throttle flags | Anything from DPI, even SNI hostnames |
| Data-budget consumption | Wi-Fi SSIDs, geolocation |
| Pi-hole reachable yes/no | Pi-hole's blocklist contents or query log |

The left column gives you everything needed for warranty, support triage, fleet
health and "which units are on an old agent". The right column is what turns a
support feed into a surveillance feed.

### 4.2 Why the line is there — POPIA

South Africa's **Protection of Personal Information Act** applies here. DNS
queries, client hostnames and IP addresses attached to an identifiable household
or business are *personal information*. If Ionity receives them, Ionity becomes a
responsible party (or an operator for the customer), which brings with it:

- a lawful basis for processing, usually consent, which must be specific and freely given;
- a processing clause in the sale agreement, not buried in a EULA;
- purpose limitation — collected for support means used for support;
- a registered Information Officer;
- breach notification duties to the Information Regulator and to data subjects;
- retention limits and deletion on request.

Restricting the feed to the left column keeps the payload out of that category
almost entirely: a `nodeId` plus a thermal reading is not personal information.

> Not legal advice. Before the first unit ships, have someone who practises
> POPIA read the sale agreement and this section together. The cost of asking now
> is a fraction of the cost of a regulator asking later.

### 4.3 Design rules

1. **Health-only by default.** Anything in the right column of §4.1 requires an
   explicit, revocable, per-node opt-in taken **at the kiosk**, with a plain
   sentence saying what leaves the device. Off by default, and off after a
   factory reset.
2. **Outbound only.** The node initiates. The feed endpoint must never be able to
   reach into a customer LAN, and no inbound port is opened. This preserves the
   LAN-only property for everything that matters.
3. **Visible.** The kiosk shows a feed indicator and a "what we send" screen
   listing the exact fields. A customer must be able to see it without asking.
4. **Killable.** One toggle at the kiosk stops all reporting. The product keeps
   working — the feed is for support, not licensing. If the product stops working
   when reporting is off, the feed is not optional and the consent is not real.
5. **Batched and capped.** One POST every 15 minutes, ≤ 8 KB, exponential backoff.
   Sites on LTE or satellite pay for every byte — the same reason
   `module_wan_audit` carries a persisted monthly budget.
6. **Fails silent, never fatal.** No feed connectivity must never degrade
   protection. Queue, cap the queue, drop oldest.

### 4.4 Endpoint

```http
POST https://feeds.ionity.today/api/v1/nodes/{nodeId}/health
Authorization: Bearer <per-node feed token, issued at provisioning>

{
  "nodeId": "GF-A7K2-9QX4",
  "agentVersion": "1.0.1",
  "sentAt": "2026-08-13T15:04:05Z",
  "uptimeSeconds": 864000,
  "host": { "cpuPercent": 12.4, "memUsedMB": 412, "memTotalMB": 3906,
            "diskUsedPercent": 38, "tempC": 54.2, "throttleFlags": "0x0" },
  "modules": [
    { "id": "module_firewall_bounce", "status": "degraded",
      "gap": "no CAP_NET_ADMIN", "remedy": "grant CAP_NET_ADMIN to the agent unit",
      "restarts24h": 0 }
  ],
  "counters": { "errors24h": 3, "restarts24h": 0, "wanBudgetUsedPercent": 41 },
  "piholeReachable": true
}
```

Note what is absent: no domains, no client identifiers, no query counts per
client. A support engineer can act on every field here, and none of it describes
a person.

## 5. Distribution — getting the APK onto the phone

The kiosk serves a download page at `http://gateflame.local/app`. Android will
warn the customer that it came from an unknown source; that is unavoidable for a
side-load and should be *explained*, not hidden.

The page must show:

- a QR code to the APK on the node itself, so no internet is required;
- the **SHA-256 certificate fingerprint** from `npm run apk-fingerprint`, so the
  download can be verified — for a security product this is the difference
  between "trust us" and "check us";
- the app version and `versionCode`;
- three screenshots of Android's own "install unknown apps" prompt, so a
  non-technical customer knows what is coming.

**Play Store is the better long-term answer** — it removes the unknown-source
warning entirely and gives automatic updates. It requires exactly what
`android/KEYSTORE.md` and `android/version.properties` now set up: a stable
signing key, a unique `applicationId`, and a monotonic `versionCode`. Those are
prerequisites, and they are now in place.

## 6. What this changes in the repo

Already done in this commit:

- One Capacitor config, `capacitor.config.ts`, `appId org.ionity.gateflame`.
- Kiosk APK target removed; `build:html-kiosk` retained for the Chromium kiosk.
- `versionCode` / `versionName` single-sourced with auto-bump.
- Release signing wired; unsigned releases refused.
- Cleartext restricted to RFC1918 instead of blanket mixed content.
- Cloud backup and device transfer disabled so the pairing token cannot leave
  the handset it was issued to.

Still required, and blocked on the backend rebuild:

1. `/api/v1/pair/*` endpoints per §3.1.
2. Kiosk PAIR screen and code display.
3. App-side discovery, pairing screen, token storage.
4. The health feed per §4.4, plus the kiosk consent and indicator screens.
5. POPIA review of the sale agreement alongside §4.2.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
