#!/usr/bin/env bash
# Read-only git history dump. No commit, push, checkout, or identity flags.
# Output: tools/history-dump.last.txt (not committed; tools/*.last.txt convention)
cd /e/Gateflame || exit 1
OUT=/e/Gateflame/tools/history-dump.last.txt
{
  echo "=== generated $(date '+%Y-%m-%d %H:%M:%S %z') ==="
  echo
  echo "=== git status -sb ==="
  git status -sb
  echo
  echo "=== local branches: ahead/behind vs upstream (or origin/<name>) ==="
  git for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads | while read -r b up; do
    ref="$up"
    [ -z "$ref" ] && git rev-parse -q --verify "origin/$b" >/dev/null && ref="origin/$b"
    if [ -n "$ref" ]; then
      counts=$(git rev-list --left-right --count "$b...$ref" 2>/dev/null)
      echo "$b  vs $ref  ahead/behind: $counts  (upstream set: ${up:-none})"
    else
      echo "$b  NO REMOTE COUNTERPART  commits: $(git rev-list --count "$b")"
    fi
    echo "    tip: $(git log -1 --format='%h %ad %an %s' --date=short "$b")"
  done
  echo
  echo "=== remote branches ==="
  git for-each-ref --format='%(refname:short) %(objectname:short) %(committerdate:short) %(subject)' refs/remotes
  echo
  echo "=== tags ==="
  git tag -l --format='%(refname:short) %(creatordate:short)'
  echo
  echo "=== commits on any local branch not on any remote ==="
  git log --branches --not --remotes --format='%h %ad %an %d %s' --date=short
  echo
  echo "=== author identities ==="
  git log --all --format='%an <%ae>' | sort | uniq -c | sort -rn
  echo
  echo "=== commit count by date ==="
  git log --all --format='%ad' --date=short | sort | uniq -c
  echo
  echo "=== git log --all (full) ==="
  git log --all --format='%h %ad %an %d %s' --date=short
} > "$OUT" 2>&1
echo "done: $OUT ($(wc -l < "$OUT") lines)"
