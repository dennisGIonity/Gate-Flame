#!/usr/bin/env bash
# ===========================================================================
# Gate^Flame | bring GateFlame back up on the Ionity LAB (H3C 192.168.124.0/24)
#   tools\LAB-RESUME-GATEFLAME.cmd   (double-click; runs this in Git-bash)
#
# What it does, in order - you type YOUR ssh passphrase and YOUR sudo password,
# this script never sees either:
#   1. finds the Pi and REFUSES unless it holds a 192.168.124.x address
#      (lab rule: no GateFlame on the household TP-Link network)
#   2. one sudo on the Pi:
#        a. E:\.IONITY-LAB\pi\gateflame-resume.sh  (undoes PAUSE exactly)
#        b. rewrites dns-stack/.env GATEFLAME_LAN_IP to the Pi's LAB address
#           (the stale 192.168.0.10 is why Pi-hole could not bind port 53)
#        c. docker compose up -d for the DNS stack, restarts the node agent
#        d. reports who holds :8080 if it is not the GateFlame agent
#   3. read-back of every port FROM THIS LAPTOP - "saved" is not proof.
# Output: tools\lab-resume-gateflame.last.txt
# ===========================================================================
set -u
LOG=/e/Gateflame/tools/lab-resume-gateflame.last.txt
exec > >(tee "$LOG") 2>&1
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
LAB=/e/.IONITY-LAB/pi
SSH_OPTS=(-o ConnectTimeout=6 -o HostKeyAlias=raspberrypi -o StrictHostKeyChecking=yes)
echo "=== lab-resume-gateflame $(date -Is) ==="

if ! ssh-add -l >/dev/null 2>&1; then
  echo "SSH key not loaded - enter YOUR passphrase."
  rm -f ~/.ssh/agent.sock
  eval "$(ssh-agent -a ~/.ssh/agent.sock -s)" >/dev/null
  ssh-add ~/.ssh/id_ed25519 || { echo "Key not loaded - stopping."; exit 1; }
fi

HOST=""
for h in $(seq -f '192.168.124.%g' 2 60) 192.168.0.11 192.168.0.10; do
  [ "$h" = 192.168.124.4 ] && continue
  timeout 2 bash -c "</dev/tcp/$h/22" 2>/dev/null || continue
  if ssh "${SSH_OPTS[@]}" -o BatchMode=yes -o ConnectTimeout=3 "wabapi@$h" true 2>/dev/null; then HOST=$h; break; fi
done
[ -n "$HOST" ] || { echo "Could not reach the Pi as wabapi anywhere."; exit 1; }
LABIP=$(ssh "${SSH_OPTS[@]}" "wabapi@$HOST" "ip -4 -o addr show | awk '{print \$2, \$4}' | grep ' 192\.168\.124\.' | head -1")
echo "Pi reached at $HOST ; lab interface: ${LABIP:-NONE}"
if [ -z "$LABIP" ]; then
  echo
  echo "REFUSED: the Pi has no 192.168.124.x address - it is on the household network only."
  echo "Plug the Pi's Ethernet into an H3C LAN port (or join it to IONITY-LAB), then run this again."
  exit 2
fi
LANIP=${LABIP#* }; LANIP=${LANIP%/*}; IFACE=${LABIP%% *}
echo "GateFlame will bind DNS to $LANIP ($IFACE)"

scp "${SSH_OPTS[@]}" -q "$LAB/gateflame-resume.sh" "wabapi@$HOST:~/" || exit 1
ssh -t "${SSH_OPTS[@]}" "wabapi@$HOST" "sudo LANIP=$LANIP bash -s" <<'REMOTE'
set -u
echo "--- a. resume (restores exactly what PAUSE recorded) ---"
if [ -f /var/lib/ionity-lab/gateflame-paused.state ]; then bash ~/gateflame-resume.sh; else echo "  no pause state - nothing to undo"; fi
echo "--- b. dns-stack/.env LAN IP ---"
for ENVF in /home/wabapi/node-agent/dns-stack/.env /opt/gateflame/dns-stack/.env; do
  [ -f "$ENVF" ] || continue
  old=$(grep -E '^GATEFLAME_LAN_IP=' "$ENVF" | cut -d= -f2)
  if [ "$old" != "$LANIP" ]; then
    cp -p "$ENVF" "$ENVF.bak-$(date +%Y%m%d-%H%M%S)"
    if grep -q '^GATEFLAME_LAN_IP=' "$ENVF"; then sed -i "s/^GATEFLAME_LAN_IP=.*/GATEFLAME_LAN_IP=$LANIP/" "$ENVF"; else echo "GATEFLAME_LAN_IP=$LANIP" >> "$ENVF"; fi
    echo "  $ENVF: $old -> $LANIP (backup kept)"
  else echo "  $ENVF already $LANIP"; fi
  echo "  read-back: $(grep -E '^GATEFLAME_LAN_IP=' "$ENVF")"
  echo "--- c. DNS stack up ($(dirname "$ENVF")) ---"
  (cd "$(dirname "$ENVF")" && docker compose up -d 2>&1 | sed 's/^/  /')
done
echo "--- d. who holds :8080 ---"
ss -ltnp 'sport = :8080' | sed 's/^/  /'
docker ps --format '{{.Names}} {{.Ports}}' | grep ':8080->' | sed 's/^/  docker: /' || true
systemctl restart gateflame-node-agent.service; sleep 4
echo "--- state ---"
systemctl --no-pager --no-legend list-units 'gateflame*' | sed 's/^/  /'
docker ps --format '  {{.Names}}  {{.Status}}' | grep -i gateflame
journalctl -u gateflame-node-agent -n 8 --no-pager | sed 's/^/  agent: /'
REMOTE

echo; echo "--- read-back from the laptop ($LANIP) ---"
for p in 22 53 8080 8081; do
  if timeout 2 bash -c "</dev/tcp/$LANIP/$p" 2>/dev/null; then echo "  :$p OPEN"; else echo "  :$p closed"; fi
done
st=$(curl -s -m 5 "http://$LANIP:8080/api/v1/system/status")
case "$st" in *nodeId*) echo "  /system/status -> $st";; *) echo "  /system/status -> NOT the GateFlame agent (${st:0:80})";; esac
nslookup -timeout=3 ionity.today "$LANIP" 2>&1 | tail -3 | sed 's/^/  dns: /'
echo "=== done - log in tools\\lab-resume-gateflame.last.txt ==="
