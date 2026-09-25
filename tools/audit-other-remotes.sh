#!/usr/bin/env bash
# Gate^Flame - READ-ONLY: list git checkouts on E: and C:\Users\DGMic whose remote is NOT
# Gate-Flame but whose path or remote looks like this project, and say what is unpushed.
set -uo pipefail
find /e /c/Users/DGMic -maxdepth 4 -type d -name .git 2>/dev/null | while read -r g; do
  d="$(dirname "$g")"
  r="$(git -C "$d" remote get-url origin 2>/dev/null || echo '(no origin)')"
  case "$r" in *Gate-Flame*) continue;; esac
  case "$d$r" in *[Gg]ate*|*[Ff]lame*|*Dennis*|*ARCHIVE*|*antigravity*) ;; *) continue;; esac
  echo "== $d"
  echo "   origin: $r"
  git -C "$d" for-each-ref --format='   %(refname:short) %(objectname:short) upstream=%(upstream:short) %(upstream:track)' refs/heads 2>/dev/null
  echo "   commits on no remote-tracking ref: $(git -C "$d" log --branches --not --remotes --oneline 2>/dev/null | wc -l | tr -d ' ')"
  echo "   dirty files: $(git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
done
