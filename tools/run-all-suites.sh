#!/usr/bin/env bash
# run-all-suites.sh - the whole automated gate from Git-bash. Output -> tools/run-all-suites.last.txt
# node-agent pytest (its .venv), fleet + feed-receiver pytest, tsc, vitest, all three bundles, ruff, shell syntax.
unset NODE_ENV
C=/e/Gateflame; cd $C
out=$C/tools/run-all-suites.last.txt
PY=$C/node-agent/.venv/Scripts/python.exe
{
echo "=== run-all-suites $(date -Is) @ $(git rev-parse --short HEAD) ==="
echo "=== node-agent pytest ==="
(cd node-agent && GATEFLAME_DB_PATH="$(mktemp -d)/state.db" "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -25); echo "rc=${PIPESTATUS[0]}"
echo "=== fleet pytest ==="
(cd fleet && "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -8)
echo "=== feed-receiver pytest ==="
(cd feed-receiver && ls; "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -8)
echo "=== tsc ==="; npx tsc --noEmit 2>&1 | tail -20; echo "tsc rc=${PIPESTATUS[0]}"
echo "=== vitest ==="; npx vitest run --reporter=dot 2>&1 | tail -25
echo "=== builds ==="; grep -E '"build[^"]*":' package.json
for s in build build:kiosk build:mobile; do grep -q "\"$s\"" package.json && { echo "--- npm run $s"; npm run -s $s 2>&1 | tail -6; }; done
echo "=== ruff ==="; (cd node-agent && "$PY" -m ruff check . --statistics 2>&1 | tail -15)
echo "=== shell syntax ==="; for f in node-agent/*.sh tools/*.sh; do bash -n "$f" 2>&1 || echo "SYNTAX FAIL $f"; done; echo "shell check done"
echo "=== DONE ==="
} > "$out" 2>&1
tail -120 "$out"
