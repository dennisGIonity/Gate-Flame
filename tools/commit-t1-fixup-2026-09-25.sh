#!/usr/bin/env bash
# Untrack a server log that slipped into the T1 commit, and ignore that class of file.
set -u
cd /e/Gateflame || exit 1
[ "$(git config user.name)" = DennisIonity ] || { echo "WRONG IDENTITY"; exit 1; }
git rm -q --cached t1/scripts/smoke-server.out.txt 2>/dev/null
rm -f t1/scripts/smoke-server.out.txt t1/scripts/smoke-server.err.txt t1/scripts/smoke.pid
git add t1/.gitignore tools/commit-t1-fixup-2026-09-25.sh
git commit -q -m "T1: untrack a smoke-test server log; ignore t1/scripts run output" && git log -1 --format='committed %h %an'
git merge-base --is-ancestor main HEAD && git branch -f main HEAD && echo "main -> $(git rev-parse --short main)"
git status --porcelain | head -5; echo "(status lines: $(git status --porcelain | wc -l))"
