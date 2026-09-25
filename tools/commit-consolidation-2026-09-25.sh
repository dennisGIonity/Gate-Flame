#!/usr/bin/env bash
# Commit the 2026-09-25 consolidation (inventory, chat archive, audits) on the working
# branch, fast-forward main to it (ref move only, guarded), then push BOTH if the SSH key
# is loaded. Configured identity only, never --author, never force. Safe to re-run.
set -u
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
out=/e/Gateflame/tools/commit-consolidation-2026-09-25.last.txt
{
cd /e/Gateflame || exit 1
echo "=== $(date -Iseconds) ==="
echo "identity: $(git config user.name) <$(git config user.email)>"
[ "$(git config user.name)" = DennisIonity ] || { echo "WRONG IDENTITY - stopping"; exit 1; }
br=$(git rev-parse --abbrev-ref HEAD); echo "branch: $br"
[ "$br" = fix/mobile-dns-drops ] || { echo "not on the working branch - stopping"; exit 1; }

git add .gitignore CLAUDE.md \
  docs/INVENTORY-REPOS-AND-FOLDERS-2026-09-25.md \
  docs/archive-finishing-touches/chats \
  docs/archive/antigravity-untracked/BacteriaPopGame.tsx \
  tools/audit-2026-09-25.sh tools/audit-other-remotes.sh tools/audit-dennis-repo.sh \
  tools/export-chats.py tools/commit-consolidation-2026-09-25.sh tools/PUSH-2026-09-25.cmd
git add -f tools/audit-2026-09-25.last.txt tools/audit-other-remotes.last.txt tools/audit-dennis-repo.last.txt
if git diff --cached --quiet; then echo "nothing new to commit"; else
  git commit -q -m "Consolidation 2026-09-25: repo+folder inventory, all 8 'Finishing touches' chats archived (secret-scrubbed), BacteriaPopGame preserved, audits prove every local commit is on GitHub; ignore tools run logs; CLAUDE.md: sandbox-git index.lock trap, GateFlame-Repo is stale" \
    && git log -1 --format='committed %h %an <%ae> %s'
fi

if git merge-base --is-ancestor main HEAD; then
  git branch -f main HEAD && echo "main fast-forwarded to $(git rev-parse --short main)"
else
  echo "main is NOT an ancestor of HEAD - left alone"
fi

echo "--- push"
if ssh-add -l >/dev/null 2>&1; then
  git push --dry-run origin fix/mobile-dns-drops main 2>&1 | tail -3
  git push origin fix/mobile-dns-drops main 2>&1 | tail -4
else
  echo "SSH key NOT loaded - committed locally only. Run tools\\PUSH-2026-09-25.cmd"
fi

echo "--- read-back: local vs GitHub"
remote=$(git ls-remote https://github.com/dennisGIonity/Gate-Flame.git refs/heads/fix/mobile-dns-drops refs/heads/main)
for b in fix/mobile-dns-drops main; do
  l=$(git rev-parse "$b"); r=$(echo "$remote" | awk -v R="refs/heads/$b" '$2==R{print $1}')
  [ "$l" = "$r" ] && echo "  SAME    $b ${l:0:7}" || echo "  AHEAD   $b local=${l:0:7} github=${r:0:7}"
done
git status -sb | head -3
} > "$out" 2>&1
cat "$out"
