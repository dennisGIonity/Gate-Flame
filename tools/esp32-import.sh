#!/usr/bin/env bash
# esp32-import.sh - bring the ESP32 sibling repos local, read-only reference (no edits, no pushes).
set -u
out=/e/Gateflame/tools/esp32-import.last.txt
{
cd /e || exit 1
if [ -d /e/.Ionity-ESP32-Reporter/.git ]; then git -C /e/.Ionity-ESP32-Reporter fetch -q origin && echo "Reporter: fetched"
else git clone -q https://github.com/dennisGIonity/Ionity-ESP32-Reporter.git /e/.Ionity-ESP32-Reporter && echo "Reporter: cloned"; fi
git -C /e/.ESP32-MCP fetch -q origin 2>&1 | head -3
for r in /e/.ESP32-MCP /e/.Ionity-ESP32-Reporter /e/.IONITY-LAB; do
  echo "== $r"; git -C "$r" remote -v | head -1
  git -C "$r" status -sb | head -5
  git -C "$r" log --format='  %h %an %ad %s' --date=short -8
done
} > "$out" 2>&1
cat "$out"
