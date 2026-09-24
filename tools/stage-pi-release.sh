#!/bin/bash
# stage-pi-release.sh [pi-ip] [feed-host] - stage the full node release on the Pi, run ONE sudo (you type it),
# copy the log back. Run from Git-bash after `bash tools/build-bundles.sh`.
set -u
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
PIIP="${1:-192.168.124.3}"; FEED="${2:-192.168.124.4}"
PI=wabapi@$PIIP
O=(-o ConnectTimeout=6 -o HostKeyAlias=raspberrypi -o StrictHostKeyChecking=yes)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG=$ROOT/tools/stage-pi-release.last.txt
VER="$(grep '^VERSION_NAME=' $ROOT/android/version.properties | cut -d= -f2 | tr -d '\r ')+$(git -C $ROOT rev-parse --short HEAD)"
ssh-add -l >/dev/null 2>&1 || { rm -f ~/.ssh/agent.sock; eval "$(ssh-agent -a ~/.ssh/agent.sock -s)" >/dev/null; ssh-add ~/.ssh/id_ed25519 || exit 1; }
[ -f "$ROOT/dist-kiosk/index.html" ] || { echo "build first: bash tools/build-bundles.sh"; exit 1; }
echo "staging $VER -> $PI (feed $FEED)"
ssh "${O[@]}" $PI "rm -rf /tmp/gfstage && mkdir -p /tmp/gfstage/kiosk /tmp/gfstage/dns-stack" || exit 1
tar -C "$ROOT/node-agent" --exclude='__pycache__' -cf - gateflame | ssh "${O[@]}" $PI "tar -C /tmp/gfstage -xf -"
scp "${O[@]}" -q "$ROOT/node-agent/requirements.txt" "$ROOT/node-agent/install-automation.sh" "$ROOT/node-agent/dns-watchdog.sh" \
    "$ROOT/node-agent/gateflame-netcheck.sh" "$ROOT/tools/install-pi-release.sh" $PI:/tmp/gfstage/
scp "${O[@]}" -q "$ROOT/node-agent/dns-stack/docker-compose.yml" "$ROOT/node-agent/dns-stack/docker-compose.bypass.yml" $PI:/tmp/gfstage/dns-stack/
scp "${O[@]}" -qr "$ROOT/dist-kiosk/." $PI:/tmp/gfstage/kiosk/
ssh "${O[@]}" $PI "echo '$VER' > /tmp/gfstage/VERSION; chmod +x /tmp/gfstage/*.sh"
ssh -t "${O[@]}" $PI "sudo bash /tmp/gfstage/install-pi-release.sh $FEED 2>&1 | tee /tmp/gfstage/install.log"
scp "${O[@]}" -q $PI:/tmp/gfstage/install.log "$LOG" && echo "log -> $LOG"
