#!/usr/bin/env bash
# esp32-survey.sh - locate ESP32 / lab projects on this machine (read-only).
out=/e/Gateflame/tools/esp32-survey.last.txt
{
echo "=== E:\\ top level ==="; ls -la /e/ 2>&1
echo; echo "=== E:\\.IONITY-LAB ==="; ls -la /e/.IONITY-LAB 2>&1
echo; echo "=== candidate folders ==="
for d in /e/*/ /c/Users/DGMic/*/ /c/Users/DGMic/Documents/*/ /c/Users/DGMic/source/repos/*/; do
  case "${d,,}" in *esp32*|*reporter*|*ionity-lab*|*mcp*) echo "$d"; git -C "$d" remote -v 2>/dev/null | head -2; git -C "$d" log -1 --format='  last: %h %an %ad %s' 2>/dev/null;; esac
done
echo; echo "=== remote heads ==="
git ls-remote https://github.com/dennisGIonity/Esp32-MCP.git 2>&1 | head
git ls-remote https://github.com/dennisGIonity/Ionity-ESP32-Reporter.git 2>&1 | head
} > "$out" 2>&1
cat "$out"
