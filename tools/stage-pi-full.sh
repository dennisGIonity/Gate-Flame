#!/bin/bash
# Stage the FULL 2026-09-10 node update into /tmp/gfstage on the Pi, then print
# the ONE sudo command for Dennis. Nothing here needs root; the privileged step
# is a single reviewable line on the box (tools/install-pi-full.sh).
#
# What gets staged:
#   gateflame/            the whole agent package (datadir, profiles, upstream,
#                         anomaly, jobs, pihole.api_patch, main.py routes)
#   kiosk/                dist-kiosk, built fresh (Guard tab, splash, a11y)
#   install-automation.sh timers + .DUMP drop-in
#   install.sh            the root-side installer (tools/install-pi-full.sh)
#
# Run from Git-bash on wabakipi AFTER tools\load-key.cmd:
#     bash tools/stage-pi-full.sh
set -e
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock

PI=wabapi@192.168.0.10
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== staging from $ROOT ==="
if ! ssh -o BatchMode=yes -o ConnectTimeout=6 "$PI" true 2>/dev/null; then
  echo "ERROR: cannot ssh to $PI. Run tools\\load-key.cmd first (needs the passphrase)."
  exit 1
fi

[ -d "$ROOT/dist-kiosk" ] || { echo "ERROR: no dist-kiosk/ - run: npm run build:html-kiosk"; exit 1; }
[ -f "$ROOT/dist-kiosk/index.html" ] || { echo "ERROR: dist-kiosk/index.html missing"; exit 1; }
grep -q "Guard" "$ROOT"/dist-kiosk/assets/*.js || { echo "ERROR: dist-kiosk does not contain the Guard tab - stale build?"; exit 1; }

ssh -o BatchMode=yes "$PI" "rm -rf /tmp/gfstage && mkdir -p /tmp/gfstage/gateflame /tmp/gfstage/kiosk"

# The whole package, minus bytecode. Narrow copies were right for a one-file
# fix; this release touches nine modules and adds five, and a partial copy is
# exactly how a box ends up importing two versions of itself.
tar -C "$ROOT/node-agent" --exclude='__pycache__' -cf - gateflame | ssh -o BatchMode=yes "$PI" "tar -C /tmp/gfstage -xf -"
scp -q "$ROOT/node-agent/requirements.txt" "$PI:/tmp/gfstage/requirements.txt"
scp -q "$ROOT/node-agent/install-automation.sh" "$PI:/tmp/gfstage/install-automation.sh"
scp -qr "$ROOT/dist-kiosk/." "$PI:/tmp/gfstage/kiosk/"
scp -q "$ROOT/tools/install-pi-full.sh" "$PI:/tmp/gfstage/install.sh"
ssh -o BatchMode=yes "$PI" "chmod +x /tmp/gfstage/install.sh /tmp/gfstage/install-automation.sh"

echo ""
echo "  Staged:"
ssh -o BatchMode=yes "$PI" "ls /tmp/gfstage/gateflame | tr '\n' ' '; echo; ls /tmp/gfstage/kiosk | head -3"
echo ""
echo "  Now, ON THE PI (one sudo, will prompt for the password):"
echo ""
echo "      sudo /tmp/gfstage/install.sh"
echo ""
echo "  It backs up, installs, compiles, restarts, READS BACK every new route on"
echo "  loopback, and rolls the agent back if any of that fails."
