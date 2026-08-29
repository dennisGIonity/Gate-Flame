#!/usr/bin/env bash
# One-off: remove the loose scratch files earlier sessions left in C:\Users\DGMic.
# Only touches gf-*.sh / gf-*.cmd / gf-*.txt / GATEFLAME-*.cmd in the home folder
# itself - never a directory, never anything under .ssh, and never a repo.
set -uo pipefail
H=/c/Users/DGMic
n=0
for f in "$H"/gf-*.sh "$H"/gf-*.cmd "$H"/gf-*.txt "$H"/GATEFLAME-*.cmd "$H"/apply-gateflame-fixes.sh; do
  [ -f "$f" ] || continue
  rm -f "$f" && n=$((n+1))
done
echo "removed $n loose scratch file(s) from $H"
echo "remaining gf-* / GATEFLAME-* in home: $(ls -1 "$H"/gf-* "$H"/GATEFLAME-* 2>/dev/null | wc -l | tr -d ' ')"
echo
echo "NOT touched (correctly stays on C:):"
for p in "$H/.ssh" "$H/.gitconfig" "$H/.gateflame-signing" "$H/.gradle"; do
  [ -e "$p" ] && echo "  $p"
done
