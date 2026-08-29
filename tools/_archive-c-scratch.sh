#!/usr/bin/env bash
# Move (never delete) the remaining loose scratch out of the home folder.
#
# ARCHIVED, NOT DELETED, ON PURPOSE. We are in the middle of fixing a
# losing-work problem; this is the worst possible moment to start removing
# files nobody has read. They go to E: so C: is clean and nothing is gone.
set -uo pipefail
H=/c/Users/DGMic
DEST=/e/_ARCHIVE-c-scratch-2026-08-25
mkdir -p "$DEST"
n=0
while IFS= read -r f; do
  mv -n "$f" "$DEST/" 2>/dev/null && n=$((n+1))
done < <(find "$H" -maxdepth 1 -type f \( -name 'gf-*' -o -name 'GATEFLAME-*' -o -name 'apply-gateflame*' \) 2>/dev/null)
echo "archived $n file(s) -> $DEST"
echo
echo "loose scratch FILES left in the home folder: $(find "$H" -maxdepth 1 -type f \( -name 'gf-*' -o -name 'GATEFLAME-*' \) 2>/dev/null | wc -l | tr -d ' ')"
echo
echo "still on C:, and correctly so:"
for p in "$H/.ssh" "$H/.gitconfig" "$H/.gateflame-signing" "$H/.gradle"; do
  [ -e "$p" ] && echo "  $p"
done
echo
echo "dormant clones on C: - NOT touched, they hold unpushed commits:"
for p in "$H/GateFlame-Repo" "$H/gf-scratch" "$H/TempGateFlameBuild"; do
  [ -d "$p" ] && echo "  $p"
done
