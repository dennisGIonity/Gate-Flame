#!/usr/bin/env bash
# ===========================================================================
# Gate^Flame | lab Pi back to eth0 ONLY - runs ON THE PI as root (one sudo, typed by Dennis).
# Driven by tools\LAB-PI-ETH0-ONLY.cmd. Same guard and same step as LAB-MOVE-PI step 2:
#   household Wi-Fi profiles -> autoconnect no, wlan0 disconnected, profiles KEPT.
# Why it exists on its own: on 2026-10-03 the Pi rebooted and 'Afrihost Fibre DTM' had
# autoconnect=yes again (it was set to no on 09-24), so the box came up dual-homed with
# its default route on the household LAN. Nothing else is touched: no .env, no stack,
# no router. The H3C now has a WAN uplink, so eth0 alone gives the Pi internet.
# ===========================================================================
set -u
LAB_IP=192.168.124.3
say() { echo "[eth0-only] $*"; }
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

say "3. read-back"
say "   wlan0: $(ip -4 -o addr show wlan0 | awk '{print $4}' | tr '\n' ' ')(empty = off household)"
say "   autoconnect: $(nmcli -t -f NAME,AUTOCONNECT con show | grep -v -e '^lo' -e '^docker' -e '^br-' | tr '\n' ' ')"
say "   default route: $(ip -4 route show default | head -1)"
say "   internet via eth0: $(ping -c1 -W3 1.1.1.1 >/dev/null 2>&1 && echo yes || echo NO)"
say "   resolv.conf: $(grep -v '^#' /etc/resolv.conf | tr '\n' ' ')"
say "done"
