```
========================================================================================
GATE^FLAME — POPIA REVIEW (PRE-SHIP)
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-014-POPIA | Version: 1.0 | Updated: 2026-08-14 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# POPIA review — Gate^Flame Network Security Node

> **This is not legal advice, and it is not a substitute for the review
> `PAIRING-AND-TELEMETRY.md` §4.2 already calls for.** It is an engineer's
> structured hand-over to whoever does that review: what the product actually
> does with personal information as built on 2026-08-14, mapped to the eight
> conditions for lawful processing in the Protection of Personal Information
> Act 4 of 2013, with the open questions stated plainly rather than glossed.
>
> Give this document and `docs/PAIRING-AND-TELEMETRY.md` to the reviewer
> together. The questions in §5 are the ones only a person can answer.

---

## 1. The short version

Gate^Flame is unusually well-placed under POPIA, and that is a design outcome
rather than luck: **the product's architecture keeps almost all personal
information on the customer's own premises, under the customer's own control.**

| Where the data is | What it contains | Who is the responsible party |
|---|---|---|
| On the node, on the customer's LAN | DNS queries, client IPs/MACs/hostnames, SNI hostnames, threat log | **The customer.** Ionity never receives it. |
| In the support feed to Ionity | `nodeId`, versions, CPU/RAM/disk/thermal, module status, counters | Ionity — but see §3, this is arguably not personal information at all |
| In the phone app | A pairing token and whatever the node shows it | The customer |

The single largest POPIA exposure is not the telemetry. It is **§3.5 below —
the risk that the support feed's scope quietly widens later.** Every control
in this document is easy to hold today and easy to lose in one well-meaning
commit eighteen months from now.

---

## 2. Who is who

POPIA's duties attach to a *responsible party* (who determines purpose and
means) and bind an *operator* (who processes on their behalf).

- **Customer = responsible party** for everything the node observes about
  devices and people on their network. A household running Gate^Flame on a
  domestic LAN is likely covered by the s6(1)(a) exclusion for purely
  personal or household activity; **a business customer is not**, and a
  business customer monitoring staff devices has employee-monitoring duties
  of its own that Ionity should not pretend to discharge for them.
- **Ionity = responsible party** for the support feed it receives, and for
  customer contact details held for sales and warranty.
- **Ionity is *not* an operator for the on-node data**, because it never
  receives it and cannot reach into the LAN (§4.3 rule 2, enforced by
  `security.require_lan`). This is worth stating explicitly in the sale
  agreement: it is the sentence that keeps Ionity out of the customer's
  breach-notification chain.

> ⚠ **This changes the moment any remote-support or "let us take a look"
> feature ships.** A feature that lets Ionity see a customer's threat log —
> even with a click-through consent — makes Ionity an operator, with an
> operator agreement under s21 and mandatory security safeguards under s19.
> That is a business decision with legal consequences, not a support
> convenience. Decide it deliberately.

---

## 3. The eight conditions, as built

### 3.1 Accountability (s8)

**Gap — action required.** POPIA requires a registered **Information
Officer**. By default this is the head of the private body — Johan — and
registration with the Information Regulator is a positive act, not automatic.
Deputy Information Officers may be designated.

**Status: not done.** This is a prerequisite for shipping to business
customers, and it is a form-filling exercise rather than an engineering one.

### 3.2 Processing limitation (s9–12)

*Lawfulness, minimality, consent, collection direct from the data subject.*

**Strong, structurally.** The feed carries the §4.1 left column only, and as
of 2026-08-14 that is enforced in code rather than by policy:

- `node-agent/gateflame/health_feed.py` does not import the threat, client or
  DPI modules at all — the data is not in scope at the point of
  serialisation, so a future edit cannot accidentally reference it.
- `feed-receiver/` rejects any unknown field with **422** rather than
  silently dropping it, and its database has no column, BLOB or key/value
  table a domain could be written into. Storing a leak would require a schema
  migration that a reviewer can see in a diff.
- Free-text fields (`gap`, `remedy`) are length-capped and rejected if they
  contain a parseable IP or MAC.

**Minimality holds:** every field in the payload has a named support purpose
in §4.1, and a support engineer can act on each one.

**Open question — consent vs legitimate interest.** §4.2 assumes consent. If
the feed genuinely carries no personal information (§3.3), no lawful basis is
needed for it at all, and framing it as consent may actually be *unhelpful*:
consent can be withdrawn, which implies the feed must be switchable off —
which §4.3 rule 4 already requires anyway. **Recommendation: keep the
kill switch regardless of the legal analysis.** It is cheap, it is already
built, and it is what makes the consent real if a reviewer decides one is
needed.

### 3.3 Purpose specification (s13–14) — *is the feed personal information at all?*

This is the question the whole telemetry design turns on, and it deserves a
straight answer rather than the confident one.

`nodeId` is a persistent, unique identifier for a device installed at one
premises. On its own it identifies no one. **But Ionity's sales records link
`nodeId` to a purchaser.** Under POPIA's definition, information relating to
an identifiable juristic *or* natural person is personal information — and
once the linkage exists in Ionity's own systems, "this node ran hot at 03:00
and rebooted four times" becomes information about an identifiable customer.

**Honest conclusion: the feed is probably low-risk personal information, not
no personal information.** That does not make it unlawful — it makes it
ordinary. Warranty and support is a defensible purpose, the data is minimal,
and the retention limit is implemented. But the document should stop asserting
"none of it describes a person" quite so flatly; **"none of it describes what
anyone did on the network" is the accurate and still-strong claim.**

**Recommendation:** soften that sentence in §4.4 of
`PAIRING-AND-TELEMETRY.md`, and treat the feed as personal information for
process purposes. It costs nothing — the controls are already built — and it
removes the one place where a reviewer could accuse the documentation of
overclaiming.

### 3.4 Further processing limitation (s15)

Support data must be used for support. **Not currently constrained by
anything except intent.** Fleet health dashboards are compatible; using node
telemetry for marketing segmentation, resale, or "which customers are on old
hardware, call them" is further processing that needs its own basis.

**Recommendation:** one line in the sale agreement stating the feed is used
for warranty, support and product reliability only, and is not sold, shared
or used for marketing. Easy to promise, valuable to have in writing.

### 3.5 Information quality (s16) — and the real risk

Fine as built. The material point sits next to it:

> **The largest POPIA risk in this product is scope creep in the feed.**

Every control above is easy to hold today because the feed is 8 KB of health
fields. The failure mode is not a breach — it is a support engineer, two
years from now, adding "just the blocked domain count per client, it's
aggregate really" to help diagnose a ticket. That single field moves Ionity
from "receives no behavioural data" to "receives a behavioural profile of a
household", and it will not feel like a legal event when it happens.

**Recommendation — make it a review gate, not a rule:** any pull request
touching `health_feed.py` or the feed-receiver schema requires explicit
sign-off from the Information Officer. The 422-on-unknown-field behaviour
already forces the change to be visible on both sides simultaneously, which
is exactly the friction you want.

### 3.6 Openness (s17–18)

**Partial.** §4.3 rule 3 requires the kiosk to show a "what we send" screen
listing the exact fields, and the feed-receiver exposes the accepted contract
at `GET /api/v1/contract`.

**Gaps:**
- The kiosk "what we send" screen is **specified but not verified as built** —
  confirm before shipping, because it is the visible half of the promise.
- POPIA s18 requires notification at collection: what is collected, by whom,
  the purpose, whether supply is voluntary, and the right to complain to the
  Regulator. A privacy notice at <https://www.ionity.today> covering the
  support feed and the sales relationship does not appear to exist yet.

### 3.7 Security safeguards (s19–22)

Reasonable measures, and breach notification to the Regulator **and** the
data subject where a compromise is reasonably believed to have occurred.

**Built:**
- Node tokens hashed with HMAC-SHA256 and an out-of-DB pepper — not
  recoverable from a database dump alone.
- LAN-only enforcement ahead of authentication; `kiosk` scope synthesised
  from a loopback source address and never from a bearer token, so physical
  presence is required for destructive actions.
- Transport is HTTPS to the feed endpoint; the LAN hop is HTTP, scoped to
  RFC1918 by `network_security_config.xml` rather than blanket cleartext.
- Retention: 90 days on the receiver, pruned inline, plus a per-node row cap.
- `DELETE /api/v1/admin/nodes/{id}` exists for erasure requests.

**Gaps:**
- **No breach response plan exists.** s22 has timing expectations; the moment
  to write the plan is not during the incident.
- **No `SECURITY.md`** in the repo. For a product in the network security
  category a disclosure route is table stakes, and its absence is the kind of
  thing a reviewer notices immediately. (Already flagged as recommendation 6
  in the 2026-08-13 audit; still open.)
- The **release keystore does not yet exist**. Losing it after ship means no
  security update can ever be delivered to a fielded unit — which converts a
  key-management failure into an indefinite unpatched-device problem across
  the whole fleet. This is a security-safeguards issue, not only a build one.

### 3.8 Data subject participation (s23–25)

Right of access, correction and deletion.

**Structurally easy, because Ionity holds so little.** A customer asking
"what do you have on me" gets: sales record, contact details, and ≤90 days of
node health. The on-node data never left their premises, so there is nothing
to disclose and nothing to delete.

**Gap:** no documented process or contact route for such a request. The
`DELETE` endpoint exists; the human procedure around it does not.

---

## 4. Cross-border transfer (s72)

**Open, and it may be the most easily-missed item here.**

`feeds.ionity.today` has no stated hosting location in any project document.
If the receiver runs outside South Africa — a cloud region in Europe or the
US — s72 restrictions on transferring personal information across borders
engage, requiring an adequate-protection regime, contractual safeguards, or
consent.

Given §3.3's conclusion that the feed is probably low-risk personal
information, this needs an answer rather than a shrug.

**Recommendation:** host the feed receiver in South Africa if practical. It
removes an entire condition from the analysis for a decision that is
otherwise mostly about latency, and latency is irrelevant to a 15-minute
batched POST.

---

## 5. What to put in front of the reviewer

Ordered by how much a wrong answer costs.

| # | Question | Why it matters |
|---|---|---|
| 1 | Is a `nodeId` linked to a purchaser in Ionity's records personal information? | Decides whether §3.3's whole analysis applies. Everything else is cheap if the answer is yes and the controls stay as built. |
| 2 | Where will `feeds.ionity.today` be hosted? | s72 cross-border transfer (§4). |
| 3 | Does the sale agreement state that Ionity receives no network-activity data and is not an operator for on-node data? | This is the sentence that keeps Ionity out of the customer's breach chain (§2). |
| 4 | For business customers: whose duty is it to tell staff their traffic is being filtered and logged? | Employee monitoring. Ionity should be clear this is the customer's duty, in writing, before a customer assumes otherwise. |
| 5 | Is the Information Officer registered with the Information Regulator? | s8. A form, but a prerequisite (§3.1). |
| 6 | Is consent the right basis for the feed, or is it unnecessary? | Affects what the kiosk screen must say. Keep the kill switch either way (§3.2). |
| 7 | What is the breach response plan and who executes it? | s22 (§3.7). |

## 6. Engineering actions, independent of the legal answer

These are worth doing regardless of how §5 resolves, and none is expensive:

1. **Soften the §4.4 claim** in `PAIRING-AND-TELEMETRY.md` from "none of it
   describes a person" to "none of it describes what anyone did on the
   network". Accurate, still strong, and removes the one overclaim.
2. **Verify the kiosk "what we send" screen exists** and lists the real
   fields — ideally generated from the same schema the receiver enforces, so
   the screen cannot drift from the payload.
3. **Add `SECURITY.md`** with a disclosure route.
4. **Require Information Officer sign-off** on any diff touching
   `health_feed.py` or the receiver schema (§3.5).
5. **Publish a privacy notice** covering the feed and the sales relationship
   (s18).
6. **Generate and back up the release keystore** — s19 security safeguards
   depend on being able to ship a patch (§3.7).
7. **Write the breach response plan.**

---

## 7. Summary for the file

Gate^Flame's architecture does most of the POPIA work already: the data that
would be hard to justify never leaves the customer's premises, and the data
that does leave is minimal, capped, retained for 90 days, and structurally
prevented from carrying anything else. That is a genuinely good position and
it was designed in, not retrofitted.

What is outstanding is almost entirely paperwork and process rather than
code: an Information Officer registration, a privacy notice, a breach plan, a
hosting decision, and clear language in the sale agreement about who is
responsible for what. The one engineering-adjacent risk worth guarding
deliberately is scope creep in the feed, because every protection described
here is easy to hold today and easy to lose quietly later.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Not legal advice. Prepared for review by a POPIA practitioner.
```
