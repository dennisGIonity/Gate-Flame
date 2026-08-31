#!/bin/bash
# Stage everything the Pi needs into /tmp on the Pi, then print the ONE sudo
# command for Dennis to run. Nothing here touches root - staging is deliberately
# separate from installing so the privileged step is a single reviewable line
# rather than a long inline command built out of shell quoting.
set -e
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock

PI=wabapi@192.168.0.10
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FEED_HOST="${1:-192.168.0.3}"

echo "=== staging from $ROOT (feed host: $FEED_HOST) ==="

ssh -o BatchMode=yes "$PI" "rm -rf /tmp/gfstage && mkdir -p /tmp/gfstage/gateflame /tmp/gfstage/kiosk"

# Only the agent modules that changed. Deliberately NOT the whole package - a
# narrow copy is easier to reason about and to undo, and the installer backs up
# exactly this list before overwriting.
#
# KEEP IN SYNC with AGENT_FILES in tools/install-pi-update.sh. A file added
# here and not there gets copied but never backed up, so a bad deploy would
# have nothing to roll back to.
AGENT_FILES="vpngate.py main.py health_feed.py"
for f in $AGENT_FILES; do
  scp -q "$ROOT/node-agent/gateflame/$f" "$PI:/tmp/gfstage/gateflame/"
done

# The kiosk bundle, built fresh.
if [ ! -d "$ROOT/dist-kiosk" ]; then
  echo "ERROR: no dist-kiosk/ - run: npm run build:html-kiosk"
  exit 1
fi
scp -qr "$ROOT/dist-kiosk/." "$PI:/tmp/gfstage/kiosk/"

scp -q "$ROOT/tools/install-pi-update.sh" "$PI:/tmp/gfstage/install.sh"
ssh -o BatchMode=yes "$PI" "chmod +x /tmp/gfstage/install.sh"

echo ""
echo "  Staged. Local kiosk bundle:"
ls "$ROOT/dist-kiosk/assets" | sed 's/^/    /'

echo ""
echo "  ============================================================"
echo "   ONE command - pick the line for the machine you are sitting at."
echo "   (Giving only the ssh form once sent Dennis's Pi ssh-ing into"
echo "   itself, where it has no key: 'Permission denied (publickey)'.)"
echo ""
echo "   Already on the Pi   (prompt says wabapi@raspberrypi):"
echo ""
echo "     sudo /tmp/gfstage/install.sh $FEED_HOST"
echo ""
echo "   From this workstation:"
echo ""
echo "     ssh wabapi@192.168.0.10 'sudo /tmp/gfstage/install.sh $FEED_HOST'"
echo ""
echo "   Installs the agent fix, the kiosk bundle and the feed URL,"
echo "   restarts the agent, and READS BACK each one before claiming"
echo "   anything worked."
echo "  ============================================================"
