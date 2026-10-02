#!/usr/bin/env bash
# Read-only: confirms docs/archive-finishing-touches is committed and on origin/main.
cd /e/Gateflame || exit 1
git fetch -q origin
echo "BRANCH: $(git branch --show-current)"
echo "Uncommitted changes in archive/inventory (blank = none):"
git status --porcelain -- docs/archive-finishing-touches docs/INVENTORY-REPOS-AND-FOLDERS-2026-09-25.md
c=$(git log -1 --format=%h -- docs/archive-finishing-touches)
echo "Last commit touching archive: $(git log -1 --format='%h %an %ad %s' "$c")"
if git merge-base --is-ancestor "$c" origin/main; then echo "On origin/main: yes"; else echo "On origin/main: NO"; fi
echo "Files tracked in archive: $(git ls-files docs/archive-finishing-touches | wc -l)"
echo "Remote branches containing $c:"; git branch -r --contains "$c"
echo "Upstream: $(git rev-parse --abbrev-ref @{u})"
echo "Unpushed commits on this branch:"; git log --format='  %h %ad %s' --date=short @{u}..HEAD
echo "HEAD vs upstream (ahead behind): $(git rev-list --left-right --count HEAD...@{u})"
