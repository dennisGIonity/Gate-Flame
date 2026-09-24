#!/usr/bin/env bash
# consolidate-check.sh - read-only: remote branches not merged, stray files that canonical lacks.
C=/e/Gateflame
out=$C/tools/consolidate-check.last.txt
{
cd $C
echo "--- remote branches: commits not in fix/mobile-dns-drops ---"
for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v -e '^origin$' -e HEAD); do
  n=$(git rev-list --count fix/mobile-dns-drops..$b)
  echo "$b  unmerged=$n  last=$(git log -1 --format='%h %ad %s' --date=short $b)"
  [ "$n" -gt 0 ] && git log --format='    %h %ad %an %s' --date=short fix/mobile-dns-drops..$b | head -8
done
echo "--- main vs branch ---"; git rev-list --left-right --count main...fix/mobile-dns-drops
echo "--- TempGateFlameBuild unique commit ---"
git -C /c/Users/DGMic/TempGateFlameBuild show --stat --format='%h %s' a7962f5 | head -30
echo "--- antigravity BacteriaPopGame ---"
ls -la "/c/Users/DGMic/antigravity/Gate^Flame-Network-Security-Node/src/components/BacteriaPopGame.tsx"
ls $C/src/components | grep -i -e bacteria -e game
grep -rl BacteriaPop $C/src 2>/dev/null | head
echo "--- Downloads gateflame-fleet vs canonical fleet ---"
ls -la "/c/Users/DGMic/Downloads/GF Files/gateflame-fleet"
for f in $(cd "/c/Users/DGMic/Downloads/GF Files/gateflame-fleet" && find . -type f -not -path '*/__pycache__/*' -not -path '*/.venv/*'); do
  if [ -f "$C/fleet/$f" ]; then cmp -s "/c/Users/DGMic/Downloads/GF Files/gateflame-fleet/$f" "$C/fleet/$f" && s=same || s=DIFFERS; else s=MISSING-in-canonical; fi
  echo "  $f $s"
done
echo "--- GateFlame-Payload (PServer) files missing in canonical ---"
(cd /e/.PServer/Personal_Projects/GateFlame-Payload && find . -type f | head -200) | while read -r f; do [ -e "$C/$f" ] || echo "  missing: $f"; done | head -40
echo "--- gf-scratch untracked: which have no twin in canonical tools/ or archive ---"
for f in $(git -C /c/Users/DGMic/gf-scratch ls-files --others --exclude-standard); do
  b=$(basename "$f"); [ -e "$C/tools/$b" ] || [ -n "$(find /e/_ARCHIVE-c-scratch-2026-08-25 -name "$b" 2>/dev/null | head -1)" ] || echo "  unarchived: $f"
done | head -60
} > "$out" 2>&1
cat "$out"
