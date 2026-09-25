#!/usr/bin/env bash
# READ-ONLY: is every local commit of the old dennisGIonity/Dennis.git checkouts on GitHub?
set -uo pipefail
for d in /e/_ARCHIVE-2026-08-16/App-antigravity-workspace /e/_ARCHIVE-2026-08-16/Dennis-working-copy; do
  echo "== $d"
  git -C "$d" ls-remote https://github.com/dennisGIonity/Dennis.git > /tmp/dr.txt 2>/dev/null
  for sha in $(git -C "$d" for-each-ref --format='%(objectname)' refs/heads); do
    hit=""
    while read -r rsha rref; do
      [ "$rref" = HEAD ] && continue
      if git -C "$d" cat-file -e "$rsha^{commit}" 2>/dev/null && git -C "$d" merge-base --is-ancestor "$sha" "$rsha" 2>/dev/null; then hit="$rref"; break; fi
    done < /tmp/dr.txt
    echo "   ${sha:0:7} $(git -C "$d" log -1 --format='%ad %s' --date=short "$sha" | cut -c1-70)  -> on GitHub via: ${hit:-NOT FOUND}"
  done
done
echo "== App-antigravity-workspace: what does unpushed 09ec6d3 add over pushed 949eae4?"
n=$(git -C /e/_ARCHIVE-2026-08-16/App-antigravity-workspace diff --name-only 949eae4 09ec6d3 | grep -Ev '^\.jdk(21)?/' | wc -l)
t=$(git -C /e/_ARCHIVE-2026-08-16/App-antigravity-workspace diff --name-only 949eae4 09ec6d3 | wc -l)
echo "   $t files differ; $n of them outside the two bundled JDK folders (.jdk/, .jdk21/)"
echo "== /e/Gateflame/VSCode (nested .git inside the canonical tree)"
git -C /e/Gateflame/VSCode rev-parse --verify HEAD 2>&1 | head -1
ls -A /e/Gateflame/VSCode | head -20
echo "== ignore status of odd top-level dirs in canonical"
cd /e/Gateflame && for p in VSCode "NVIDIA Corporation" claude .idea desktop; do printf '%-20s ' "$p"; git check-ignore -q "$p" && echo ignored || echo "NOT ignored (tracked files: $(git ls-files "$p" | wc -l))"; done
