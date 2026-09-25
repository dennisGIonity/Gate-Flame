```
========================================================================================
GATE^FLAME — INVENTORY: REPOSITORIES AND FOLDERS
Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-09-025-INV | Version: 1.0 | Updated: 2026-09-25 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# The rule this document enforces

**One repo, one working copy.** `https://github.com/dennisGIonity/Gate-Flame.git` is the
only Gate^Flame repository. `E:\Gateflame` is the only folder that gets edited. Every
other copy listed below is either a backup (keep), an archive (read-only), or a stale
checkout (safe to delete — proven below, not assumed).

Evidence for every "safe" call is in `tools/audit-2026-09-25.last.txt`,
`tools/audit-dennis-repo.last.txt` and `tools/audit-other-remotes.last.txt`, produced
by the scripts of the same name. Each branch head was tested **by object id** against
the canonical repo and GitHub — never by date, which is worthless on these copies (see
`C-DRIVE-RECONCILE-2026-09-20.md`).

---

# 1. Repositories

## 1.1 THE repo — `dennisGIonity/Gate-Flame` (public)

Checked 2026-09-25 09:37 SAST with an anonymous `git ls-remote`. **Local E:\Gateflame and
GitHub are identical on every branch and tag they share.**

| Ref | Commit | Role |
|---|---|---|
| `fix/mobile-dns-drops` | `9f07a9a` (2026-09-24) | **The working branch.** Everything current is here |
| `main` | `2bab789` | 1 commit behind the working branch, fast-forward only (fast-forwarded again with today's commit) |
| `archive/temp-build-scratch-2026-08-13` | `a7962f5` | Deliberate archive of the unversioned TempGateFlameBuild scratch |
| `chore/repo-hygiene`, `feat/kiosk-and-icons`, `feat/kiosk-console` | — | Historic, GitHub-only, **fully merged** (0 commits not in the working branch) |
| `fix/mobile-hookup`, `recovered/mobile-hookup`, `rescue/repo-c-fix/mobile-hookup` | `c0c7563` | Historic, GitHub-only, same commit ×3. Its 2 commits were checked hunk-by-hunk on 2026-09-24: one is patch-equivalent, the other's key hunks exist in the tree today |
| tags | `v1.0.2`, `desktop-v1.0.2`, `checkpoint-2026-08-30-main-synced`, `checkpoint-2026-08-30-verified` | Identical local/GitHub |

The six historic branches are harmless and are **left in place** (Rule Zero 4: never
rewrite or delete pushed history on a guess). Deleting them on GitHub is a tidy-up
Dennis can choose to do; nothing depends on it.

## 1.2 Other GitHub repos that touch this project — NOT Gate^Flame code

| Repo | What it is | Status |
|---|---|---|
| `dennisGIonity/Dennis` | The Antigravity-era repo (July–Aug 2026), before the move to Gate-Flame | **Retired.** All source is on GitHub under `archive/antigravity-workspace-2026-08-11` and `archive/dennis-working-copy-2026-08-09`. The one local commit not on GitHub (`09ec6d3`) differs from the pushed `949eae4` **only by two bundled JDK folders** (976 files, 0 source) — nothing to push. Its backend prior art is also extracted into `docs/archive/lost-backend/` |
| `dennisGIonity/Ionity-2nd-Router-Test-Lab` | The H3C isolated lab definition (`E:\.IONITY-LAB`, `lab.json`) | Separate on purpose — a lab, not the product |
| `Ionity-Global/ionity-assets-ionity-global-ionity-today` | AEDI document template + brand assets | Org-level; referenced, never edited from here |

---

# 2. The five folders Dennis named

| Folder | What is in it | Verdict |
|---|---|---|
| **`E:\Gateflame`** | The canonical working copy. 1.18 GB, 36,848 files incl. `node_modules`/builds. Identity `DennisIonity <dennis@ionitynetwork.onmicrosoft.com>` | **THE copy.** Only one that is edited |
| **`E:\Gateflame-KeystoreBackup`** | `20260831\gateflame-release.jks` + `cert-info.txt` | **Keep.** Byte-identical to the live keystore (SHA-256 `E52884D2…`) |
| **`E:\_KEYSTORE-BACKUP`** | Same two files, same date | **Keep.** Identical to the above. Two copies on the same disk are one copy against disk failure — see §4 |
| **`E:\_ARCHIVE-c-scratch-2026-08-25`** | 35 loose `gf-*.ps1` scripts moved off C: on 2026-08-25 | **Archive, read-only.** Superseded by `tools/`; kept because it costs nothing |
| **`E:\_ARCHIVE-2026-08-16`** | `App-antigravity-workspace` (1.59 GB, repo `Dennis`), `Dennis-working-copy` (13.7 MB, repo `Dennis`), `GateFlame-Repo-C-drive-retired` (282 MB, Gate-Flame clone), `Ionity-Delivery` (23 MB docs), `Ionity_Project_Gate^Flame` (152 MB business docs: quotes, invoices, planning), `ARCHIVE-MANIFEST.md` | **Archive, read-only.** Every commit in it is on GitHub (§1). The retired C-drive clone's 5 dirty files are `* - Copy.*` duplicates and one Gemini scratch script. The business docs are **not in git and must not be** — this folder is their only home besides the PServer/GDrive originals |

---

# 3. Everything else found on this machine

Found by `find` over `E:\` and `C:\Users\DGMic` (depth 4) plus the 2026-09-24 name scan.
**None of these holds a commit that is not on GitHub.**

## 3.1 Git checkouts of Gate-Flame (stale — safe to delete)

| Folder | Heads | Dirty | Verdict |
|---|---|---|---|
| `C:\Users\DGMic\GateFlame-Repo` | `main 031a5bc`, `fix/mobile-hookup c0c7563`, `chore/repo-hygiene 919856a` | 0 | Stale clone, all on GitHub. **Delete when ready.** ⚠ `CLAUDE.md` still says "mobile work in GateFlame-Repo" — that line is wrong since the 2026-09-20 carry-over and is corrected today |
| `C:\Users\DGMic\gf-scratch` | `main 70dda20`, `deploybundle 2f71d93` | 141 untracked one-off scripts | All commits on GitHub. The scripts were reviewed 2026-09-20 (the 5 useful helpers lifted out). **Delete when ready** |
| `C:\Users\DGMic\TempGateFlameBuild` | `archive/temp-build-scratch-2026-08-13 a7962f5`, `main 97c6c4c` | 0 | On GitHub. Mostly a Gradle cache. ⚠ Holds `.env.local` with an old API key (BUG-12) — **revoke the key first**, then delete |
| `C:\Users\DGMic\antigravity\Gate^Flame-Network-Security-Node*` (14 snapshots) | all `main 97c6c4c` | 2 carry `BacteriaPopGame.tsx` | IDE snapshots, all on GitHub. The one unique file is now preserved at `docs/archive/antigravity-untracked/BacteriaPopGame.tsx`. **Delete when ready** |

## 3.2 Not git, project-related

| Folder | What | Verdict |
|---|---|---|
| `C:\Users\DGMic\.gateflame-signing` | **The live release keystore** + cert-info | **Irreplaceable — keep** (CLAUDE.md Rule 6) |
| `C:\Users\DGMic\OneDrive\GateFlame-Signing` | Keystore copy (identical) | Keep — the only **off-machine** copy |
| `E:\.PServer\Google_Drive\GateFlame-Signing` | Keystore copy (identical) | Keep if it syncs to Google Drive — verify it does |
| `C:\Users\DGMic\GateFlame-Backup-2026-08-13` | 753 MB of zips/bundles | Verified contained 2026-09-20; redundant now that GitHub holds everything. Delete when ready |
| `C:\Users\DGMic\Downloads\GF Files` | Business archive (planning, parts quote) + an old `gateflame-fleet` copy | Business docs: keep. Fleet copy: superseded by `fleet/` |
| `E:\.PServer\Personal_Projects\GateFlame-Payload` | 5.2 MB deploy payload of 2026-08-15 (runbooks, a v6.0 state PDF, a 1.0.1 debug APK) | Historic; the runbooks are superseded by `docs/HANDOVER-*`. Keep or delete — no unique code |
| `C:\Users\DGMic\AndroidStudioProjects\GateFlame_Ionity`, `GateFlamev01` | July Android Studio experiments, no git | Pre-Capacitor prototypes. Delete when ready |
| `C:\Users\DGMic\AppData\Roaming\Gate^Flame` | The desktop (Electron) app's own profile | Leave — it is app data, not project files |
| `E:\opt\gateflame`, `E:\var\lib\gateflame` | Artefacts of running the agent locally on Windows (`state.db`) | Test residue. Delete when ready |
| `E:\Gateflame\VSCode` | An **empty nested `.git`** (no commits) inside the canonical tree, git-ignored | Harmless; delete the folder when convenient |

---

# 4. Signing keystore — five identical copies, one open problem

All five copies (`.gateflame-signing`, `E:\Gateflame-KeystoreBackup`, `E:\_KEYSTORE-BACKUP`,
OneDrive, PServer/GDrive) are **byte-identical** (SHA-256 prefix `E52884D2B73B26E4`). So
there is exactly one keystore, stored five times.

⚠ **Still open (manual task 01):** every `cert-info.txt` records
`Keystore was tampered with, or password was incorrect`. Five copies of a key nobody can
open are still zero usable keys. Before the first Play upload, open it once with the
password you set on 2026-08-17 (`keytool -list -keystore gateflame-release.jks`). If the
password is gone, generate a new upload key now — it is free before the first upload and
impossible after — and enrol Play App Signing at first upload.

---

# 5. Claude projects

| Project | Status |
|---|---|
| **Gate^Flame Finishing touches** (`019ffa8d…`) | **Fully captured → retire.** Documents: merged 2026-09-12, re-verified today by SHA-256 against the latest sync (2026-09-21) — identical, nothing new. Chats: all 8 exported today to `docs/archive-finishing-touches/chats/`. Deleting the project is done in the Claude app by Dennis — it cannot be done from inside a session |
| **Gate Flame official 6Gb Original + Ultimate Edition + Zero\Pico\ESP32 Light weight model** (`01a08c68…`) | **The project we continue in**, with `E:\Gateflame` as its folder |
| App Test Gate^Flame, Dennis Private Apk Test | July-era, no content beyond metadata / two small docs. Retire at will |

---

# 6. What was changed today, and what was not

**Changed (all committed to `fix/mobile-dns-drops`):** this inventory; the chat archive;
`BacteriaPopGame.tsx` preserved; three read-only audit scripts + their output; the chat
exporter; `.gitignore` now ignores `tools/*.last.txt` run logs (46 had piled up untracked
and they carry LAN detail); `CLAUDE.md` pointer + two corrected lines.

**Not touched:** nothing was deleted, moved or rewritten anywhere. Every "delete when
ready" above is a decision for Dennis. Suggested order when he makes it: revoke the
`TempGateFlameBuild\.env.local` key → run `tools\doctor.cmd` → delete §3.1 folders →
leave §2 and the keystore copies alone.
