#!/usr/bin/env bash
# Commit + push the lab move (Gate^Flame branch) and the lab.json registration (Ionity lab repo).
# Configured identity only, no force, from Git-bash so the agent socket is found.
set -u
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
out=/e/Gateflame/tools/commit-push-lab-move.last.txt
{
cd /e/Gateflame || exit 1
echo "identity: $(git config user.name) <$(git config user.email)>"
git add CLAUDE.md tools/lab-pi-status.sh tools/lab-pi-inspect.sh tools/lab-pi-uplink.sh tools/lab-verify.ps1 \
  tools/lab-move-pi-remote.sh tools/lab-move-pi.sh tools/LAB-MOVE-PI.cmd tools/commit-push-lab-move.sh
git commit -q -m "Lab move done: Pi on H3C eth0 only (household WiFi autoconnect off), Pi-hole bound 192.168.124.3, DHCP off, feed URL -> laptop, Open WebUI stopped off :8080; lab has no WAN uplink (SERVFAIL + clock drift) noted" && git log -1 --format='%h %an %s'
git push --dry-run origin HEAD 2>&1 | tail -2
git push origin HEAD 2>&1 | tail -3
git status -sb | head -1
echo; echo "== lab repo"
cd /e/.IONITY-LAB || exit 1
git remote -v | head -1
git add lab.json && git commit -q -m "Register GateFlame (Pi 5, 192.168.124.3) in lab.json projects" && git log -1 --format='%h %an %s'
git push origin HEAD 2>&1 | tail -3
git status -sb | head -1
} > "$out" 2>&1
cat "$out"
