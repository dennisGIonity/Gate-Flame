```
========================================================================================
GATE^FLAME — CARRY-OVER VERIFICATION: "FINISHING TOUCHES" INTO E:\Gateflame
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-09-020-VERIFY | Version: 1.0 | Updated: 2026-09-20 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# What this is

A re-check, on 2026-09-20, of the instruction *"every line of code, every policy, every
chat — make sure everything from the Gate^Flame Finishing touches project is carried
over here."*

**"Here" is `E:\Gateflame`.** It is the only repository that counts. Nothing in this
document treats any copy under `C:\Users\DGMic` as authoritative; where those copies are
mentioned it is only to record whether they still hold anything this repo does not.

**Method.** Nothing below is quoted from an existing document and passed on. Every claim
was re-executed against the working tree today — `git grep`, `git cat-file`, file reads,
and the three test suites actually run. Where a document and the tree disagreed, the
tree won and the disagreement is written down.

---

# THE SHORT ANSWER

**Yes — the Finishing-touches project is carried over, and it was carried over properly.**

It was merged on 2026-09-12 as commit `5ae59c4` *"Merge the Finishing-touches project:
archive it, carry what is still true"*. The audit trail is
`docs/MERGE-2026-09-12-finishing-touches.md` (709 lines) and the ten raw source documents
sit verbatim in `docs/archive-finishing-touches/`. Five of the eleven carried defects were
fixed the same day; four more have been fixed since.

**One thing is genuinely at risk, and it is not from the Finishing-touches project — it is
from the session that ran four days after it:** `docs/proof-2026-09-16/` (7 files,
~480 KB of live proof captures) has never been committed. It exists on this disk and
nowhere else.

---

# 1. REPOSITORY STATE, MEASURED TODAY

| Fact | Value |
|---|---|
| HEAD | `4d7b064` *Final testing pass: test report, capabilities doc, handover package* |
| HEAD date | 2026-09-15 20:39:29 +0200 |
| Branch | `fix/mobile-dns-drops` |
| Remote | `git@github.com:dennisGIonity/Gate-Flame.git` |
| Unpushed commits | **none** — `HEAD` and `origin/fix/mobile-dns-drops` are the same SHA |
| Ahead of `origin/main` | **37 commits** — PR #3 is still unmerged |
| Stashes | none |
| Working tree | clean, except the untracked `docs/proof-2026-09-16/` |

Everything committed is on GitHub. The exposure is not "unpushed work" — it is "work
never committed in the first place", which is a different and quieter failure.

## 1.1 Nothing is stranded in the C: drive clones

`C:\Users\DGMic\GateFlame-Repo` was checked commit-by-commit against this repo, because
`BUG-15` records an orphan commit living in one clone only. Every SHA it holds resolves
here:

| SHA | Present in `E:\Gateflame`? |
|---|---|
| `73e3056` break the import cycle that killed the mobile app on a real handset | ✅ |
| `c0c7563` the app could not reach a node at all, and ignored revocation | ✅ |
| `031a5bc` merge feat/kiosk-and-icons into main | ✅ |
| `de01ace` the backend suite needs `GATEFLAME_DB_PATH` | ✅ |
| `d127262` run the 548 tests that CI has never run | ✅ |

**`BUG-15`'s orphan-commit half can be closed.** The stale clones on `C:` hold no code
this repo lacks. The only thing on `C:` that this repo still does not have is the 344 MB
bundle in `A8` below — and that is a deliberate extraction that was never done, not an
accident.

---

# 2. THE ELEVEN CARRIED ITEMS, RE-TESTED

Part A of the merge record listed eleven things that were still true on 2026-09-12. Each
was re-run against the tree today. The evidence column is the command output, not a
recollection.

| | Item | State on 2026-09-20 | Evidence |
|---|---|---|---|
| **A1** | Fabricated `gf_live_` production credential | ✅ **FIXED** | `git grep gf_live_ -- src node-agent` returns two hits, both harmless: a comment in `ServerSyncArchitecture.tsx:25` describing the old defect, and the guard test's own docstring. `src/services/noFabricatedCredentials.test.ts` is present and passing |
| **A2** | `THIRD_PARTY_NOTICES.md` missing | ✅ **FIXED** | Present at repo root, 6,914 bytes |
| **A3** | On-box history — *"including yesterday's"* | 🔴 **STILL OPEN** | See §2.1 — this is the one people keep mis-closing |
| **A4** | `feed-receiver`'s 83 tests not in CI | ✅ **FIXED** | `.github/workflows/ci.yml:233` declares a `feed-receiver:` job; working-directory set at :257 and :263 |
| **A5** | Ruff not a gate | 🟡 **OPEN BY DECISION** | `ci.yml:189` still `continue-on-error: true`, with the reasoning at :187. Unchanged and deliberately so |
| **A6** | `mobile.html` in fallback fonts | ✅ **FIXED** | `mobile.html:21` preconnect, `:23` the Outfit / Plus Jakarta Sans / JetBrains Mono stylesheet |
| **A7** | `docs/LINKS.md` wrong `/24` | ✅ **FIXED** | The only `192.168.1.` strings left in `LINKS.md` are lines 130-139, which are the correction note explaining what was wrong |
| **A8** | 344 MB lost-backend bundle, one copy, one machine | 🔴 **STILL OPEN** | `Test-Path docs/archive/lost-backend` → **false**. The extraction recommended on 2026-08-18 has still never been done |
| **A9** | Credentials: 2 PATs, `GEMINI_API_KEY`, unbacked keystore | 🔴 **YOURS** | Nothing in the tree can close these |
| **A10** | Branch protection on `main` | 🟡 **UNVERIFIABLE HERE** | Repo settings page |
| **A11** | The three rules promoted into `CLAUDE.md` | ✅ **PRESENT** | `revoke_all`/`provisioned` at `CLAUDE.md:136`, pinned by `test_pairing.py::test_revoke_all_does_not_unprovision_node` at :141; `git push --dry-run` at :239; the binary-integrity rule and the Pi-name table at :259 |

## 2.1 A3 is still open, and `BUG-08` is not evidence that it is closed

This is worth stating plainly because the two look like the same thing and are not.

- **A3** is end-game clause **E6** — the box keeping a time series of its own queries so a
  phone can show *yesterday's* numbers. Searched today across `node-agent/`: there is no
  `history.py`, no `telemetry_samples` table, no `query_rollup`, and no `/history` route
  in `main.py`. The 32 Python modules under `node-agent/gateflame/` contain no such
  module. **Every chart is still instantaneous polling; a reboot is still amnesia.**
  Estimated twice at ~15 working days. It remains the largest single engineering item in
  the product.
- **`BUG-08`** — *"90-day retention never observed"* — is about **`feed-receiver`**, the
  server-side health-report store, and that code genuinely exists:
  `feed-receiver/gateflame_feed/config.py:43` (`retention_days: int = 90`),
  `storage.py:457` (`prune()`), `main.py:251` (`maybe_prune`).

Different subsystem, different data, different promise. Closing `BUG-08` will not close
`A3`, and nothing written so far says so out loud.

---

# 3. THE CODE ACTUALLY RUNS — MEASURED, NOT QUOTED

Every suite was executed today on this machine. These are run results, not figures copied
out of `TEST-REPORT-2026-09-15.md`.

| Suite | Command | Result |
|---|---|---|
| node-agent | `node-agent\.venv\Scripts\python.exe -m pytest tests -q` | **634 passed**, 11.00s |
| feed-receiver | `python -m pytest tests -q` | **83 passed**, 2.17s |
| frontend | `npx vitest run` | **198 passed**, 14 files, 4.11s |
| types | `npx tsc --noEmit` | **exit 0**, no output |
| | | **915 tests green, zero failures** |

Two things follow that the documents have not caught up with:

- The `634` in `TEST-REPORT-2026-09-15.md` reproduces **exactly**, five days later, on a
  cold run. The report is accurate.
- **`BUG-03` — "5 stale backend tests" — appears to be fixed.** The whole node-agent suite
  passes; there are no stale blocklist or fixture-drift failures left to find. It is still
  listed as open in `FUNCTION-STATUS-AND-BUGS.md`. Confirm and strike it.

A note on reproducing this, because it cost a detour: the backend suite **must** be run
from inside `node-agent/` using `node-agent/.venv`. Run it from the repo root against the
system Python and all 27 modules fail collection with `ModuleNotFoundError: No module
named 'gateflame'` — which looks like a broken suite and is not one. `BUG-01` fixed the
database-path half of this; the working-directory half is undocumented.

---

# 4. THE ONE REAL GAP

## 🔴 `docs/proof-2026-09-16/` has never been committed

Seven files, ~480 KB, produced by the session of 2026-09-16 — the live proof-of-function
captures taken against node `GF-72TYTITQ` at `192.168.0.10`:

```
01-node-system-status.png                  9,490    live /api/v1/system/status
02-node-feed-health.png                    7,077    BUG-07 route 404ing, honestly
03-node-services-modules.png               8,228    /api/v1/services refusing unauth
04-kiosk-remote-view.png                 209,025    the real "Protection status withheld"
05-fleet-dashboard-unauth-failclosed.png 236,687    dashboard failing closed
05-fleet-dashboard-authenticated-api.png   9,056    remoteControl:false, from the wire
README.md                                  5,885    what each capture proves
```

`git status` has carried these as `??` since the day they were made. They are not in any
commit, not on `origin`, and not in any backup. This is the only artifact in the project
that currently exists in exactly one place — the same condition `A8` has been sitting in
since August, and the same condition that has already cost this project a backend once.

The `README.md` in that folder is the valuable part: it is the only document that records
what was *not* provable that night and why — no mobile screens (ADB pairing expired), no
SSH captures (no key loaded), no GIFs (no recorder available). That honesty is exactly the
kind of thing that gets lost and then re-litigated.

**Action taken:** committed in this pass. See §7.

---

# 5. POLICY AND GOVERNANCE — WHAT IS ACTUALLY IN THE TREE

Checked as documents, not as titles.

| Policy surface | State |
|---|---|
| `CLAUDE.md` | 28,069 bytes. Carries all three rules promoted in the merge, plus the later corrections: `protectionStatus` as **five** states (`active/paused/bypass/degraded` + `applying`, `CLAUDE.md:161-163`), the render-the-node's-words-verbatim rule (:152), the IPv6 rule from *"we cannot tell clients turn off IPv6"* (:221), the Pi container/service name table (:259), the gravity-timeout trap (:217) |
| `docs/POPIA-REVIEW.md` | Present, and mirrored to `.docx` |
| `docs/PRIVACY-NOTICE.md` | Present (POPIA s18), `.docx` and `docs/web/privacy.html` alongside — the public URL Play will demand |
| `SECURITY.md`, `LICENSE`, `CONTRIBUTING.md`, `CITATION.cff` | All present at root |
| `THIRD_PARTY_NOTICES.md` | Present. The Pi-hole **EUPL-1.2** question is stated as unresolved rather than answered — correct, it is a lawyer's call, and it is still waiting |
| `docs/BASE-MODEL-DIRECTIVE.md` | Present |
| `docs/ADR-001-DNS-AUTHORITY-MODEL.md` | Present — the decision that still governs the DNS design |
| `docs/archive-finishing-touches/` | 10 documents, verbatim, with a README explaining what was rejected and why |

Nothing from the Finishing-touches policy set is missing. The gaps in this area are the
ones the merge record already named as *never written by anyone* — **B2**: ICASA type
approval, CPA warranty terms, the `Gate^Flame` trademark question, per-unit serial and
provisioning records, VAT/CIPC standing, terms of sale. A repo-wide search today still
returns **zero** mentions of ICASA and zero of the Consumer Protection Act. That is not a
carry-over failure; it is work that has never started.

---

# 6. WHAT IS STILL OPEN — THE CONSOLIDATED LIST

Ordered by what it costs to leave alone, not by age.

## Cannot be recovered if lost
1. **`docs/proof-2026-09-16/`** — one copy on one disk. *(Addressed in §7.)*
2. **`A8` / the 344 MB bundle** — three commits of the lost Docker backend
   (`105629a → 09ec6d3`), none of which exist on GitHub, sitting in one file on `C:`.
   The recommendation since 2026-08-18 has been to extract the ~200 KB of real source
   into `docs/archive/lost-backend/` and let the bundle go. Still not done.
3. **`A9` / `BUG-11` — the release keystore.** `gateflame-release.jks` has no second
   copy. Its SHA-256 *is* now recorded
   (`AB:F9:6D:F7:FF:E3:2F:FC:2D:A1:22:A4:B9:70:96:3E:1D:E8:C7:F8:D8:9A:D6:27:72:F6:1F:82:81:05:E2:7D`),
   which is worth something only if the file survives. And per **F1** the keystore was
   once pasted into a chat transcript as base64 — passphrase-protected, never used, but
   outside its safe. Generating a fresh one costs nothing *before* the first Play upload
   and costs every installed device after it.

## Live credentials, yours only
4. **`BUG-12`** — two GitHub PATs and `GEMINI_API_KEY`, still unrevoked, with a plaintext
   copy in `TempGateFlameBuild\.env.local` and inside two zip archives. Rotating at the
   provider makes every stale copy moot in one action.
5. **`F2`** — an `.env` heredoc in the *RRIPS agent Devpost setup* session carried
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `OPENAI_API_KEY`. Different project,
   same keyring, and **not on the standing revoke list**. Leaked AWS pairs get found and
   spent.

## Engineering, largest first
6. **`A3`** — the on-box history database. ~15 working days. Gates the sentence the
   product is sold on.
7. **`BUG-10`** — the DNS watchdog and IPv6 self-heal are written, tested and
   syntax-clean, and **still not deployed to the Pi**. This is the fix for phones dropping
   Wi-Fi. It is finished code sitting on a disk.
8. **`BUG-07` (narrowed)** — the feed-health route exists in this source and returns 404
   on the live box, because the Pi is not a git repo and nothing has been `scp`'d to it.
   `tools/install-pi-update.sh` is the path. `02-node-feed-health.png` is the picture of
   this exact gap.
9. **`BUG-06`** — the fleet server still does not survive a reboot;
   `tools\install-fleet-autostart.ps1` exists and has not been run.
10. **`BUG-04`, `BUG-05`, `BUG-09`, `BUG-16`, `BUG-17`** — carried unchanged.

## Decisions only you can make
11. **`F8` — inline on the 6GB board.** *"how would this change and work if i was to say
    lets change it, because of radxa 6gb we can go inline and take over dns?"* Still
    unanswered. `ADR-001` dropped CLAIM on capability **and** load-shedding grounds, and
    more RAM does not touch the load-shedding argument. A later session re-confirmed it
    was never answered and offered to answer it; the offer was not taken up. It is the
    oldest open question in the product and it decides the BOM.
12. **PR #3** — 37 commits, `fix/mobile-dns-drops → main`, still open. Merging is yours.
13. **`A5`** — the commit that flips ruff to `continue-on-error: false` is the one that
    makes the gate real.
14. **Part C of the merge record** — base-tier board confirmation (**`F7`** says the BOM
    you actually priced is a **Cubie A7A-6GB**, not the Orange Pi Zero 2W the two-tier
    document assumes), the ten-minute `gateflame-netcheck.sh` check 4 against the house
    router, assistant scope (**`F13`** answers this: job 2 only), and tier naming.

---

# 7. WHAT THIS PASS CHANGED

Two commits, both local. **Nothing was pushed** — `origin` is untouched and PR #3 is
exactly as you left it.

1. `docs/proof-2026-09-16/` — the seven untracked proof files, committed so they exist
   somewhere other than this disk's filesystem table.
2. This document.

To put them on GitHub when you want them there:

```
cd E:\Gateflame
git push origin fix/mobile-dns-drops
```

---

# 8. THE HONEST LIMITS OF THIS CHECK

- **Chats.** The Finishing-touches conversations were mined on 2026-09-12 and the result
  is Parts E and F of the merge record — and that document says of itself that Part E was
  *"a sampling, not an exhaustive read"* (3 of 13 conversations read in full). I did not
  re-open those conversations today; they are no longer reachable from here. Part F's pass
  over the 302 messages you actually typed **was** exhaustive, and that is the stronger
  half.
- **Local sessions after 2026-09-12** were reviewed for anything that never reached the
  repo. One finding: the most recent session answered a question about inline mode by
  retrieval and ended by offering to write the missing **`F8`** answer. That answer was
  never written. Everything else from those sessions is in `docs/`.
- **Nothing was verified against live hardware.** The Pi was not reachable from this
  session, no SSH key was loaded, and no phone was attached. Every statement above about
  the box is a statement about the source code and about the captures taken on
  2026-09-16 — not about what is running on `192.168.0.10` right now.
- **`A10` branch protection** cannot be checked without the repo settings page.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
