```
========================================================================================
GATE^FLAME — MOBILE CONNECTION: GOAL, ARCHITECTURE & BUILD PLAN
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-017-MOB | Version: 1.0 | Updated: 2026-08-17 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# PART 1 — THE GOAL

> **A customer unboxes a Gate^Flame node, plugs it in, and looks at its screen.
> They scan one code with their phone. Within ninety seconds their phone shows
> true numbers about their own network — and at no point did they type an IP
> address, a password, or a word.**

Six acceptance tests. Each is a thing that is not yet true.

| # | Clause | Passes when |
|---|---|---|
| M1 | "one code" | A single QR scan carries node identity, address, pairing code and expiry. No typing |
| M2 | "install one app" | Play Store install. No unknown-sources toggle, no sideload |
| M3 | "within ninety seconds" | Cold phone → paired dashboard, measured with a stopwatch, three times |
| M4 | "true numbers" | Zero fabricated values. Every gap named in the node's own words |
| M5 | "their own network" | Token is device-bound, revocable from the console, and survives reboot |
| M6 | "no one else's" | A device on the same Wi-Fi cannot read the token in transit |

M6 is the one that is easy to skip and expensive to retrofit. See §2.4.

---

# PART 2 — ARCHITECTURE (ROUTE 2, DECIDED 2026-08-17)

## 2.1 The decision

**Distribution and pairing are separate problems.** Route 1 fused them — QR to a
web page, download the APK, be connected. That fusion is what makes it fail.

| Concern | Route 2 answer |
|---|---|
| Getting the app | Google Play |
| Finding the node | QR payload carries the addresses |
| Proving presence | QR payload carries a short-lived code |
| Trusting the node | QR payload carries a certificate fingerprint |

### Why not Route 1

1. **Android gives an app nothing from the page that delivered its APK.** "Install
   and be connected" is not a thing the platform does. It would be scan → download
   → install → **scan again**. Fine, but it is not one gesture.
2. **Sideloading fails M2** and teaches customers to enable "install unknown apps"
   — the precise permission every scam asks for. On a security product that trade
   is not worth making. It also forfeits auto-update: a bad build becomes
   unrecallable.
3. **Chrome fights APK downloads** over plain HTTP from a LAN IP, and fights
   self-signed HTTPS harder.

**Route 1 is not discarded — it is scoped to the ten-unit field trial**, where
sideloading is acceptable because you hand the box over in person. The QR is the
durable investment; the delivery mechanism swaps underneath it.

## 2.2 The pairing payload

The QR encodes JSON, not a URL. Compact keys keep it a low-density code that
scans from a phone held at arm's length in poor light.

```json
{
  "v": 1,
  "n": "GF-72TYTITQ",
  "a": ["gateflame.local:8080", "192.168.0.10:8080"],
  "c": "418362",
  "exp": 1787002400,
  "fp": "sha256/BASE64_CERT_FINGERPRINT"
}
```

| Key | Meaning |
|---|---|
| `v` | payload version — so a v2 app can refuse a v1 node politely |
| `n` | node id, shown in the app so the customer knows which box |
| `a` | addresses to try, mDNS first, literal IP as fallback |
| `c` | the same six-digit code already issued by `POST /pair/request` |
| `exp` | unix expiry — the app refuses a stale code before hitting the network |
| `fp` | certificate fingerprint for pinning (§2.4) |

**The security model does not change.** The code is issued only to a loopback
caller — physical presence at the box. The QR makes it typo-proof, not weaker:
whoever can see the screen could already read the digits.

## 2.3 Scope map — what the phone may and may not do

Read from `node-agent/gateflame/main.py`. A paired phone holds `read` and
`control`. It never holds `kiosk`, which is granted only to a loopback socket.

| Scope | Routes |
|---|---|
| **LAN only** | `GET /system/status`, `POST /pair/claim`, `GET /system/kiosk` |
| **read** | `/telemetry/summary`, `/threats/recent`, `/clients`, `/services`, `/modules/{id}/metrics`, `/firewall/bounced`, `/wan/summary`, `/posture/audit`, `/flows/recent`, `/filtering`, `/pair/devices` |
| **control** | `/services/{id}/start`, `/firewall/bounce`, `DELETE /firewall/bounce/{addr}`, `PUT /filtering/threat-level`, `PUT /filtering/categories`, `POST /filtering/pause`, `POST /filtering/resume` |
| **kiosk — phone is REFUSED** | `POST /pair/request`, `POST /services/{id}/stop`, `DELETE /pair/devices/{id}`, `POST /pair/devices/revoke-all` |

The asymmetry is deliberate and must survive into the app: **starting** a module
is `control` so protection can be restored remotely; **stopping** one is `kiosk`
so a stolen phone cannot switch the product off. The app must not render a stop
control it will be refused for.

## 2.4 Transport — the decision that must be made first

Pairing currently happens over **plain HTTP**. `POST /pair/claim` sends the code
and the node returns a bearer token in clear text. Any device on that Wi-Fi can
read it — and the DPI module in this very product exists to prove how easy that
is.

For most products "it is only the LAN" is an acceptable answer. For one **sold as
network security**, it is not. A guest Wi-Fi in a customer's house is not a
trusted network.

**Recommended:** generate a self-signed certificate at first boot, put its
fingerprint in the QR, have the app pin it. No CA, no browser, therefore no
warnings. Cost is roughly a day. Retrofitting after units ship costs a re-pair of
every device in the field.

> **DECISION REQUIRED — D1.** Self-signed TLS with pinning now, or plain HTTP for
> v1? This changes the QR payload, so it is answered before any code is written.
> Recommendation: do it now; `fp` is already in the payload above.

> **DECISION REQUIRED — D2.** QR scanning in-app via a Capacitor plugin (fast,
> one more dependency, works from a cold app), or the OS camera opening a deep
> link (no dependency, but needs intent filters that do not exist, and cannot
> pair before install). Recommendation: **the plugin**, with a deep link added
> later as a convenience.

---

# PART 3 — WORK BREAKDOWN

Effort in working days for one person.

## 3.1 Node — 3 days

| # | Work | Done when |
|---|---|---|
| N1 | `GET /api/v1/pair/payload` (kiosk scope): issues a code and returns the full payload object | Returns valid JSON; refuses a LAN caller with 401 |
| N2 | First-boot self-signed cert + `fp` in the payload — **gated on D1** | Fingerprint in payload matches `openssl x509 -fingerprint` |
| N3 | Serve HTTPS alongside HTTP, HTTP redirecting only for the kiosk page — **D1** | Both listeners answer; agent boot check covers it |
| N4 | Address list built from real interfaces, not a constant | `a` contains the node's actual IPs on a re-addressed LAN |
| N5 | Tests: payload shape, expiry honoured, kiosk-only issuance, claim still single-use and rate-limited | pytest green in CI |

## 3.2 Console (kiosk) — 2 days

| # | Work | Done when |
|---|---|---|
| K1 | "Pair a phone" renders the **QR** plus the digits underneath | Scans from 1 m in a dim hallway |
| K2 | Live countdown from `exp`; code visibly dies rather than sitting stale | Expired state is unmistakable |
| K3 | A short instruction line and a Play Store link for a phone without the app | Readable at 2 m |
| K4 | QR rendered as inline SVG, no new runtime dependency | Kiosk bundle stays under 400 kB |

## 3.3 Phone app — 8 days

| # | Work | Done when |
|---|---|---|
| A1 | Onboarding: welcome → scan → paired, with real error states for wrong/expired/rate-limited | Three cold-start runs under 90 s (M3) |
| A2 | QR scanner — **D2** | Scans in poor light |
| A3 | Certificate pinning from `fp` — **D1** | A substituted cert is refused |
| A4 | Token storage in Android Keystore-backed secure storage, not plain preferences | Token unreadable from a rooted `adb` pull of app data |
| A5 | Dashboard, Filtering, Threats, Network, Modules, System — same honesty rules as the console | No fabricated value renders anywhere |
| A6 | Refused-action handling: `kiosk`-scope controls are absent, not broken | No 401 is ever reachable by tapping |
| A7 | Node-unreachable and token-revoked states | Distinct, actionable messages |
| A8 | Tests: pairing state machine, scope gating, every error state | vitest green in CI |

## 3.4 Delivery — 4 days, lead-time bound

| # | Work |
|---|---|
| D1 | Play Console account, identity verification (**start early — it queues**) |
| D2 | Signed release using the keystore generated 2026-08-17, fingerprint `AB:F9:6D:F7:…:E2:7D`. Enrol in **Play App Signing** |
| D3 | Data safety form — must match reality. Our honest answer is unusually good: almost nothing leaves the LAN |
| D4 | Closed → open testing track. **Check the current tester-count rule at account creation, not at submission** |
| D5 | Trial-only: APK served from the box behind an explicit "this is a test build" screen |

## 3.5 Gates

- **GATE M-A** — a phone pairs from a QR on real hardware, no typing. Retires E3.
- **GATE M-B** — every screen shows true data or a named gap. Retires E5 for mobile.
- **GATE M-C** — installed from Play on a phone that has never been developer-enabled. Retires E2.

---

# PART 4 — THE AI STUDIO PROMPT

## How to use it

Paste **Part 4.2 verbatim** as the first message. It is deliberately long: the
last AI Studio build produced beautiful screens wired to `Math.random()`, and
about 4,000 lines had to be deleted. The constraints below are the difference.

Treat what comes back as a **design and layout source**, not as shippable code.
Take the visual language, the component structure and the copy; wire the data
yourself against the real client in `src/services/gateflameApi.ts`.

## 4.2 — The prompt

---

Build a React + TypeScript mobile app screen set for **Gate^Flame**, a home
network security appliance. Target: Android phone, 390×844, via Capacitor.
Tailwind CSS for styling. Beautiful, calm, and trustworthy — this is a product
someone glances at to answer "is my family safe online right now?"

**THE ONE RULE, ABOVE ALL ELSE.** This app must never display a number, a status
or a chart value that did not come from the API. No placeholder data. No
`Math.random()`. No sample arrays. No "coming soon" screens presented as
features. Where a value is unknown, render an em-dash `—` and, underneath it, the
API's own `gap` string explaining why. A previous version of this app invented
its numbers and had to be destroyed. If you are tempted to fill a chart with
plausible values, render the empty state instead.

**Visual language.** Dark only. Background `#080D16`. Cards `#111A28` at 80%
opacity with `#1E293B` borders, 16px radius. Accents: `#38BDF8` cyan for
interactive, `#006FD3` blue for brand, `#FF8700` orange for blocked//warning,
`#10B981` green for protected, `#F59E0B` amber for degraded and for gap text,
`#E11D48` red for fault. Typography: Plus Jakarta Sans for UI, JetBrains Mono for
all numbers and identifiers — numbers are tabular and never reflow as they tick.
Generous spacing. Subtle depth via a radial glow behind the hero, not drop
shadows. Minimum touch target 44px. Respect `prefers-reduced-motion`.

**Screens to design:**

1. **Welcome** — what the box does, one sentence, and a single "Scan the code on
   your Gate^Flame screen" call to action.
2. **Scanner** — camera view with a framing reticle, plus a "type the code
   instead" fallback with a six-digit input.
3. **Pairing states** — connecting, wrong code, code expired, too many attempts
   (rate-limited), node unreachable. Five distinct, human, non-technical messages
   that each say what to do next.
4. **Home** — the hero answers one question in one glance: **protected**,
   **paused by you**, or **unprotected (fault)**. Three visually distinct states.
   Below: queries today, blocked today, block percentage, devices on the network.
   A gauge for block percentage. All values may be null.
5. **Filtering** — a three-way threat level selector (low / medium / high) with a
   one-line description each; a list of content-category toggles, each with a
   description and, where present, a caution line shown *before* the toggle; and
   a pause control offering fixed durations, where the two longest require a
   press-and-hold rather than a tap.
6. **Threats** — a list of blocked queries: domain, which device asked, which
   list refused it, and the time. Plus a most-frequent-domains bar list. Empty
   state must read as "nothing was blocked", clearly distinct from "we could not
   ask".
7. **Devices** — devices seen on the network: IP as primary identifier, MAC
   secondary, hostname only when known.
8. **Settings** — node identity, agent version, this device's pairing, and an
   unpair action.

**Behavioural constraints:**

- Some controls are refused to a phone by design. Do not render a "stop module"
  control, or any device-revocation control, at all — those require physical
  presence at the appliance. Absent, not disabled.
- Every list needs a real empty state and a real error state, designed as
  carefully as the populated state.
- A "paused" and an "unprotected due to fault" state must look equally unsafe.
  They differ only in what the user should do about it.
- Charts should be small, hand-rolled SVG. Do not add a charting library.
- No browser storage APIs for the token; assume a secure-storage adapter exists
  and call it.

**Deliver:** a set of React function components with TypeScript interfaces for
every prop, Tailwind classes only, no external UI kit, and no data fetching —
every component takes its data as props, and every data prop is nullable.

---

# PART 5 — SEQUENCING

```
D1/D2 decisions ─► N1 payload ─► K1 QR on console ─► GATE M-A
                        │
                        ├─► N2/N3 TLS ─────────────► A3 pinning
                        │
                        └─► A1/A2 onboarding ─► A5 screens ─► GATE M-B
                                                      │
  Play account (start NOW, it queues) ───────────────►└─► GATE M-C
```

**Total ≈ 17 working days**, of which the Play account queue is the only thing
that cannot be compressed by working harder — which is why it starts first.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
