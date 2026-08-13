# Contributing to Gate^Flame Network Security Node

Governance: **Policy 986 AED** · Ionity (Pty) Ltd — AEDI

## Access

This repository is **public** — anyone can read and clone it.

Team members added as **collaborators** (Settings → Collaborators → Add people) have
**write** access and can push directly. Everyone else: fork the repo and open a pull
request.

## Clone

```bash
# HTTPS
git clone https://github.com/dennisGIonity/Gate-Flame.git

# SSH
git clone git@github.com:dennisGIonity/Gate-Flame.git

# GitHub CLI
gh repo clone dennisGIonity/Gate-Flame
```

## Everyday flow

```bash
git pull --rebase origin main
git checkout -b feat/short-description
# ...work...
git add -A
git commit -m "feat: short description"
git push -u origin feat/short-description
```

Then open a PR against `main`.

## Branch naming

| Prefix | Use for |
|---|---|
| `feat/` | new capability |
| `fix/` | bug fix |
| `docs/` | documentation only |
| `build/` | build chain, Capacitor, Gradle, Vite |
| `chore/` | housekeeping, deps |

## Commit messages

Conventional Commits: `type(scope): summary` — e.g. `fix(mobile): correct DNS chart scale`.

## Hard rules

1. **Never commit secrets.** No `.env`, `.env.local`, API keys, `google-services.json`,
   keystores, `keystore.properties`, or `*.pem`. `.gitignore` blocks these — do not
   override it. The release keystore is the one file in this project with no recovery
   path; see [`android/KEYSTORE.md`](android/KEYSTORE.md).
2. **Never commit build output.** `dist*/`, `release/`, `node_modules/`, `*.apk`, `*.aab`,
   `*.tar.gz`. Release binaries go to GitHub Releases — the `Release` workflow publishes
   them. A tarball tracked in git was once silently destroyed by a text decode and nobody
   noticed.
3. **Prove push access before you start.** If you are working in a sandbox, container or
   AI session, run `git push --dry-run origin HEAD` **first**. `git ls-remote` succeeding
   proves nothing — this repo is public, so anonymous read needs no credential. Only a
   push reveals whether one was injected. If push is refused, write every artefact to a
   real disk as you go, rather than to chat or an ephemeral workspace.

   > This rule exists because ~7,500 lines of backend were lost exactly this way: two
   > commits were made, the push 403'd, and the workspace was reclaimed before the work
   > was written anywhere durable.

4. **One Capacitor config.** `capacitor.config.ts` only. Never add a `.json` alongside it
   — `@capacitor/cli` resolves `.ts` first and silently ignores the `.json`, which made
   the old `build:apk-kiosk` a no-op for months.
5. **Bump `versionCode`** in `android/version.properties` (`npm run version:bump`) for any
   change that will reach a device. Android refuses an APK whose `versionCode` is ≤ the
   installed one, and uninstalling to work around it wipes the customer's node pairing.
6. Run `npm run lint` (`tsc --noEmit`) before pushing. CI runs it too, plus the build,
   tarball verification and a tracked-artefact check.
7. Anything carrying the AEDI header block keeps the header intact.

## Document standard

All formal documents follow the AEDI 2026 official template and carry the Policy 986 AED
header block. Reference: <https://www.ionity.co.za> · Primary: <https://www.ionity.today>

© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
