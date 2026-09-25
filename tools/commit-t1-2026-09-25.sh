#!/usr/bin/env bash
# Commit the T1 build (t1/ + tools wrappers + docs) on the working branch, ff main.
# Configured identity only, never force. Push with tools\PUSH-2026-09-25.cmd.
set -u
cd /e/Gateflame || exit 1
[ "$(git config user.name)" = DennisIonity ] || { echo "WRONG IDENTITY"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = fix/mobile-dns-drops ] || { echo "wrong branch"; exit 1; }
git add t1 tools/T1-SERVER.cmd tools/T1-BUILD-FLASH.cmd tools/commit-t1-2026-09-25.sh docs/TIERING-PLAN.md CLAUDE.md
echo "--- must be EMPTY (secrets / keys / data never staged):"
git diff --cached --name-only | grep -E 'server/data/|\.venv/|secrets\.h$|pubkey\.h$|\.pem$|secrets\.json' || echo "(none)"
git diff --cached --stat | tail -3
git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
git commit -q -m "T1 build: ESP32-S3 DNS filter (signed Bloom filters from the T3 threat-level lists, FFat persistence, T3 status vocabulary), Ionity T1 server on :8095 (builder, device API, dashboard, MCP t1_* + stdio bridge), build/flash/compile/sim scripts; 15 tests incl. C-vs-Python on the firmware headers; separate from ESP32-MCP" \
  && git log -1 --format='committed %h %an <%ae>'
git merge-base --is-ancestor main HEAD && git branch -f main HEAD && echo "main -> $(git rev-parse --short main)"
echo "--- unpushed:"; git log --branches --not --remotes --oneline
