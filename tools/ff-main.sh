#!/usr/bin/env bash
# ff-main.sh - fast-forward main to the working branch WITHOUT checking main out (CLAUDE.md trap), then push. Refuses anything but a fast-forward.
set -u
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
cd /e/Gateflame || exit 1
B=$(git rev-parse --abbrev-ref HEAD)
{
git fetch -q origin
if git merge-base --is-ancestor origin/main "$B"; then
  git branch -f main "$B" && git push origin main 2>&1 | tail -2
  echo "main -> $(git rev-parse --short main) (= $B)"
else
  echo "REFUSED: origin/main is not an ancestor of $B - not a fast-forward"
fi
git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads
} 2>&1 | tee tools/ff-main.last.txt
