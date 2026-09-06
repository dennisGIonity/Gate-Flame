```
========================================================================================
GATE^FLAME — PRIVACY NOTICE (POPIA s18)
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-09-015-PRIVACY | Version: 1.0 | Updated: 2026-09-06 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Privacy Notice — Gate^Flame Network Security Node

**Effective:** _[date of publication]_ · **Version 1.0**

This notice is given under section 18 of the Protection of Personal Information
Act 4 of 2013 (POPIA). It tells you what Ionity collects when you use a
Gate^Flame node and the Gate^Flame mobile app, why, for how long, and what you
can do about it.

It describes the product **as it is actually built**, field by field. Where
something is not yet settled, this notice says so rather than rounding it in our
favour.

---

## 1. Who is responsible

| | |
|---|---|
| **Responsible party** | Ionity (Pty) Ltd (formerly Antwerp Designs), trading as AEDI |
| **Registration number** | _[company registration number — insert before publication]_ |
| **Address** | Centurion, Gauteng, South Africa |
| **Information Officer** | Johan Wilhelm van Antwerp |
| **Contact for anything in this notice** | **info@ionity.today** |

---

## 2. The short version

Gate^Flame filters DNS on your own network, on a box in your own home or
office. **Almost everything it knows about your network never leaves the
building.**

- **What you browse is yours.** Domains, DNS query logs, threat logs, deep-packet
  inspection output and the IP addresses of your devices are held on your box and
  are **never transmitted to Ionity**. Not summarised, not aggregated, not sampled.
- **The box can send us a health check-in** — CPU, memory, temperature, whether
  each module is running. This is **off unless you turn it on**.
- **If you use the Shield (VPN) feature, that check-in also carries a list of the
  devices you put on a VPN region** — including each device's MAC address and the
  name you gave it. This is the one place a device identifier leaves your network,
  and §5 covers it on its own because it deserves to be read, not skimmed.
- **The mobile app sends us nothing at all.** It talks only to your box, on your
  own network.

---

## 3. What never reaches us

The following stay on your node and are never sent to Ionity:

- the domains any device looks up, and the full DNS query log
- the threat log and every per-query blocking decision
- deep-packet-inspection output
- the IP addresses and hostnames of devices on your network
- anything typed into the wall console or the app beyond the settings themselves

This is enforced in code, not by policy. The module that builds the check-in
(`node-agent/gateflame/health_feed.py`) does not import the threat, client or DPI
modules at all, so the data is not in scope at the point the message is built. The
receiving server rejects any field it does not expect with an HTTP 422 error and
has no database column such data could be written into.

**A note on how the product is wired:** your router forwards its DNS to the box
rather than each device being pointed at it directly. A side effect is that even
your own box mostly cannot attribute a lookup to an individual device. We mention
it because it means "which person visited which site" is not information the
product generally holds, let alone sends.

---

## 4. What the box sends us, if you switch the check-in on

**Off by default.** The health feed runs only when `GATEFLAME_FEED_ENABLED` is
turned on. When enabled it sends one message every 15 minutes over HTTPS to
`feeds.ionity.today`, authenticated with a token unique to your node.

This is the complete message. There are no other fields:

| Field | What it is | Why we need it |
|---|---|---|
| `nodeId` | The box's own identifier, e.g. `GF-72TYTITQ` | Tells your box apart from another customer's |
| `agentVersion` | Software version | Whether a fault is already fixed in a newer release |
| `sentAt`, `uptimeSeconds` | Time sent; time since last boot | Spotting boxes that keep restarting |
| `host.cpuPercent`, `memUsedMB`, `memTotalMB`, `diskUsedPercent` | Load, memory and disk use | A box running out of resources fails in confusing ways |
| `host.tempC`, `host.throttleFlags` | Temperature; whether the processor is throttling | Overheating and failing power supplies, the two commonest hardware faults |
| `modules[].id`, `.status`, `.gap` | Each feature's name, whether it is running, and a short text reason if not | Answering "why has filtering stopped" without a site visit |
| `counters.errors24h`, `.restarts24h`, `.wanBudgetUsedPercent` | Error and restart counts; data-cap usage | Trend, not detail |
| `piholeReachable` | Whether the filter engine is answering | The single most useful support fact |
| `shield` | Your VPN configuration — **see §5** | |

The free-text `gap` and `remedy` fields are length-capped and rejected outright if
they contain anything that parses as an IP or MAC address, so a fault message
cannot smuggle out network detail.

---

## 5. Device identifiers — the part you should read

If you use **Shield**, our VPN feature, the check-in also contains one row for
**each device you have chosen to put on a VPN region**:

| Field | Example |
|---|---|
| `mac` | The device's hardware address, e.g. `a4:83:e7:1c:22:0b` |
| `label` | The name you gave that device, e.g. *"Kyle's tablet"* |
| `region` | The country you routed it through, e.g. *Japan* |
| `enabled` | Whether it is currently on |
| `provider` | Which VPN service carries it |

**A MAC address is a device identifier, and a name you chose may identify a
person.** We are not going to describe this as anonymous, because it is not.

Three things limit it, and all three are real:

1. **Only devices you configured appear.** These rows exist because somebody
   chose a VPN region for that device. Devices merely seen on your network are
   never listed. A household that has never opened Shield sends an empty list.
2. **It is still only configuration, never behaviour.** It says *"this device is
   set to Japan"*. It never says what that device did, visited, or blocked.
3. **The whole check-in is off by default,** and turning it off stops these rows
   with it.

**Why it is there at all:** so that when you telephone about Shield, support can
see which of your devices is on which region and help you, instead of asking you
to read settings off a screen while you are already frustrated. That was a
deliberate product decision, taken on 31 August 2026, and this notice exists
partly because we made it.

**If you would rather it did not leave:** turn the health feed off, or do not
assign devices to VPN regions. Shield keeps working either way; you simply give
up assisted support on it.

---

## 6. The mobile app

The Gate^Flame app talks **only to your node, over your own local network**. It
does not send anything to Ionity or to anyone else.

- No analytics, advertising, crash-reporting or tracking libraries are built into
  it. There are none in the app's dependencies.
- It requests three Android permissions: internet access, network-state access,
  and multicast — the last so it can find your box on the network by name. It does
  not ask for location, contacts, storage or identifiers.
- Calls to any address outside your private network are refused by the app itself.
- It holds a pairing token proving it is allowed to talk to your box. That token
  stays on your phone.

---

## 7. Why we process it, and on what basis

We use the check-in **only** for warranty, technical support and product
reliability.

We do **not** sell it, share it, rent it, or use it for marketing, profiling,
advertising or lead generation. We do not use it to decide who to contact about
upgrades. If that ever changes, it is a new purpose requiring a new basis and a new
version of this notice — not a quiet expansion of this one.

**Supplying it is entirely voluntary.** The feed is off until you enable it, and you
may disable it at any time. **Nothing about your protection depends on it.** If it is
off, filtering, Shield, the app and the wall console all work exactly as before —
you simply lose remote-assisted support, and we will ask you more questions on the
phone.

The check-in does not run at all until a node has been paired, which requires
physical presence at the box.

---

## 8. Who else sees it

Nobody outside Ionity. We do not share the check-in with advertisers, data
brokers, analytics providers or partners. If a court or a regulator lawfully
compels disclosure, we will comply, and will tell you unless we are prohibited
from doing so.

**Ionity is not an operator for the data on your box.** We never receive it and
cannot reach into your network. That data is yours and you are the responsible
party for it.

---

## 9. Where it is stored, and for how long

**Stored in South Africa.** The receiving service runs in South Africa, so no
cross-border transfer of personal information takes place and section 72 of POPIA
is not engaged. If that ever changes we will update this notice **before** moving
anything, and will state which country and which safeguard we rely on.

**Retention: 90 days.** Older check-ins are deleted automatically as new ones
arrive. There is also a hard cap of 10 000 stored reports per node, whichever
limit is reached first. There is no long-term archive.

Sales and warranty records — your name, contact details and what you bought — are
kept for as long as we are required to keep them under South African tax and
company law.

---

## 10. How it is protected

- Every node authenticates with its own token, stored hashed (HMAC-SHA256 with a
  secret held outside the database). A stolen copy of the database does not yield a
  working token.
- Transport to `feeds.ionity.today` is HTTPS.
- The box only accepts connections from your own local network, checked before
  any password or token is considered.
- Actions that change or destroy settings require physical presence at the box.
  They cannot be triggered from a token, from the app, or from the internet.
- The receiver rejects unrecognised fields outright rather than storing them.

No system is perfectly secure. If personal information under our control is
compromised, POPIA section 22 requires us to notify the Information Regulator and
the affected people, and we will.

---

## 11. Your rights

Under POPIA sections 23 to 25 you may:

- **ask what we hold about you** — and because we hold so little, the honest answer
  is usually: your sales record, your contact details, and up to 90 days of
  health check-ins;
- **have it corrected** if it is wrong;
- **have it deleted.** We can erase a node's entire history on request; the
  facility exists and is not a manual favour;
- **object to processing**, or withdraw agreement to the check-in, at any time —
  in practice, by switching it off;
- **complain to us**, and separately **complain to the Regulator**, whether or not
  you complain to us first.

Write to **info@ionity.today**. We will acknowledge within 5 working days and
respond substantively within 30 days. We do not charge for this.

**The Information Regulator (South Africa)**
Woodmead North Office Park, 54 Maxwell Drive, Woodmead, Johannesburg, 2191
General enquiries: enquiries@inforegulator.org.za · 010 023 5200 · 0800 017 160
POPIA complaints: POPIAComplaints@inforegulator.org.za (POPIA Form 5)
https://inforegulator.org.za

---

## 12. If you are a business, school or landlord

If you install Gate^Flame anywhere other than your own home, **you** become the
responsible party for what the box observes about the people using that network,
and you have your own duties under POPIA — including telling staff, pupils,
tenants or guests that their traffic is being filtered and logged.

Ionity does not discharge those duties for you and cannot. Please do not assume
otherwise, because the household exemption in POPIA section 6(1)(a) will not cover
you.

---

## 13. Changes to this notice

If we change what leaves your network, we will publish a new version here with a
new effective date **before** the change reaches your box, and record what changed.
A feature that widens what the check-in carries is exactly the kind of change this
paragraph exists for.

The current version always lives at **https://www.ionity.today/privacy**.

---

## 14. Questions

**info@ionity.today** — Johan Wilhelm van Antwerp, Information Officer,
Ionity (Pty) Ltd.

---
---

# Annex A — Google Play Data Safety declaration

Not part of the public notice. This is the mapping to file in Play Console, so the
listing and this notice cannot contradict each other.

## A.1 The distinction that decides the answer

Play's Data Safety form asks about data **the app** collects or transfers off the
user's device.

Verified in the source: **the app transmits nothing to Ionity.** It talks only to
the node on the local network; public hosts are refused by the client itself, and
there are no analytics, advertising or crash-reporting SDKs and no
`google-services.json`. On a strict reading, the app "collects no data".

**The device identifiers still leave — but from the box, not the phone.** The
Gate^Flame node posts them directly.

## A.2 Recommendation: declare them anyway

Declare **Device or other IDs → collected → transferred off device**, and use the
description to explain the box.

The strict reading is defensible but it is a technicality, and it invites the worst
version of this conversation: a reviewer, or a journalist, discovering that a
privacy-branded product sends MAC addresses and finding a Play listing that says
"no data collected". Being able to say *we declared it, we explained it, and it is
off by default* is worth far more than the checkbox.

## A.3 Suggested form answers

| Play question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Data type | **Device or other IDs** — MAC address and a user-assigned device label |
| Collected or shared? | **Collected** (transferred off device by the paired hardware node) |
| Processed ephemerally? | **No** — retained up to 90 days |
| Required or optional? | **Optional** — off by default; user-enabled |
| Purpose | **App functionality** (technical support and diagnostics) |
| Encrypted in transit? | **Yes** — HTTPS |
| Can users request deletion? | **Yes** — info@ionity.today, and a deletion facility exists |
| Data collected for advertising or marketing? | **No** |
| Data shared with third parties? | **No** |
| Committed to Play Families Policy? | Only if the listing targets children — decide separately |

**Suggested description field:**

> Gate^Flame is a hardware network filter. The app itself sends no data anywhere —
> it communicates only with your Gate^Flame device on your local network. If you
> enable the optional support check-in on the device, the device sends Ionity
> health information (CPU, memory, temperature, whether each feature is running).
> If you also use the Shield VPN feature, that check-in includes the hardware
> address, your chosen name, and the VPN region for each device you configured.
> Your browsing, DNS queries and threat logs are never sent to Ionity. The check-in
> is off by default and can be switched off at any time.

## A.4 Do not claim the Data Safety "no data collected" badge

It is the more attractive listing and it is not worth it here.

---
---

# Annex B — What must still happen before this is published

This notice is drafted and internally consistent. Five things are outside it.

| # | Item | Status |
|---|---|---|
| 1 | **Company registration number** for §1 | Not in any project document. Required — a notice naming no legal entity is weak. |
| 2 | **Information Officer registration** with the Regulator | Not done (POPIA-REVIEW §3.1). Registration is a positive act, not automatic. The notice can publish first; the registration should not lag it. |
| 3 | **Kiosk "what we send" screen** | Specified in `PAIRING-AND-TELEMETRY.md` §4.3 rule 3, **still unverified as built**. §4 of this notice promises the fields are visible on the box. Verify, or the notice overclaims. |
| 4 | **Breach response plan** (POPIA s22) | Does not exist. §10 commits to notifying. The moment to write the plan is not during the incident. |
| 5 | **`SECURITY.md`** with a disclosure route | Absent. Table stakes for a product in the network-security category. |

Legal review remains advisable. This was written by an engineer against the code,
not by an admitted attorney, and §12 in particular carries commercial consequence.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
