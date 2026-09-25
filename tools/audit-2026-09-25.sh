#!/usr/bin/env bash
# Gate^Flame - one-shot consolidation audit, 2026-09-25. READ-ONLY: changes nothing.
# For every git checkout of Gate-Flame on this machine, proves whether each local
# branch head, each stash and each tag already exists in the canonical repo
# (E:\Gateflame) AND on GitHub. "Exists" is tested by object id, not by date or name.
#   bash /e/Gateflame/tools/audit-2026-09-25.sh > /e/Gateflame/tools/audit-2026-09-25.last.txt 2>&1
set -uo pipefail
CAN=/e/Gateflame
URL=https://github.com/dennisGIonity/Gate-Flame.git
echo "=== $(date -Iseconds) ==="

echo "--- GitHub refs (anonymous ls-remote) vs canonical local refs ---"
git ls-remote --heads --tags "$URL" | grep -v '\^{}' | sort -k2 > /tmp/gf-remote.txt
( cd "$CAN" && git for-each-ref --format='%(objectname) %(refname)' refs/heads refs/tags | sed 's# #\t#' | sort -k2 ) > /tmp/gf-local.txt
while IFS=$'\t' read -r sha ref; do
  r=$(awk -v R="$ref" '$2==R{print $1}' /tmp/gf-remote.txt)
  if [ -z "$r" ]; then echo "  LOCAL-ONLY  $ref $sha"
  elif [ "$r" = "$sha" ]; then echo "  same        $ref ${sha:0:7}"
  else echo "  DIFFERS     $ref local=${sha:0:7} github=${r:0:7}"; fi
done < /tmp/gf-local.txt
while IFS=$'\t' read -r sha ref; do
  grep -q "	$ref\$" /tmp/gf-local.txt || echo "  github-only $ref ${sha:0:7}"
done < /tmp/gf-remote.txt

echo "--- canonical: working tree, stashes, identity ---"
( cd "$CAN" && git status --porcelain | grep -v '^?? tools/.*\.txt$' ; echo "  (untracked tools/*.txt logs: $(git status --porcelain | grep -c '^?? tools/.*\.txt$'))"; git stash list; echo "  identity: $(git config user.name) <$(git config user.email)>" )

echo "--- every clone on E: and C:\\Users\\DGMic (maxdepth 4) ---"
find /e /c/Users/DGMic -maxdepth 4 -type d -name .git 2>/dev/null | while read -r g; do
  d="$(dirname "$g")"
  git -C "$d" remote -v 2>/dev/null | grep -qi 'Gate-Flame' || continue
  [ "$d" = "$CAN" ] && continue
  echo "== $d"
  missing=0
  while read -r sha ref; do
    if git -C "$CAN" cat-file -e "$sha^{commit}" 2>/dev/null; then
      on=$(git -C "$CAN" branch -r --contains "$sha" 2>/dev/null | head -1 | tr -d ' ')
      echo "   ${ref#refs/} ${sha:0:7} in-canonical  on-github:${on:-NO}"
      [ -z "$on" ] && missing=$((missing+1))
    else
      echo "   ${ref#refs/} ${sha:0:7} NOT IN CANONICAL"; missing=$((missing+1))
    fi
  done < <(git -C "$d" for-each-ref --format='%(objectname) %(refname)' refs/heads refs/stash 2>/dev/null)
  n=$(git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "   dirty files: $n   refs not safely on github: $missing"
done
echo "=== done ==="
