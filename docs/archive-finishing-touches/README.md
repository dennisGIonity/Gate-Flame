```
========================================================================================
GATE^FLAME — ARCHIVE: "GATE^FLAME FINISHING TOUCHES" PROJECT KNOWLEDGE
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-09-012-ARCH | Version: 1.0 | Updated: 2026-09-12 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# ⛔ SUPERSEDED REFERENCE — NOT LIVE TRUTH

Everything in this folder is the **verbatim** knowledge set of the separate Claude
project **"Gate^Flame Finishing touches"** (project `019ffa8d-1f45-719f-88fd-e825e5d20e4d`),
merged into this repo on **2026-09-12**.

**Do not treat any file here as current.** They were written between **2026-08-13 and
2026-08-22**, against a tree that no longer exists. Several of them describe defects
that are fixed, a backend that was since rebuilt, and a recovery window that closed.

- **What survived the merge, and why:** `../MERGE-2026-09-12-finishing-touches.md`
- **What is true today:** `../PIN-2026-09-10.md` — that document wins over everything here.

## Why keep them at all

Three reasons, in order:

1. **The reasoning outlives the facts.** The audit's account of *how* a binary was
   destroyed by a text-mode pipe, and *why* `git ls-remote` succeeding proved nothing
   about push access, are still the clearest write-ups of those failures anywhere.
2. **They are the only record of what was lost.** The ~7,500-line backend that was
   never pushed is described nowhere else.
3. **Long-range product work was specified here and nowhere since** — the asset
   manifest and the two-tier split in particular.

## Contents

| File | Written | What it is | Status today |
|---|---|---|---|
| `gateflame-audit-2026-08-13.md` | 2026-08-13 | Full project audit at commit `86deb08`. 20 defects, 15 recommendations | **Mostly fixed.** 6 items still true — see the merge report |
| `gateflame-backend-build.md` | 2026-08-14 | Clean-room `node-agent` rebuild spec — modules, routes, security design | **Built and exceeded.** 43 routes live vs the 13 specified. Security invariants survived |
| `gateflame-unpushed-commits.md` | 2026-08-13 | Recovery instructions for the lost backend | **Obsolete.** Marked SUPERSEDED in its own header. Backend was rebuilt instead |
| `GATEFLAME-ENDGAME-PLAN-2026-08-15.md` | 2026-08-15 | Nine-phase plan to a shippable appliance + the full asset manifest | **Partly live.** Phases 0–2 largely done; the asset manifest has no successor |
| `GATEFLAME-STATUS-AND-ROADMAP-2026-08-18.md` | 2026-08-18 | Full scan + eight-sprint roadmap + a PC-wide redundancy audit | Superseded by `GATEFLAME-ROADMAP-2026-08-24.md`, **except** the PC audit and the 361 MB bundle finding |
| `gateflame-two-tier-endgame.md` | 2026-08-22 | The standard/premium product split, and the offline-assistant feasibility pass | **Live thinking.** Now encoded in `CLAUDE.md` and ADR-001; four decisions in it are still unanswered |
| `gateflame-links-index.md` | 2026-08-13 | Link index — AI Studio, Antigravity, Android Studio, GitHub | Superseded by `../LINKS.md`, **except** the AI Studio / Antigravity trajectory IDs |
| `gateflame-STATE-resume-here.md` | 2026-08-18 | A pinned state doc, v6.1 | **Superseded twice over.** Note this shares a filename with the live `docs/gateflame-STATE-resume-here.md` — they are different documents |
| `project-memory.md` | synced 2026-09-10 | The project's accumulated memory | **Carries two errors — see below** |

## ⚠ Two errors in `project-memory.md` that must not propagate

Read that file with these corrections in hand. They are the reason it was archived
under a different name rather than merged.

1. **It opens "Dennis (Johan Wilhelm van Antwerp)", conflating two people.**
   Dennis Grobler — *Wabakipi* — is the engineer at the keyboard, GitHub
   `dennisGIonity`, git identity `DennisIonity <dennis@ionitynetwork.onmicrosoft.com>`.
   Johan Wilhelm van Antwerp is the **founder**, and his name appears in document
   headers because that is the AEDI template. He is not a git identity. This exact
   conflation is what put 8 author identities into this repo's history and made one
   person's work look like two sessions racing each other — see `CLAUDE.md` Rule Zero.
2. **It gives the workstation as `192.168.0.5`.** Wrong twice over: the workstation is
   `192.168.0.7` and the fleet dashboard answers on `192.168.0.6`.

Its account of the DNS design, the no-secondary-DNS rule and the `NODE_ENV` traps is
sound, and all of it is already in `CLAUDE.md`.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
