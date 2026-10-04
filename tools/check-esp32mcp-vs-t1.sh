#!/usr/bin/env bash
# Read-only: what is in E:\.claude\Ionity\.ESP32-MCP, and when, next to Gate^Flame's t1/.
d=/e/.ESP32-MCP
[ -d "$d" ] || { echo "no $d"; exit 0; }
cd "$d"
echo "== ESP32-MCP top level:"; ls
if [ -d .git ]; then
  echo "== remote: $(git remote get-url origin 2>/dev/null)"
  echo "== commits per day:"; git log --all --format=%ad --date=short | sort | uniq -c
  echo "== last 8:"; git log --all -8 --format='%h %ad %s' --date=short | cut -c1-120
  echo "== unpushed: $(git rev-list --count @{u}..HEAD 2>/dev/null)"
fi
echo "== files changed on/after 2026-09-27 (excluding venv/.git/node_modules):"
find . -type f -newermt 2026-09-27 -not -path '*/.git/*' -not -path '*venv*' -not -path '*node_modules*' -not -path '*__pycache__*' | head -20
