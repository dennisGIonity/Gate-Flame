```
========================================================================================
GATE^FLAME — REPO HYGIENE FIX: APPLY INSTRUCTIONS
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-FIX | Version: 1.0 | Updated: 2026-08-13 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Apply the fix — findings B and C

This folder holds everything needed. **The commit is already fetched into this
repository** — it is sitting on branch `chore/repo-hygiene`. All that remains is the
push, which the Claude session could not perform (the git proxy refused a credential
for `dennisGIonity/Gate-Flame`, HTTP 403 — the same refusal that stranded the backend).

## Files here

| File | What it is |
|---|---|
| `gateflame-repo-hygiene.bundle` | Verified git bundle containing commit `7eb0d30`. Base `97c6c4c`. Already applied — kept as the durable backup. |
| `GateFlame-Complete-Package.tar.gz` | The **rebuilt, valid** release package. 540,118 bytes, magic `1f 8b 08 00`, `gzip -t` clean, 0 × U+FFFD, extracts to 12 files. |
| `APPLY-FIX.md` | This file. |

## Step 1 — push

From `C:\Users\DGMic\GateFlame-Repo`. Fetch first — this clone's `origin/main` is stale
at `97c6c4c` and does not yet know about `86deb08`:

```bash
git fetch origin
git push -u origin chore/repo-hygiene
```

Then open a PR against `main` (this is what `CONTRIBUTING.md` asks for).

**Or**, to skip the PR — `7eb0d30`'s parent *is* the current remote `main` (`86deb08`),
so it fast-forwards cleanly:

```bash
git fetch origin
git checkout main
git reset --hard origin/main        # this clone is behind; catch it up first
git merge --ff-only chore/repo-hygiene
git push origin main
```

> `git reset --hard` here is safe: this clone has no local commits on `main` — it is
> simply 2 commits behind the remote. The only local modification is
> `android/gradlew.bat`, which is untouched by the reset target. If you want to keep
> that change, `git stash` it first.

### Housekeeping already done for you

`_fix-2026-08-13/` and `*.bundle` were added to `.git/info/exclude` (local-only, never
committed) so a stray `git add -A` cannot sweep these artefacts back into the repo —
which is precisely the mistake being undone here. `git status` is clean apart from your
pre-existing `android/gradlew.bat` edit.

A second copy of all three files lives in
`C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\`. Once you have pushed, the
copy inside `GateFlame-Repo\` can be deleted — the session could not remove it itself,
as the file bridge is read-append only.

## Step 2 — publish the tarball properly

Do **not** commit `GateFlame-Complete-Package.tar.gz` back into the repo — that is what
went wrong the first time. Attach it to a GitHub Release instead:

<https://github.com/dennisGIonity/Gate-Flame/releases/new>

Tag it `v1.0.0`, attach the tarball from this folder, publish.

## Step 3 — verify

```bash
git ls-files | grep -E "^(dist|release|bun.lock)"    # expect: no output
git log --oneline -1                                 # expect: 7eb0d30
npm run lint                                         # expect: exit 0
```

## What commit 7eb0d30 changes

**Removes** (15 files, all previously added by the bad merge `86deb08`):

- `release/GateFlame-Complete-Package.tar.gz` — corrupt, unsalvageable
- `dist-kiosk/` (5 files) — stale React **development** builds
- `dist-mobile/` (6 files) — same
- `dist-standalone/` (2 files) — cannot be reproduced by any script in the repo
- `bun.lock` — tracked despite `.gitignore:14`, drifting against `package-lock.json`

Every one is already covered by `.gitignore`, so nothing else was needed.

**Adds** `.gitattributes` — marks `*.tar.gz`, `*.zip`, `*.apk`, `*.aab`, `*.keystore`,
images, fonts and media as `binary`. This is the direct guard against the failure that
destroyed the tarball: a binary normalised as text. Also pins `eol=lf` on shell scripts
and `gradlew`, `eol=crlf` on `gradlew.bat`.

**Fixes** `package.json`:

- `build:html-mobile` / `build:html-kiosk` ended with
  `cp dist-<target>/<page>.html dist/index.html` — writing `index.html` into `dist/`
  rather than the directory Capacitor's `webDir` points at. Untracking the stale
  artifacts without this fix would have left `cap sync` with a webDir containing **no
  `index.html`**, and the APK would have loaded a blank screen. Both now write
  `dist-mobile/index.html` and `dist-kiosk/index.html`, and `rm -rf` the target first so
  stale hashed assets cannot accumulate.
- `clean` removed only `dist/` and `server.js`; it now clears `dist-mobile/`,
  `dist-kiosk/`, `dist-standalone/` and `release/` too.

## Verified before delivery

| Check | Result |
|---|---|
| `tsc --noEmit` | clean, exit 0 |
| `npm run package:release` | exit 0 |
| tarball magic bytes | `1f 8b 08 00` |
| `gzip -t` | OK |
| U+FFFD count in tarball | **0** (was 282,516) |
| tarball extract round-trip | OK, 12 files |
| `dist-mobile/index.html` | present |
| `dist-kiosk/index.html` | present |
| `git bundle verify` | okay |

## Finding A — the backend

Not fixable from here. The `node-agent/` backend does not exist in the remote, in any
of the 218 git objects in the repo's history, or anywhere on this machine — `Downloads`,
`GateFlame-Repo`, `GateFlame-Backup-2026-08-13` and all 14 `antigravity` workspaces were
searched. If the original Cowork conversation is still open, download
`gateflame-node-agent.bundle` from it and drop it in this folder. Otherwise it has to be
rebuilt from the specification in `claude/gateflame-backend-build.md`.

**The lesson worth keeping:** authorise the target repository in the session *before*
starting work. `git ls-remote` succeeding proves nothing — the repo is public, so
anonymous read needs no credential. Only `git push` reveals the block, and by then the
work exists only somewhere ephemeral.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```
