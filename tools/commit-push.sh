#!/usr/bin/env bash
# commit-push.sh "<message>" <paths...> - commit named paths with the configured identity and push the current branch. Never forces.
set -u
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
cd /e/Gateflame || exit 1
msg="$1"; shift
{
echo "identity: $(git config user.name) <$(git config user.email)>"
git add -- "$@"
git commit -q -m "$msg" && git log -1 --format='%h %an %s'
git push origin HEAD 2>&1 | tail -2
git status -sb | head -1
} 2>&1 | tee tools/commit-push.last.txt
