#!/bin/bash
# Read-only: dump commit timestamps/subjects/numstat for a date range, all branches.
# Usage: tools/worklog.sh [SINCE] [UNTIL] [OUTFILE]
SINCE="${1:-2026-08-25}"
UNTIL="${2:-2026-09-28}"
OUT="${3:-/e/Gateflame/tools/worklog.last.txt}"
cd /e/Gateflame || exit 1
git log --all --since="${SINCE}T00:00:00+02:00" --until="${UNTIL}T23:59:59+02:00" \
  --date=format-local:'%Y-%m-%d %H:%M' --format='@@%ad|%an|%s' --numstat > "$OUT" 2>&1
echo "lines: $(wc -l < "$OUT")  commits: $(grep -c '^@@' "$OUT")"
