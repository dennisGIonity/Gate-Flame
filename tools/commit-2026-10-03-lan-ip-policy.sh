#!/usr/bin/env bash
# Commit the wired-first LAN address policy (2026-10-03) and push the current branch.
# Run from Git-bash: bash tools/commit-2026-10-03-lan-ip-policy.sh  (log -> tools/commit-2026-10-03-lan-ip-policy.last.txt)
# Rule Zero: configured identity only, never forces, proves the push path with --dry-run first.
set -u
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
cd /e/Gateflame || exit 1
{
echo "=== $(date -Is) ==="
[ "$(git config user.name)" = DennisIonity ] || { echo "WRONG IDENTITY: $(git config user.name)"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = fix/mobile-dns-drops ] || { echo "wrong branch: $(git rev-parse --abbrev-ref HEAD)"; exit 1; }
echo "--- push path (dry run) ---"
git push --dry-run origin HEAD 2>&1 | tail -3
echo "--- commit ---"
git add node-agent/dns-watchdog.sh node-agent/install-dns-stack.sh node-agent/install-all.sh node-agent/install-kiosk.sh \
  node-agent/gateflame-netcheck.sh node-agent/deploy-on-pi.sh node-agent/tests/test_lan_ip_policy.py \
  tools/install-pi-release.sh tools/stage-pi-release.sh tools/lab-pi-dualhome.sh tools/commit-2026-10-03-lan-ip-policy.sh
git commit -q -F - <<'MSG'
LAN address policy: wired first (the resolver followed Wi-Fi onto the household LAN)

2026-10-03: the lab Pi rebooted, household Wi-Fi auto-connected, wlan0 won the
default route, and the watchdog's renumber self-heal - which derived "this box's
LAN address" from `ip route get 1.1.1.1 ... src` - rewrote dns-stack/.env to the
WIRELESS address (192.168.0.12), recreated the stack there and read "healthy",
while 192.168.124.3:53 (the address the lab router forwards to) answered nothing.
install-pi-release.sh carried the same rule and would have repeated it on deploy.

Policy now, in every script that writes or announces the address: a wired
interface's global IPv4 first (eth*, en* - incl. the Radxa `end0`), the default
route's src only when no wired interface holds one, bridges never. One function,
gateflame_lan_ip(), byte-identical in dns-watchdog.sh, install-dns-stack.sh,
install-all.sh, install-kiosk.sh, gateflame-netcheck.sh, deploy-on-pi.sh (and
the gateflame.local wrapper it writes) and tools/install-pi-release.sh.
tests/test_lan_ip_policy.py (12 tests) runs each copy against a fake `ip`, keeps
the copies identical, and fails any script that goes back to route-first; proven
non-vacuous by reverting one copy (3 failures). node-agent: 774 passed.

stage-pi-release.sh: the feed host is this laptop's own 192.168.124.x from
ipconfig, not a fixed .124.4 - the H3C had handed .4 to an ESP32-S3 while the
laptop was .2, so the box was posting its health to a microcontroller.
STAGE_ONLY=1 stages and reads back without the sudo step.
tools/lab-pi-dualhome.sh: the read-only diagnosis that found all of this.
MSG
git log -1 --format='committed %h %an %ad' --date=iso
echo "--- push ---"
git push origin HEAD 2>&1 | tail -3
echo "--- after ---"
git status -sb | head -1
echo "unpushed on any branch: $(git log --branches --not --remotes --oneline | wc -l)"
} 2>&1 | tee tools/commit-2026-10-03-lan-ip-policy.last.txt
