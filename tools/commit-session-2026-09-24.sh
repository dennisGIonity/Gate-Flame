#!/usr/bin/env bash
# Commit this session's docs + tools with the repo's configured identity. No push (key not loaded), no identity flags.
set -u
cd /e/Gateflame || exit 1
out=tools/commit-session.last.txt
{
[ -f .git/index.lock ] && ! tasklist 2>/dev/null | grep -qi '^git.exe' && rm -f .git/index.lock && echo "removed stale index.lock"
echo "identity: $(git config user.name) <$(git config user.email)>"
git add CLAUDE.md docs/PIN-2026-09-21.md docs/STATUS-2026-09-24-where-we-are.md docs/ESP32-PARTS-INVENTORY-2026-09-24.md \
  tools/lab-probe.ps1 tools/lab-pi-id.ps1 tools/lab-resume-gateflame.sh tools/LAB-RESUME-GATEFLAME.cmd \
  tools/esp32-survey.sh tools/esp32-import.sh tools/history-dump.sh tools/push-if-key.sh tools/commit-session-2026-09-24.sh
git status -sb | head -30
git commit -q -m "Lab move: status 2026-09-24, ESP32 parts inventory, LAB-RESUME-GATEFLAME (refuses off-lab), lab probes; CLAUDE.md points at the H3C lab" && git log -1 --format='%h %an <%ae> %ad %s'
git status -sb | head -1
} > "$out" 2>&1
cat "$out"
