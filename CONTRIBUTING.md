# Contributing to Gate^Flame Network Security Node

Governance: **Policy 986 AED** · Ionity (Pty) Ltd — AEDI

## Access

This repository is **public** (anyone can read and clone). Members of the
**Ionity-Global** organisation have **write** access and can push directly.
External contributors: fork the repo and open a pull request.

## Clone

```bash
# HTTPS
git clone https://github.com/Ionity-Global/Gate-Flame.git

# SSH
git clone git@github.com:Ionity-Global/Gate-Flame.git

# GitHub CLI
gh repo clone Ionity-Global/Gate-Flame
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
   keystores, or `*.pem`. `.gitignore` blocks these — do not override it.
2. **Never commit build output.** `dist*/`, `release/`, `node_modules/`, `*.apk`, `*.aab`.
3. Run `npm run lint` (`tsc --noEmit`) before pushing.
4. Anything carrying the AEDI header block keeps the header intact.

## Document standard

All formal documents follow the AEDI 2026 official template and carry the Policy 986 AED
header block. Reference: <https://www.ionity.co.za> · Primary: <https://www.ionity.today>

© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
