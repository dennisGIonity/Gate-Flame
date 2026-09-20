```
========================================================================================
GATE^FLAME — C: DRIVE RECONCILE: EVERY FILE CHECKED, THEN CLEARED
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Document ID: DOC-2026-09-020-RECON | Version: 1.0 | Updated: 2026-09-20 SAST
Governance: Policy 986 AED | Classification: INTERNAL
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
========================================================================================
```

# The instruction

*"Check each file and make sure the latest modification and version is in the original
E: drive file, anything else delete."*

# The method, because "latest modification" is a trap here

Modified-date is worthless on these copies. Everything in `TempGateFlameBuild` carries
`2026-08-13 10:43` — a single uniform timestamp from when it was extracted, not when
anything was edited. Twenty-five files there look **newer** than their E: counterparts
and every one of them is **older content wearing a fresh date**.

So each file was tested twice, on content, never on date:

1. **SHA-256 against every file in `E:\Gateflame`.** A match means the identical bytes are
   already here, whatever the path or the timestamp.
2. **`git hash-object` against every blob in this repo's history** — 908 objects. A match
   means this content was here at some point and was changed or deleted deliberately.
   Restoring it would undo a decision.

Only a file failing **both** tests can hold anything this repo does not have.

# The count

| | Files |
|---|---|
| Scanned on C: across 7 roots | **26,516** |
| Byte-identical to a file in E: | 990 |
| Older than their E: counterpart | 261 |
| "Newer" by date, older by content | 25 |
| Content found in E:'s git history | 95 |
| **Failed both tests — examined by hand** | **25,240** |

Of those 25,240, **24,817 are `.gradle_user`** — a Gradle download cache. That leaves
**423 files** actually worth a human decision, and they resolved into four groups.

---

# Group 1 — CARRIED INTO E: (committed today)

## 1a. The lost Docker backend — `docs/archive/lost-backend/`

`E-App-SAFETY-2026-08-16.bundle`, 361 MB. Its four heads were tested against this repo's
object database: **all four missing.** Commits `105629a9`, `c44c51b3`, `09ec6d34` —
Dennis's work from 2026-08-09 and 08-11 — existed on one disk in one file and nowhere
else on earth.

223 source files, 1.2 MB extracted: `server.js`, `securityAPI.js`, `networkScanner.js`,
`containerManager.js`, `Dockerfile`, `docker-compose.yml`, and the React/Android tree of
that era. Scanned for credentials before committing — all placeholders.

**This closes A8, open since 2026-08-18.**

The **nine other bundles** beside it were tested the same way and every head is already
in this repo. They are genuinely redundant.

## 1b. Operational runbooks — `docs/archive/ops-2026-08/`

Existed in no form in E:. `ssh-recovery.md` and `firstrun.sh` matter most — this project
has locked itself out of the Pi more than once, and those are the way back in.
Also `deploy-runbook.md`, `run-this-on-the-pi.md`, `apply-fix.md`, `sha256sums.txt`, the
State v6.0 document, and `ROTATE-ME.txt` **with its live token stripped** (see Group 4).

## 1c. Brand originals — `assets/brand-source/`

`eagle-logo.png` (5.3 MB), `ionity-logo.png` (1.2 MB), `logo-white.png` (1.1 MB). E: held
only the 89 KB derived `src/assets/brand/ionity-logo-dark.png`. The eagle had no
counterpart here at all.

## 1d. Five python helpers — `tools/`

`check-live-feed.py`, `preview-fleet.py`, `purge-test-nodes.py`, `test_enrolment.py`,
`md-to-docx.py`.

---

# Group 2 — SAFE TO CLEAR (nothing unique left)

| Location | Files | Why it can go |
|---|---|---|
| `C:\Users\DGMic\GateFlame-Repo` | 243 | A stale clone. All 5 of its head commits resolve here; its 16 "unique" files are generated `android/.../assets/*.js\|css` build output |
| `C:\Users\DGMic\gf-scratch` | 361 | An older checkout (HEAD `2f71d93`) with 141 dirty files. Its 143 uniques are 72 `.ps1` + 43 `.sh` + 12 `commitmsg*.txt` + 3 logs + 2 APKs — the one-off script class this repo deliberately purged in `e8fb63f`. The 5 useful python helpers were lifted out first |
| `C:\Users\DGMic\TempGateFlameBuild` | 25,755 | 24,817 are a Gradle cache. The rest is a pre-fork 2026-08-13 snapshot; its `src/` components are the ones deliberately deleted later and now preserved in `lost-backend/` anyway |
| `GateFlame-Backup-2026-08-13\*.zip` and the 9 contained bundles | ~24 | Verified contained. Includes `TempGateFlameBuild.zip` at **392 MB** and `E-App-SAFETY` at **361 MB** — once this repo is pushed, the second one is redundant too |

**Approximate reclaim: 1.3 GB**, the bulk of it those two zips plus the Gradle cache.

**Do not delete `E-App-SAFETY-2026-08-16.bundle` until `docs/archive/lost-backend/` has
been pushed to GitHub.** Until the push, the extraction lives on one disk — which is the
condition this whole exercise exists to end.

---

# Group 3 — MUST NOT BE DELETED

## 3a. The signing keystore — and a correction to `BUG-11`

```
C:\Users\DGMic\.gateflame-signing\gateflame-release.jks
C:\Users\DGMic\OneDrive\GateFlame-Signing\gateflame-release-2026-08-17.jks
SHA-256 of both: E52884D2B73B26E4E86377375C0CA7DA1AF418B4F259D7FC5489B0E6FAD19011
```

**Identical hashes. There are two copies, and one is off-machine on OneDrive.**

`BUG-11` says *"Release keystore has no verified backup... the file is not backed up."*
**That is now wrong, and it has probably been wrong since 2026-08-17.** Verified today by
hashing both. Update the bug rather than carrying it another month.

What stays true: the keystore is still the one artifact with no recovery path if *both*
copies are lost, and per **F1** it once passed through a chat transcript as base64.
Neither copy belongs in this repo — `tools/_cleanup-c-scratch.sh` already names
`.gateflame-signing` as correctly staying on C:, and that judgement is right. A keystore
in a git repository is a worse problem than a keystore on one disk.

## 3b. The business archive — `C:\Users\DGMic\Downloads\GF Files`

103 unique files, and **this is not repo material.** It holds invoices and quotes, the
PoC standard documents v0.3 through v0.5, the Ionity brand package with rendered videos
and slide decks, planning spreadsheets, product photography, and the
`Ionity_Project_Gate^Flame` business tree.

None of it is code and none of it belongs in a source repository. **It should be backed
up, not deleted, and not moved here.** The one duplicate inside it — `gateflame-fleet/` —
is superseded by `E:\Gateflame\fleet\`.

---

# Group 4 — THE THING THIS RECONCILE ACTUALLY FOUND

`C:\Users\DGMic\TempGateFlameBuild\.env.local`, 105 bytes, still holding the
`GEMINI_API_KEY` in plaintext.

On 2026-08-13 a session wrote `ROTATE-ME.txt` declaring *"All 14 copies are now the
.env.example placeholder. This is the only copy left."* On 2026-08-18 that was found to
be false. **Today, thirty-eight days later, it is still false** — `.env.local` is still
there, still plaintext, and the "only copy" note itself was still carrying the live token
on its last line when I picked it up.

That token was **not** committed. The note was carried in redacted, with the original path
recorded so the key can be identified at Google and then revoked.

> **Revoke at the provider. Do not hunt the copies.** Hunting has now failed twice, and a
> deletion sweep that removes `.env.local` without revoking first destroys the evidence of
> which key to revoke while leaving the key itself valid.

**Order matters: revoke first, then clear.**

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
Anything is Possible with God.
```
