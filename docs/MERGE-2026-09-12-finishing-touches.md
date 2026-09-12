```
========================================================================================
GATE^FLAME — MERGE RECORD: "FINISHING TOUCHES" PROJECT INTO THE CANONICAL REPO
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-09-012-MERGE | Version: 1.0 | Updated: 2026-09-12 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# What this is

On 2026-09-12 the separate Claude project **"Gate^Flame Finishing touches"**
(`019ffa8d-1f45-719f-88fd-e825e5d20e4d`) was merged into this repo. Its knowledge set
was nine documents written between **2026-08-13 and 2026-08-22**, plus accumulated
project memory.

The instruction was *merge everything, skip the parts already improved here*. This
document is the audit trail of that judgement: **every source item, and what happened
to it.**

**Method.** Nothing was skipped on the assumption that it was probably fixed. Every
"superseded" call below was executed against the working tree on 2026-09-12 — `git
grep`, `git ls-files`, file reads — and the evidence is quoted. Where the old document
turned out to be **still right**, it is carried forward, even where a newer document
had already claimed the opposite.

- Raw originals: `archive-finishing-touches/` (verbatim, with a README)
- Current truth: `PIN-2026-09-10.md` — that document still wins over everything here

---

# PART A — STILL TRUE TODAY. CARRIED FORWARD.

Eleven items. Each was verified on the tree today, not inherited.

> ## ✅ UPDATE, same day — five of them are now fixed
>
> Dennis read this list and said fix it. The descriptions below are left as
> written, because the record of *what was wrong and how long it survived* is
> the useful part. What changed:
>
> | Item | Now |
> |---|---|
> | **A1** fabricated `gf_live_` credential | **Fixed**, and it turned out to be three fabrications in that one screen, not one — see below. Pinned by `src/services/noFabricatedCredentials.test.ts` |
> | **A2** `THIRD_PARTY_NOTICES.md` | **Written**, from installed package metadata rather than memory. The Pi-hole EUPL-1.2 question is stated as unresolved rather than answered — it is a lawyer's call |
> | **A4** feed-receiver not in CI | **Fixed.** New `feed-receiver` job in `ci.yml` |
> | **A6** `mobile.html` fallback fonts | **Fixed.** Three lines, identical to `index.html` |
> | **A7** `LINKS.md` wrong `/24` | **Fixed** (already noted below) |
>
> Verified after the changes: `tsc --noEmit` clean, **vitest 198/198** (195
> before; the three new ones are the credential guard).
>
> **Still open and not touched:** A3 (the history database — 15 days of work,
> not a fix), A5 (ruff gate — a recorded decision), A8 (the 344 MB bundle),
> A9 (credentials — yours to revoke), A10 (branch protection).
>
> ### A1 turned out to be worse than reported
>
> Opening the file to fix line 146 found two more lies in the same component,
> both of which had also survived the 2026-09-10 sweep:
>
> - `handleTestApiCall` waited 1200 ms and then rendered a **fabricated success
>   payload** — "38,851 queries", "14,397 ads blocked", "37.1%", "6,755,558
>   domains" — in green, as though a real API had answered. It now calls the node
>   for real through `gateflameApi.telemetry()`. Offline that returns nulls,
>   which is the honest answer.
> - The displayed URL was `http://192.168.1.105/admin/api.php?summary&auth=<token>`
>   — **the same wrong `/24` as A7**, and it put a bearer credential in a query
>   string, which the 2026-08-13 audit had flagged separately (§19). Now the real
>   route, with the credential in the header where it belongs.
>
> The surrounding panels — the `api.ionity.today/v1/sync` endpoint, the R45/mo
> subscription, the warranty date — are still brochure furniture. **Not touched:
> the recorded decision (roadmap Sprint 5.2) is to delete this screen from the
> shipping app or gate it behind `/demo`, and that is a product call.**

## A1 🔴 A fake production credential is still shipping

`src/components/ServerSyncArchitecture.tsx:146` mints
`` `gf_live_ionity_${Math.random().toString(36).substring(2, 9)}` `` on a button press
and renders it into a field labelled **"API Token"**, with no simulated marker.

This is the single most important survivor of the merge, because **three separate
documents have now flagged it and it is still there**: the 2026-08-18 scan (§4.2), the
2026-08-24 status report (line 255), and the 2026-08-24 dependency map (line 169).

It also contradicts a claim made two days ago. `PIN-2026-09-10.md` records *"Remove
every simulated data path: offline means dashes, not fiction"* and lists it as **Done**.
That sweep deleted `mockData.ts` and `mockAdapter.ts` and it did not reach this line.
A random string wearing a `gf_live_` prefix is exactly the class of thing `CLAUDE.md`
forbids: *no honest-looking screen showing invented data.*

`src/components/DeploymentScriptViewer.tsx` also survives from the same brochure set.
`DeviceOnboardingSimulator`, `ExportPackagingCenter` and `GateFlameKiosk` are gone.

> **Verdict: a one-line defect that has outlived three audits.** Not fixed here, because
> this was a documentation merge and shipping code is Dennis's call — but it should not
> survive a fourth.

## A2 🔴 `THIRD_PARTY_NOTICES.md` still does not exist

Specified in the 2026-08-14 backend record, re-raised in the endgame plan (5.8) and the
roadmap (2.5). `Test-Path THIRD_PARTY_NOTICES.md` → **false**.

The live question behind it: **Pi-hole is EUPL-1.2.** If a unit ships with Pi-hole
pre-installed on the image, its redistribution terms apply to the product, not just to
the repo. Two docs mention EUPL; none resolves it. FastAPI, uvicorn, psutil, httpx,
React, Recharts, motion and Capacitor all need listing too.

## A3 🔴 "Including yesterday's" is still unimplemented — the largest single item

End-game clause **E6** — *their phone shows them true numbers about it, including
yesterday's.* Searched today across `node-agent/` and `src/` for
`history/summary`, `telemetry_samples`, `query_rollup`: **zero matches.** The only
history on the box is `.DUMP/history/anomaly.jsonl` from `anomaly.py`, which is an
anomaly log, not a time series.

Every chart is still instantaneous polling. A reboot is still amnesia. The design was
specified twice in detail (endgame Phase 3, roadmap Sprint 4) and estimated at
**15 working days** — the biggest remaining engineering block in the product, and the
gate on the sentence that defines it.

Both specs agree on the shape, and both are worth reading before anyone starts:
six tables, SQLite, 60-second sampler, **a Pi-hole outage is a `NULL` row and never an
interpolation**, retention decided up front because retention is a POPIA input, and
bounded disk as a hard requirement — *an appliance that fills its own card is a returned
unit.*

## A4 🟡 `feed-receiver`'s 83 tests are still not in CI

`git grep 'feed-receiver' -- .github` → **no hits.** Raised 2026-08-18 (§4.2) and as
roadmap item 3.1.

This one has already cost real money in trust. `PIN-2026-09-10.md` records that
feed-receiver was **422-ing every real check-in for ten days** because the agent sends
`shield` and the strict schema forbade it — *"The contract test had been red for ten
days and nobody read it."* A test nobody runs is not a test. This is the fix for that
exact failure and it is three lines of YAML.

## A5 🟡 Ruff is still not a gate

`.github/workflows/ci.yml:189` — `continue-on-error: true`.

Unlike the others this is a **considered decision, recorded in the file**: making it
blocking today would turn CI red on arrival and teach everyone to ignore it. Carried
forward as a tracked intention rather than a defect — the commit that flips it to
`false` is the one that makes it real.

## A6 🟡 `mobile.html` renders in fallback fonts

Audit item 10, partially fixed. `index.html` ✅ · `kiosk.html` ✅ · `mobile.html` ❌ —
no font link and no `@font-face`. The phone is the primary surface.

## A7 🟡 `docs/LINKS.md` still pointed at the wrong network — **fixed in this merge**

The 2026-08-18 scan listed this as an open conflict: `LINKS.md` gave the node admin API
as `192.168.1.100` and a "secondary node" as `192.168.1.105`, while the real box has
always been on `192.168.0.10`. A different `/24` entirely.

Still wrong today, three and a half weeks later, at `LINKS.md:123-125`.
**Corrected as part of this merge** — see §5 of that file. `.env.example:16` and
`README.md:111` still use `192.168.1.105` as an illustrative example; left alone
deliberately, since an example address that cannot be confused with the real one is
arguably the safer choice, but flagged here so the decision is conscious.

## A8 🔴 The only copy of the lost Docker backend is still one file on one machine

`C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\E-App-SAFETY-2026-08-16.bundle`
— **344.4 MB**, confirmed present today. Three commits (`105629a → 09ec6d3`): a FastAPI
backend, `containerManager.js`, `Dockerfile`, `docker-compose.yml`, a network scanner
and Pi-hole polling. **None of those SHAs exist on GitHub.**

The 2026-08-18 recommendation was to extract the ~200 KB of actual source into
`docs/archive/lost-backend/` and then let the bundle go. `Test-Path E:\Gateflame\docs\archive`
→ **false.** Never done.

It is 344 MB because `.jdk`, `.gradle`, `node_modules` and `dist-*` were committed into
it. One disk failure and three commits of real work are gone — for the second time in
this project. The nine smaller bundles beside it were verified in August as fully
contained on `origin/main` and are genuinely redundant.

## A9 🔴 Credentials: three still live, one keystore still unbacked

Open since **2026-08-14**, restated in `DENNIS-OUTSTANDING-ACTIONS.md` §3, unchanged:

| Item | State today |
|---|---|
| Two GitHub PATs pasted into chat 2026-08-14 | Unrevoked |
| `GEMINI_API_KEY` | Unrotated |
| `C:\Users\DGMic\TempGateFlameBuild\.env.local` | **Confirmed present today** — a live plaintext copy of that key, and the 2026-08-18 finding that `ROTATE-ME.txt`'s *"this is the only copy left"* was false. It is also inside two zip archives |
| `~/.gateflame-signing/gateflame-release.jks` | Exists; **no second copy, no recorded SHA-256 fingerprint** |

Rotating the key at Google makes every stale copy moot in one action, which is why it
is the first move rather than hunting the copies.

## A10 🟡 Branch protection on `main`

Endgame 0.9 and roadmap 0.5. Cannot be verified from here — it needs the repo settings
page. Worth thirty seconds of checking, given that `86deb08` (an unrelated root merged
straight into the release branch, carrying files the project's own rules forbid) is
precisely what it prevents.

## A11 🟢 The rules that earned their place in `CLAUDE.md`

Three standing rules were extracted from these documents and written into `CLAUDE.md`
during this merge, because each one cost something once:

1. **`revoke_all` must never clear `provisioned`.** A lost phone must not re-arm
   first-boot admin. Already correct in code (`storage.py:450`) and pinned by
   `test_pairing.py:92` — but the *reason* lived only in the archived backend record.
2. **Nothing binary that arrived down a text-mode path can be trusted.** Three separate
   binaries were destroyed this way: 26 Android PNGs, `gradle-wrapper.jar`, and a 1.2 MB
   release tarball that was 68.5% U+FFFD. `.gitattributes` and the CI magic-byte gate
   close it mechanically; the rule states why they must never be removed.
3. **Prove the push path before starting work that must be pushed.** `git ls-remote`
   succeeding proves nothing — a public repo needs no credential to read. Only `git push
   --dry-run` reveals the block, and the last time this was learned the diagnosis came
   ~7,500 lines too late.

---

# PART B — SPECIFIED THERE, SPECIFIED NOWHERE SINCE

Not defects. Work that exists in no other document in this repo, and would have been
lost with the project.

## B1 The asset manifest

`archive-finishing-touches/GATEFLAME-ENDGAME-PLAN-2026-08-15.md`, Part 2 — written to
the brief *"leave nothing out, not even a jpeg."* It remains the only complete inventory
of what has to be drawn before this ships.

App icons are **done** (regenerated on-token 2026-09-10). Everything else has no
successor: Play Store feature graphic (1024×500, no alpha), phone and tablet
screenshots, the 512×512 store icon that is *not* the app icon, the monochrome themed
icon; the favicon set, OG card, architecture/topology/pairing diagrams; product box
artwork with dielines, quick-start card both faces, warranty card, regulatory label,
serial-number label template, enclosure silkscreen; product photography, device-framed
screenshots, spec sheet, press kit; and the in-app empty-state and error illustrations
that decide whether day one looks deliberate or broken.

Two details worth not rediscovering: adaptive-icon artwork must stay inside the
**66/108 safe zone** or launchers mask it off, and the Android 12+ `SplashScreen` API is
the recommended replacement for the ten `splash.png` files rather than regenerating them.

## B2 Regulatory and commercial ground that has never been touched

Searched the whole of `docs/` today: **ICASA — 0 mentions. Consumer Protection Act — 0
mentions. Serial numbering — 0 mentions.** Trademark appears once.

| Item | Why it is not optional |
|---|---|
| **ICASA type approval** | A networking appliance sold in South Africa either needs it or is exempt. Nobody has asked which |
| **CPA warranty** | Six-month implied warranty, and the customer elects repair / replace / refund. It shapes the RMA process, not just the paperwork |
| **Trademark "Gate^Flame"** | The `^` is unusual — check it is registrable and settle how the name is written in plain text before it is on a box |
| **Per-unit serial + provisioning record** | Serial, node ID, keystore fingerprint, ship date. Needed to revoke a stolen unit and to handle an RMA at all |
| **VAT / CIPC standing** | Registration threshold and invoicing, once units are sold |
| **Terms of sale** | No draft exists |

## B3 Manufacturing, from the 08-15 and 08-18 plans

BOM freeze; **NVMe over microSD** (a continuously-writing history database is the
likeliest 18-month failure mode, and every failure is an RMA); thermal validation at
**35 °C ambient** — a Gauteng summer in a closed cabinet, against a board that throttles
at 85 °C; enclosure with light-pipes and a button cutout; a 20-point per-unit QA
checklist; **24-hour burn-in per unit**; two suppliers each for board and PSU; and
pricing that carries a support and warranty reserve, with the recurring-revenue question
settled early because it changes the architecture.

## B4 The offline assistant, already scoped

`gateflame-two-tier-endgame.md` Part 3 splits it in two, and the split is the useful
part:

- **Job 2 — diagnostic repair guidance.** Needs no language model at all. `netcheck
  --json`, the module registry's `not_implemented` gaps and `posture.py`'s named
  remedies are **already structured deterministic data**. A decision tree over them is
  more reliable than an LLM, runs offline, costs nothing on a 2 GB board, and directly
  reduces the support calls the tier split exists to avoid. **Build this one.**
- **Job 1 — open-ended conversation.** On the base-tier board: not feasible; RAM is
  already spoken for by Pi-hole, Unbound and the agent. If it is wanted, it belongs in
  the **phone**, not the box.

The document's own closing read is worth keeping: *"guide setup and all minor issue
functionality repair" reads like job 2 is the real target and "chatbot" is the framing.*

---

# PART C — DECISIONS STILL UNANSWERED

Carried across because they were asked and never answered. All four are Dennis's.

1. **Confirm the base-tier board.** The two-tier doc resolves the old Pi 5 vs Orange Pi
   Zero 2W "contradiction" by pointing out it was never a contradiction — it was two
   products described as one. Base = Orange Pi Zero 2W class, flagship = Pi 5. Confirming
   it locks the BOM.
2. **Run `gateflame-netcheck.sh` check 4 against the actual house router.** Ten minutes.
   It determines whether the standard tier's upstream-forward model is a router settings
   change or a code change on real hardware — and it gates the rest of the base-tier
   design.
3. **Assistant scope** — job 2 only, or job 1 as well.
4. **Tier naming** — two product names, or one name with a `/Pro` suffix. It decides
   whether the app must detect and label which tier it is talking to, and it feeds the
   store listing.

---

# PART D — SKIPPED, BECAUSE THIS REPO IS ALREADY AHEAD

Each line was checked today. This is the "already improved" half of the instruction.

| Item from the old docs | Evidence it is done |
|---|---|
| Backend lost and unrecoverable; rebuild from spec | **Rebuilt and exceeded.** 43 route decorators in `node-agent/`, 634 tests passing. The spec listed 13 routes |
| Recovery Options A/B/C for the lost bundle | Obsolete — the doc marks itself SUPERSEDED, and the rebuild happened instead |
| Apache-2.0 headers contradict the LICENSE | Resolved — every SPDX header in `src/` now reads `LicenseRef-AED-900` |
| `package.json` says `react-example` / `0.0.0` / no repository | Now `gateflame` / `1.0.2` / repository set |
| Corrupt 1.2 MB release tarball served to the public | `git ls-files release/` → nothing tracked |
| Build output committed (`dist-*`, `release/`, `bun.lock`) | 0 tracked files across all six paths |
| Four conflicting Android application IDs | Frozen at `today.ionity.gateflame`; only one capacitor config remains, and the file carries the reasoning |
| `versionCode` hardcoded to 1; tag/name disagreement | `VERSION_CODE=14`, `VERSION_NAME=1.0.2`, matching tag `v1.0.2`, single source of truth documented in the file |
| No `.gitattributes`, no binary-integrity gate | Both present. `.gitattributes` covers 21 binary types; `ci.yml:75` and `release.yml:50` check magic bytes and scan for replacement characters |
| Kiosk scope inferred from the URL path | Fixed and pinned; `CLAUDE.md` carries the rule |
| 36 one-off codemod scripts at the repo root | Gone |
| `mockData.ts` / `mockAdapter.ts` | Deleted 2026-09-10 |
| `DeviceOnboardingSimulator`, `ExportPackagingCenter`, `GateFlameKiosk` | Gone (but see **A1** — two of the set survive) |
| CI runs zero tests | CI runs frontend and node-agent suites, builds all targets, asserts the Android ID in five places (but see **A4**) |
| `docs/KIOSK-REBUILD-PROMPT.md` spent | Deleted |
| Node address conflict `192.168.1.x` vs `192.168.0.10` | Settled at `192.168.0.10` everywhere that matters — `LINKS.md` was the last holdout, fixed here (**A7**) |
| Pi 5 vs Orange Pi Zero 2W "contradiction" | Not a contradiction — two tiers. Already encoded in `CLAUDE.md` and ADR-001 |
| Secondary DNS as a fallback | Explicitly rejected; bypass mode replaces it. Already in `CLAUDE.md` and `ADR-001` |
| Project memory's identity and workstation facts | **Rejected, not merged** — it conflates Dennis with the founder and gives the workstation as `.5`. See the archive README |

One loose end, neither carried nor skipped: **`DENNIS-DO-THIS.md` is still at the repo
root**, dated 2026-08-15, with steps 1–3 long complete. It was flagged as spent on
2026-08-18. It is cited by other checklists, so it wants extracting rather than deleting.

---

# PART E — CHATS: MERGED 2026-09-12

The conversation history was not in the local cache — only the nine documents synced
down — so this needed a signed-in browser. Dennis signed in and the pass was done.

**13 conversations, 2026-08-13 → 2026-08-25.** Three were read in full, chosen because
they were the newest and the likeliest to hold something the documents never captured.
The other ten were judged from their titles and their own auto-summaries, every one of
which describes a git-push or SSH-authorisation blocker — all long since resolved.
**That is a sampling, not an exhaustive read, and this section should not be taken as
proof that nothing else is in there.**

I was wrong about the yield. Part E previously predicted the gap would be small because
the documents are the distilled output of the chats. Five things came out that are in no
document, and two of them are rules rather than facts.

## E1 🔑 The router-credential decision, pinned in chat and written down nowhere

Decided in *Gate^Flame pi device setup and testing*: **one-time credentials, held in
memory, discarded after use.** Per-vendor adapters, guided fallback, and mandatory
verification.

What makes it worth keeping is the argument, because Dennis overturned the first one.
The original case was a threat-model case — router admin credentials on the box means
compromise the box, own the network. He rejected it: at home nobody cares about the
router password, and the realistic attacker is *a neighbour trying to steal Wi-Fi, not
someone physically breaking into your house*. That reasoning belongs to the business and
SIEM tier, not a household.

The conclusion survived on two entirely different grounds, and these are the ones to
quote:

1. **It is simpler.** No credential store, so no encryption-at-rest question, no "where
   does the key live on an SD card", no rotation. It is *less* code than storing them.
2. **POPIA.** Storing credentials makes them personal information you are processing —
   which drags in retention, breach notification, and a line in the privacy notice. Not
   storing them means none of that applies. On a product sold in South Africa that is a
   real cost avoided for free.

The one argument for storing — re-applying the setting after a router firmware update or
factory reset — is answered by the verification loop: the box notices queries stopped
arriving and prompts again.

> **Status against today.** `ADR-001` (2026-08-24) went *further* than this chat: the
> credentialed login is deliberately unbuilt, guided-only. So the "write per-vendor
> adapters" half is superseded. **The POPIA reasoning is not** — it is the strongest
> written justification for never storing router credentials and belongs in the privacy
> notice.
>
> ⚠ The same conversation told Dennis to set the router's **DHCP** DNS to the box.
> `ADR-001` reversed exactly that four days later. Do not follow it.

## E2 📏 A rule the product depends on, stated in no document

From *Kiosk interface redesign and project status*, on the third round of a UI build
inventing policy text:

> **We are not permitted to describe what the filter blocks — only to display what it
> says it blocks.**

The node supplies the threat-level descriptions, the category labels, descriptions and
cautions, and the pause-duration labels. The UI renders them **verbatim**. The build had
written its own — "zero-trust: blocks newly registered domains", "aggressive ad
trackers" — which is *a security product telling a customer what it blocks based on a
guess*. That is the same class of error as a fabricated number, and it is arguably worse,
because it is a claim rather than a measurement.

**Added to `CLAUDE.md`.**

## E3 ✍ Copy that was argued over, and why

Three rewrites worth not undoing:

| Rejected | Shipped | Why |
|---|---|---|
| "Your family is safe" | **"Your network is filtered"** | The box filters DNS. It cannot make a family safe, *and that sentence would be quoted back at us* |
| "Intrusions and malicious queries are being dropped" | **"Malicious and unwanted domains are being blocked before your devices can reach them"** | We do not currently detect intrusions |
| — | Fault hero: **"Protection has failed over"** — *"the appliance detected a fault and fell back to unfiltered internet, so your connection still works — but nothing is being blocked"* | Says the true thing about a state that is easy to describe wrongly in either direction |

## E4 ⚠ `bypass` does not mean the filter is off

It means a watchdog detected a failure and fell back to unfiltered resolvers **so the
household keeps working internet**. Unprotected, but online.

- **Never show the raw token.** `BYPASS` means nothing to a customer. Display only:
  `active → PROTECTED`, `paused → PAUSED`, `bypass → UNPROTECTED`.
- **On bypass, do not render `reason`.** That field is the free text the owner typed when
  *pausing*; on a fault it is null and prints "Reason not reported by the node", which
  reads as though we failed to ask. A textbook instance of the rule already in
  `CLAUDE.md` — "cannot reach it" and "reached it, nothing there" must never share a
  sentence.

**Added to `CLAUDE.md`.**

## E5 Two API facts worth not rediscovering

- **Telemetry returns ONE `gap` for the whole payload**, not one per field. A type with
  `queriesGap` / `blockedGap` / `percentageGap` / `devicesGap` forces an adapter to
  fabricate three explanations per render.
- **There is no top-domains endpoint.** The console derives that list client-side from
  the threat entries it already has — which means *it can never disagree with the list
  printed below it*.

## E6 The pattern, which is the most transferable thing in the whole set

> "Three rounds, three inventions — first gap strings, then endpoints, now policy
> descriptions. It reliably fixes what you name and reliably invents in whatever you
> haven't named yet."

Assume the next unnamed surface is invented. That is precisely the failure a contract
test catches and a code review does not — and it is the same disease as **A1** in this
document, which sat in the tree for three and a half weeks because three audits named
the *number* and never named the *screen*.

## What was not new, and what is settled

- *Project review and next steps* (2026-08-22) is the two-tier document being written.
  Nothing in the conversation that is not in the file, which is already archived here.
- The ten unread conversations are push and SSH blockers — resolved; everything is on
  `origin` and the doctor confirms it.
- *App review and optimization* (2026-08-13) flagged **`.gitignore` as UTF-16LE**, which
  would mean git silently ignored nothing. **Resolved** — verified today by behaviour
  rather than by encoding: `git status` is clean with no `dist/` noise, so the file is
  being parsed and honoured.

---

# PART F — THE LOCAL SESSION EXPORT, 2026-09-12

Dennis exported a chat archive believing it held the Finishing-touches conversations.
**It did not.** Its metadata says `"project": "Gate^Flame Finishing touches"` but the line
below says `"source": "Claude Cowork local session transcripts"`, and the first chat in
the file is *this session* — message 1 is his own "merge this project" prompt from this
morning. Checked against all 13 Finishing-touches titles: twelve absent, and the one
apparent hit is a substring false positive (*Mobile connection issues diagnosis*
contains "connection issue").

So it is **this** project's own 28 local Cowork sessions. Mined anyway, because it is a
real corpus and nothing else holds it.

**What it actually contains**, since the headline numbers mislead: 6,701 messages, but
**77% of assistant turns (4,666 of 6,064) are `(called Read)` stubs**. 313 user turns, of
which 11 are machine-written "session is being continued" summaries accounting for 332K
characters. **302 messages genuinely typed by Dennis, 262K characters — all 302 read.**

---

## 🔴 F1 — THE SIGNING KEYSTORE WAS PASTED INTO A CHAT

In *Antigravity project documentation*, the **entire `gateflame-release.jks` was pasted
into the transcript as base64** — roughly 9KB of key material, and it is now also sitting
in the exported JSON in the uploads folder. The export's own redaction pass did not catch
it, because it is not credential-*shaped*; it is a file.

This project's own rule, from `docs/archive-finishing-touches/gateflame-backend-build.md`:
*"a credential that passed through a session transcript is compromised regardless of
whether anyone used it."*

**Scope honestly.** The keystore is passphrase-encrypted and the passphrase was never
typed into chat — `keytool` prompted for it locally every time. So this is not an
immediately usable key; it is offline-crackable key material outside its safe. Against
that: this is the **one artifact in the project with no recovery path**. Losing control of
it does not just leak a secret — whoever holds it plus the passphrase can sign something
Android will accept as a Gate^Flame update.

> **Decision for Dennis, and it is genuinely his:** the conservative move is to generate a
> fresh keystore *before* the first Play upload, while rotation still costs nothing. After
> the first upload it costs every installed device. Enrolling in **Play App Signing** at
> that first upload is what makes the upload key replaceable later, and is already on the
> blocking list in `CLAUDE.md`.

**Resolved by the same session:** the fingerprint that four documents record as "never
recorded" **was** captured on screen —
`SHA256: AB:F9:6D:F7:FF:E3:2F:FC:2D:A1:22:A4:B9:70:96:3E:1D:E8:C7:F8:D8:9A:D6:27:72:F6:1F:82:81:05:E2:7D`,
`SHA256withRSA`, CN `Gate^Flame`, O `Ionity (Pty) Ltd`, OU `AEDI`, Centurion ZA, valid to
2056-08-09. Worth recording properly *if* the keystore survives the decision above.

## 🔴 F2 — Two more credentials went through a transcript

The *RRIPS agent Devpost setup* session contains an `.env` heredoc with
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `OPENAI_API_KEY`. The export redacted
the values, which means the export did its job — and also means **the real values were in
the transcript before it did.**

These are for a different project, but they are Dennis's keys and they are **not** on the
standing revoke list, which covers only the two GitHub PATs and `GEMINI_API_KEY`. AWS keys
are the ones worth moving on first: a leaked pair gets found and used for compute.

---

## ⚠ F3 — A correction to a rule added earlier today

**`protectionStatus` has five values, not three.** Part E's E4 and the `CLAUDE.md` rule it
produced listed `active | paused | bypass`. The live box returned **`degraded`** twice on
2026-09-06, with a sixth field carrying the reason:

```
{"protectionStatus": "degraded", "enabled": false, "applying": false,
 "lastError": "Pi-hole unreachable"}
{"protectionStatus": "degraded", "lastError": "gravity rebuild failed"}
```

`applying` (a change is in flight) and `lastError` are part of the contract too. A UI that
switches on three states renders a fifth as nothing at all — the exact failure the rule
was written to prevent. **`CLAUDE.md` corrected.**

Also captured from the live payload, so the "display what it says, never write your own"
rule has its real data to point at: threat levels `low`/`medium`/`high` at 3/6/9
blocklists, and four categories — and the `fakenews` caution is the single best example of
the product's honesty principle anywhere in the codebase:

> *"This list reflects its maintainers' editorial judgement, not a technical measurement."*

## F4 — Facts that are now wrong in the live docs

| Doc says | Reality on 2026-09-06 |
|---|---|
| Fleet dashboard at `192.168.0.6:8080` | **`GATEFLAME_FEED_URL=http://192.168.0.3:8091/api/v1/nodes`** — moved to `.3`, port 8091, confirmed by a node install read-back |
| `40-pihole.conf` "was never written by the installer" (project memory) | **False.** It exists, dated 2026-08-24, carrying `GATEFLAME_PIHOLE_URL=http://127.0.0.1:8081` and the password |
| Base board is Orange Pi Zero 2W | **See F7** |

## F5 — Pi names that cost a session each time they were guessed

Every one of these produced an empty result or a "No such container" that looked like a
broken box:

- Containers are **`gateflame-pihole`** and **`gateflame-unbound`** — not `pihole`.
- The service is **`gateflame-node-agent.service`** — not `gateflame-agent`. Querying the
  wrong name returns an empty journal, which reads exactly like a silent agent. Also live:
  `gateflame-kiosk.service`, `gateflame-mdns-alias.service`.
- **`sqlite3` is not installed in the Pi-hole container.** Use
  `docker exec gateflame-pihole pihole-FTL sqlite3 …`.
- Pi-hole admin is on **:8081**, not :80.

**Added to `CLAUDE.md`.**

## F6 — "A timeout is not a failure"

The dial appeared to break after the blocklists grew. It had not. `"gravity rebuild
failed"` was a **client-side HTTP timeout**: the agent gave Pi-hole 30 seconds, hung up,
and reported failure — while Pi-hole finished the job and logged *"Gravity database has
been updated"*. At 347,905 domains the rebuild fit in 30s; at **3,081,748** it did not.

> *"That's why the dial worked before and is inert now: you made it work harder and it
> started 'failing'."*

Settled: **POST timeout = 3× the measured time, verify window = 10 minutes**, on a
background thread so the UI shows `applying` throughout. Already in the tree (`654dbf4`,
`6db09d5`); the rule now sits in `CLAUDE.md` with the trap that goes with it — a
`time pihole -g` measured **13.5s warm**, and sizing a timeout from a warm run
under-sizes the cold one by an order of magnitude.

---

## PART F.2 — Product decisions in his own words, recorded nowhere

### F7 🔴 The base board is not an Orange Pi Zero 2W

The two-tier document assumes one. The BOM Dennis actually priced, from
robotics.org.za, is a **Cubie A7A-6GB**, with the `XSG-0504000HEU` PSU and a 32GB card —
and he corrected a wrong quote to get there. **`gateflame-two-tier-endgame.md` §Part 4
item 1 is answered, and answered differently from how it was asked.**

### F8 ⚠ 6GB reopens the question ADR-001 closed

> *"how would this change and work if i was to say lets change it, because of radxa 6gb we
> can go inline and take over dns?"*

Unanswered in the transcript. It matters: ADR-001 dropped CLAIM from the standard box on
capability *and* load-shedding grounds, and the load-shedding argument does not care how
much RAM the board has. Worth answering explicitly rather than leaving it to drift.

### F9 The business model is a subscription, and that was an open roadmap question

> *"so that the clients devices Gate flame, connects itself with an api or what ever
> automatically - (forcefully) so that i can log status reports and provide customer
> services in order to charge a monthly fee ?"*
> *"please go ahead and start making our vpn feature thats super important that function
> alone justifies us asking a subscription"*

The roadmap says *"decide now whether there is a recurring component — it changes the
architecture."* **It is decided: yes.** The fleet control plane is not a convenience, it
is the billable surface.

### F10 VPN — what he ruled out, not just what he wants

Both of the cheap answers were rejected outright:

- Oracle Always Free, one country per account → **"Nope not gonna work"**
- Customers' own boxes volunteering as exit nodes for each other → **"nope"**

What he wants: country **and continent** choice, per-device rather than global on/off, on
**both** editions, under Ionity branding. WireGuard is the technical direction (stateless,
survives a Wi-Fi→5G handover, 12–18% less battery than OpenVPN). He called the `.ovpn`
hand-off to a third-party app *"rather dodgy"* — so a config handoff is not the finished
answer, and true in-app tunnelling needs native `VpnService` / network-extension work.

### F11 A fix the customer has to perform is not a fix

On being told the phone drops would stop if he turned IPv6 off on the router:

> *"NO no no no no no please no, this cannot be sold like this what are you thinking we
> cannot tell clients o yeah and turn of ip6 aswell as this and that"*

**Added to `CLAUDE.md`.** This is the rule the whole standard tier is built on, and the
`filter-AAAA` fallback exists precisely because of it — which is why the installer's own
text calls option 3 *"hides someone else's broken network. Prefer (1)."*

### F12 Per-device history is not wanted — a device list is

> *"i dont get why you need to filter each device if you just filter all the traffic at the
> main port coming in from outside and going out? … we just need a list of each device
> connecting to the router they are protected once you place the filter at the main point?"*

This **removes** the accepted cost in ADR-001 rather than merely tolerating it. Per-client
attribution was booked as a loss; he does not want the feature it would buy. A list of
connected devices is the requirement. Build to that and stop apologising for the rest.

### F13 IoniBot was scoped by him, and it matches the two-tier recommendation

> *"I said a chat bot not a live AI, it would really only be a question menue the customer
> could choose from, seeing as we only have 1 setup, a few possible problems and almost 0
> settings its a very small path way"*
> *"I only want it as a pop up or a tab on the Mobile App, not on the kiosk… basically a
> live instruction manual"*

That is exactly *job 2* from `gateflame-two-tier-endgame.md` Part 3 — the deterministic
decision tree, no model, runs on the cheapest board. **Part 4 item 3 of that document is
answered: job 2 only.** And the reason is his, not an engineering preference: *"so that I
do not need a call center."*

### F14 The fleet console, specified

Login; see every client online; open a device to support it; devices report in; deploy app
and kiosk builds from it; **hundreds of devices**, so "tools and stat graphs and admin
input". In the mobile VPN picker, **device names, not IPv6 tags**.

### F15 Mobile UX direction

> *"its way too cluttered, waaaay to many words on each screen… want a neat modern clean
> feel more animations that explains and shows things less words"*

---

## F16 — The finding that puts A1 in its proper light

Dennis told this project it was showing fake data **four separate times**, in four
different sessions:

| | |
|---|---|
| *Project status catchup* | uploaded a **video** — *"you said this is all live data and 500+ test verifies this is working… this is not real data and the device does nothing"* |
| *Antigravity* | *"you told me the dash is ready, look at that screen thats fake data"* |
| *Antigravity* | *"you need to re build this none of this is actually functioning"* |
| *Antigravity* | *"so i asked you if this was real live data, and yet clearly its not doing anything?"* |

He had to record a screen capture to be believed. That is the context in which **A1** —
a fabricated `gf_live_` credential still shipping on 2026-09-12, after three audits named
it — should be read. The rule was never the problem. Naming the *number* and never the
*screen* was.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
