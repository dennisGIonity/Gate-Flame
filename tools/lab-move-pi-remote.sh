#!/usr/bin/env bash
# ===========================================================================
# Gate^Flame | move the Pi fully onto the Ionity lab - runs ON THE PI as root.
# Driven by tools\LAB-MOVE-PI.cmd (one sudo, typed by Dennis). Every change is
# backed up and printed; nothing is deleted.
#   1. guard: must be connected via eth0 192.168.124.3, else abort
#   2. household Wi-Fi profiles -> autoconnect no, wlan0 down (profiles kept)
#   3. dns-stack/.env GATEFLAME_LAN_IP -> 192.168.124.3 (Pi-hole binds eth0 only)
#   4. jobs.env GATEFLAME_FEED_URL host 192.168.0.x -> 192.168.124.4 (laptop)
#   5. open-webui holds :8080 (host network) -> stop + restart=no (volume kept)
#   6. DNS stack up, Pi-hole DHCP forced OFF, agent + watchdog restarted
#   7. clock resync (the Pi thought it was 2026-09-20: NTP could not resolve)
# ===========================================================================
set -u
LAB_IP=192.168.124.3; LAPTOP=192.168.124.4; TS=$(date +%Y%m%d-%H%M%S)
say() { echo "[move] $*"; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

say "1. guard"
ip -4 -o addr show eth0 | grep -q " $LAB_IP/" || { say "ABORT: eth0 does not hold $LAB_IP"; exit 2; }
CONN=${1:-${SSH_CONNECTION:-}}   # sudo strips SSH_CONNECTION, so the driver passes it as $1
case "$CONN" in *" $LAB_IP "*) say "   ssh arrived via $LAB_IP - safe to drop wlan0";; *) say "ABORT: this ssh session is not on $LAB_IP (${CONN:-none}); dropping wlan0 could cut you off"; exit 2;; esac

say "2. household Wi-Fi off (profiles kept)"
nmcli -t -f NAME,TYPE con show | awk -F: '$2=="802-11-wireless"{print $1}' | while read -r p; do
  case "$p" in IONITY-LAB*) say "   keep lab profile '$p'"; continue;; esac
  nmcli con modify "$p" connection.autoconnect no && say "   '$p' autoconnect -> no"
done
nmcli dev disconnect wlan0 >/dev/null 2>&1 && say "   wlan0 disconnected"
say "   read-back: $(ip -4 -o addr show wlan0 | awk '{print $4}' | tr '\n' ' ')(empty = off household)"

say "3. dns-stack .env"
ENVF=/home/wabapi/node-agent/dns-stack/.env
cp -p "$ENVF" "$ENVF.bak-$TS"
if grep -q '^GATEFLAME_LAN_IP=' "$ENVF"; then sed -i "s/^GATEFLAME_LAN_IP=.*/GATEFLAME_LAN_IP=$LAB_IP/" "$ENVF"; else echo "GATEFLAME_LAN_IP=$LAB_IP" >> "$ENVF"; fi
say "   read-back: $(grep '^GATEFLAME_LAN_IP=' "$ENVF")  (backup $ENVF.bak-$TS)"

say "4. fleet feed URL"
for f in /etc/gateflame/jobs.env /etc/gateflame/*.env; do
  [ -f "$f" ] || continue
  if grep -qE '^GATEFLAME_FEED_URL=http://192\.168\.(0|2)\.[0-9]+' "$f"; then
    cp -p "$f" "$f.bak-$TS"
    sed -i -E "s#^(GATEFLAME_FEED_URL=http://)192\.168\.(0|2)\.[0-9]+#\1$LAPTOP#" "$f"
    say "   $f: $(grep '^GATEFLAME_FEED_URL=' "$f")"
  fi
done

say "5. open-webui off :8080 (data volume untouched)"
if docker ps --format '{{.Names}}' | grep -qx open-webui; then
  docker update --restart=no open-webui >/dev/null && docker stop open-webui >/dev/null && say "   stopped, restart=no. Undo: docker update --restart=always open-webui && docker start open-webui"
fi

say "6. DNS stack + agent"
(cd /home/wabapi/node-agent/dns-stack && docker compose up -d 2>&1 | sed 's/^/   /')
sleep 8
dh=$(docker exec gateflame-pihole pihole-FTL --config dhcp.active 2>/dev/null)
say "   pihole dhcp.active=$dh"
[ "$dh" = "true" ] && docker exec gateflame-pihole pihole-FTL --config dhcp.active false >/dev/null && say "   forced DHCP OFF: $(docker exec gateflame-pihole pihole-FTL --config dhcp.active)"
systemctl reset-failed gateflame-node-agent gateflame-dns-watchdog 2>/dev/null
systemctl restart gateflame-node-agent; systemctl start gateflame-dns-watchdog.service 2>/dev/null
sleep 5

say "7. clock"
systemctl restart systemd-timesyncd; sleep 6
say "   $(date -Is)  $(timedatectl | grep synchron)"

say "--- final state ---"
docker ps -a --format '   {{.Names}} | {{.Status}}' | grep -E 'gateflame|open-webui'
for u in gateflame-node-agent gateflame-kiosk gateflame-mdns-alias gateflame-dns-watchdog.timer; do say "   $u $(systemctl is-active $u)"; done
ss -ltnu | grep -E ':(53|8080|8081) ' | sed 's/^/   /'
say "done"
