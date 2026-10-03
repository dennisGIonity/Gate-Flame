#!/bin/bash
# stage-pi-release.sh [pi-ip] [feed-host] - stage the full node release on the Pi, run ONE sudo (you type it),
# copy the log back. Run from Git-bash after `bash tools/build-bundles.sh`.
#   STAGE_ONLY=1  stages everything and stops before the sudo step (dry run of the push itself).
# The feed host defaults to THIS laptop's own lab address, read from ipconfig - not a
# fixed 192.168.124.4: on 2026-10-03 the H3C had handed .4 to an ESP32-S3 and the laptop
# was .2, so every box pointed at .4 was posting its health to a microcontroller.
set -u
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
PIIP="${1:-192.168.124.3}"
own_lab_ip() { ipconfig 2>/dev/null | tr -d '\r' | grep -oE 'IPv4[^:]*: *192\.168\.124\.[0-9]+' | grep -oE '192\.168\.124\.[0-9]+' | grep -vx 192.168.124.1 | head -n1; }
FEED="${2:-$(own_lab_ip)}"
[ -n "$FEED" ] || { echo "this laptop holds no 192.168.124.x address - plug into the H3C, or pass the feed host as the 2nd argument"; exit 1; }
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
# Read the stage back before asking for a password: file count, version line, the kiosk
# index and the policy function the installer will run - "copied" is not proof.
ssh "${O[@]}" $PI 'echo "staged: $(find /tmp/gfstage -type f | wc -l) files, VERSION=$(cat /tmp/gfstage/VERSION), kiosk index $(test -f /tmp/gfstage/kiosk/index.html && echo present || echo MISSING), lan-ip policy $(grep -c "^gateflame_lan_ip()" /tmp/gfstage/install-pi-release.sh /tmp/gfstage/dns-watchdog.sh | tr "\n" " ")"'
if [ "${STAGE_ONLY:-0}" = "1" ]; then
  echo "STAGE_ONLY=1: staged, not installed. To install, run from Git-bash (you type the sudo password):"
  echo "  ssh -t -o HostKeyAlias=raspberrypi $PI \"sudo bash /tmp/gfstage/install-pi-release.sh $FEED 2>&1 | tee /tmp/gfstage/install.log\""
  echo "  or double-click tools\\DEPLOY-RELEASE.cmd (re-stages in seconds, then prompts)."
  exit 0
fi
ssh -t "${O[@]}" $PI "sudo bash /tmp/gfstage/install-pi-release.sh $FEED 2>&1 | tee /tmp/gfstage/install.log"
scp "${O[@]}" -q $PI:/tmp/gfstage/install.log "$LOG" && echo "log -> $LOG"
