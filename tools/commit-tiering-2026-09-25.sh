#!/usr/bin/env bash
# Commit the tiering plan (T1-T4 x Standard/Premium) on the working branch, ff main.
# Configured identity only. Push happens with tools\PUSH-2026-09-25.cmd.
set -u
cd /e/Gateflame || exit 1
[ "$(git config user.name)" = DennisIonity ] || { echo "WRONG IDENTITY"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = fix/mobile-dns-drops ] || { echo "wrong branch"; exit 1; }
git add docs/TIERING-PLAN.md CLAUDE.md tools/commit-tiering-2026-09-25.sh
git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
git commit -q -m "Tiering plan: T1-T4 x Standard/Premium; Standard T3 = Cubie A7A 6GB, Premium T3 = +crypto-wallet safeguarding, 16GB; T1 ESP32/Pico+MCP scoping; CLAUDE.md pointer" \
  && git log -1 --format='committed %h %an <%ae> %s'
git merge-base --is-ancestor main HEAD && git branch -f main HEAD && echo "main -> $(git rev-parse --short main)"
git log --branches --not --remotes --oneline
