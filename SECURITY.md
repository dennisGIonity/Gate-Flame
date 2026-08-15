```
========================================================================================
GATE^FLAME — SECURITY POLICY & DISCLOSURE
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-014-SEC | Version: 1.0 | Updated: 2026-08-14 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Security policy

Gate^Flame is sold as a network security appliance. A product in that category
without a disclosure route is asking researchers to either stay quiet or go
public, and neither helps a customer.

## Reporting a vulnerability

**Email <ai@ionity.today>** with `SECURITY` in the subject line, or
<johan@ionity.today>. Please do not open a public GitHub issue for a
vulnerability.

Include what you have: affected component and version, what an attacker can do
with it, and how to reproduce. A rough report you are unsure about is more
useful than a polished one you never send.

**What to expect:**

| | |
|---|---|
| Acknowledgement | Within 3 working days (SAST, UTC+2) |
| Initial assessment | Within 10 working days |
| Fix or mitigation plan | Communicated with the assessment |
| Credit | Offered by name unless you prefer otherwise |

We will not pursue legal action against anyone acting in good faith under this
policy: testing only against your own device, not accessing or altering other
people's data, and giving us a reasonable chance to fix the issue before going
public.

## Scope

**In scope** — this repository: the React dashboard, the Android companion
app, `node-agent/` (the Pi appliance backend), `feed-receiver/`, the pairing
and telemetry protocol, and the build/release tooling.

**Out of scope** — third-party components we package but do not maintain
(Pi-hole, Raspberry Pi OS, the Linux kernel; please report those upstream, and
tell us too if a Gate^Flame default makes them worse), and anything requiring
physical disassembly of a unit you do not own.

## Areas we would particularly like eyes on

Stated plainly because a researcher's time is better spent where the risk is:

- **`node-agent/gateflame/firewall.py`** — drives `nft`. A previous
  implementation put an unvalidated address into an `nft` argv and could reach
  `nft flush ruleset`. The rebuild is argv-only with a constant ruleset and
  validation that re-emits from `ipaddress`, and it carries the historical
  payload as a regression test. If you find a way through, we want to know.
- **`node-agent/gateflame/dpi.py`** — a packet parser is fed
  attacker-controlled length fields by definition. `parse_frame()` is a pure
  function specifically so you can fuzz it without hardware.
- **The pairing flow** (`docs/PAIRING-AND-TELEMETRY.md` §3). The security
  property is that `kiosk` scope comes from a loopback source address and
  never from a bearer token, so destructive actions need physical presence. A
  way to obtain `kiosk` scope remotely, or to make a lost handset re-arm
  first-boot admin, is a serious finding.
- **`feed-receiver/`** — §4 promises the support feed carries health fields
  only. Getting a domain, hostname or client IP to persist there breaks a
  written promise to customers.

## What the product promises

So you know what counts as a break:

1. The node serves the LAN only (RFC1918, loopback, link-local). Nothing on
   the public internet can reach it, and the support feed is outbound-only.
2. Destructive actions — stopping a protection module, revoking every paired
   device — require physical presence at the kiosk, not a bearer token.
3. Revoking all paired devices never re-arms first-boot admin. A lost phone
   must not become a way in.
4. No module ever reports `running` for a capability it does not have. A
   degraded module says what is missing and how to fix it.
5. The support feed carries health fields only — never domains, client
   identifiers, threat logs, or anything from DPI.

A demonstration that any of these five is false is a valid report, whether or
not it fits a conventional vulnerability class.

## Releases and signing

Release artifacts are published as GitHub Release assets with `SHA256SUMS.txt`.
The Android APK is signed on a machine holding the release keystore, never in
CI. Verify downloads against the checksums file.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
