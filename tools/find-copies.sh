#!/usr/bin/env bash
# find-copies.sh - read-only: every Gate^Flame checkout / copy on this machine and what it holds that E:\Gateflame lacks.
out=/e/Gateflame/tools/find-copies.last.txt
CANON=/e/Gateflame
{
echo "=== $(date -Is) ==="
echo "--- folders whose name looks like gateflame / finishing ---"
for base in /c/Users/DGMic /c/Users/DGMic/Documents /c/Users/DGMic/Desktop /c/Users/DGMic/OneDrive /c/Users/DGMic/Downloads /e /e/_ARCHIVE-2026-08-16 /e/_ARCHIVE-c-scratch-2026-08-25 /d /f; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 3 -type d \( -iname '*gate*flame*' -o -iname '*gateflame*' -o -iname '*finishing*' -o -iname 'gf-*' \) 2>/dev/null
done | sort -u > /tmp/gfdirs.txt
cat /tmp/gfdirs.txt
echo
echo "--- git repos among them ---"
git -C $CANON fetch -q --all 2>/dev/null
while read -r d; do
  [ -d "$d/.git" ] || [ -f "$d/.git" ] || continue
  [ "$(cd "$d" && pwd -W 2>/dev/null)" = "E:/Gateflame" ] && continue
  echo "== $d"
  git -C "$d" remote -v 2>/dev/null | head -2
  git -C "$d" log -1 --format='  head: %h %ad %an %s' --date=short 2>/dev/null
  # commits in this copy (any branch) not reachable from anything in canonical
  n=0
  for c in $(git -C "$d" rev-list --all 2>/dev/null | head -2000); do
    git -C $CANON cat-file -e "$c^{commit}" 2>/dev/null || { n=$((n+1)); [ $n -le 15 ] && git -C "$d" log -1 --format='  UNIQUE %h %ad %an %d %s' --date=short "$c"; }
  done
  echo "  unique commits: $n"
  git -C "$d" status --porcelain 2>/dev/null | head -15 | sed 's/^/  dirty: /'
  echo "  dirty count: $(git -C "$d" status --porcelain 2>/dev/null | wc -l)"
done < /tmp/gfdirs.txt
echo
echo "--- non-git folders among them (size, newest file) ---"
while read -r d; do
  [ -e "$d/.git" ] && continue
  echo "== $d  $(du -sh "$d" 2>/dev/null | cut -f1)  newest: $(find "$d" -type f -printf '%TY-%Tm-%Td %p\n' 2>/dev/null | sort | tail -1)"
done < /tmp/gfdirs.txt
echo
echo "--- canonical branches ---"
git -C $CANON for-each-ref --format='%(refname:short) %(upstream:short) %(upstream:track)' refs/heads refs/remotes
} > "$out" 2>&1
cat "$out"
