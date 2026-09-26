#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - FRESH DEVICE INSTALL (Standard T3: Radxa Cubie A7A / Radxa OS, or the lab
# Raspberry Pi 5 / Raspberry Pi OS; any Debian-family arm64 board with systemd)
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# Run ON the device, as root, from the unpacked release folder:
#
#   sudo bash install-all.sh
#   sudo bash install-all.sh --feed-url http://<fleet-console>:8091/api/v1/nodes --feed-token <token>
#
# Chains the individual installers in the only order that works, stopping at the first
# real failure. Each step is idempotent, so a re-run after fixing a failure is safe.
#   1. docker + compose        (the DNS stack runs in containers)
#   2. deploy-on-pi.sh         agent venv + systemd unit + capabilities + mDNS alias
#   3. install-dns-stack.sh    Pi-hole + Unbound, bound to this box's LAN address only,
#                              agent wired to Pi-hole (40-pihole.conf). DHCP stays OFF.
#   4. install-watchdog.sh     60 s resolver watchdog incl. LAN-renumber self-heal
#   5. install-automation.sh   .DUMP data root + backup/anomaly/selfcheck timers
#   6. install-kiosk.sh        on-screen console, only if a display is attached
#   7. fleet feed              only if --feed-url and --feed-token were given
#
# THE DNS STACK LIVES IN /opt/gateflame/dns-stack, NOT IN THIS FOLDER. The stack
# directory holds Pi-hole's data (./data/pihole) and the .env with its password,
# and the watchdog recreates the stack from it. It used to be this unpacked release
# folder - wherever the tester happened to untar it, often /tmp, which Debian 13
# mounts as tmpfs: the first reboot deleted Pi-hole's configuration and left the
# watchdog pointing at a directory that no longer existed. A re-run on a box that
# already has a stack keeps using the one the watchdog knows.
#
# It does NOT touch the router and does NOT point any device at this box. Per ADR-001
# the router's upstream DNS is changed by the owner, once, guided by the kiosk/app.
# ========================================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEED_URL=""; FEED_TOKEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --feed-url) FEED_URL="$2"; shift 2 ;;
    --feed-token) FEED_TOKEN="$2"; shift 2 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash install-all.sh"; exit 1; }
say() { printf '\n\033[1;36m=== %s\033[0m\n' "$*"; }
cd "$HERE"
RELEASE="$(tr -d '\r' < VERSION 2>/dev/null | grep -Em1 '^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$' || echo unknown)"
MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo "unknown board")"
echo "Gate^Flame release: $RELEASE   board: $MODEL"

say "1/7 docker + compose"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq docker.io || true
fi
# Compose v2 ships under a different package name on every Debian-family image:
# `docker-compose` is v2 on Debian 13, `docker-compose-v2` on Ubuntu, and
# `docker-compose-plugin` from Docker's own repository (Debian 12 / Radxa OS images
# that carry docker-ce). Try each; Debian 12's own `docker-compose` is the old v1
# and does not provide `docker compose` at all.
if ! docker compose version >/dev/null 2>&1; then
  for pkg in docker-compose-plugin docker-compose-v2 docker-compose; do
    apt-get install -y -qq "$pkg" >/dev/null 2>&1 || continue
    docker compose version >/dev/null 2>&1 && break
  done
fi
command -v docker >/dev/null 2>&1 || { echo "docker is not installed and apt could not install docker.io - install Docker, then re-run"; exit 1; }
docker compose version >/dev/null 2>&1 || {
  echo "docker compose (v2) is not available on this image."
  echo "  Debian 12 / Radxa OS: install Docker's own packages (docker-ce + docker-compose-plugin),"
  echo "  see https://docs.docker.com/engine/install/debian/ - then re-run this script."
  exit 1
}
systemctl enable --now docker
id wabapi >/dev/null 2>&1 && usermod -aG docker wabapi || true

say "2/7 agent"
bash "$HERE/deploy-on-pi.sh" || echo "  (validate-on-pi reported gaps - see /tmp/gateflame-deploy-report.txt; continuing)"

say "3/7 DNS stack (Pi-hole + Unbound)"
EXISTING_STACK="$(systemctl show -p Environment --value gateflame-dns-watchdog.service 2>/dev/null \
                  | tr ' ' '\n' | sed -n 's/^GATEFLAME_DNS_STACK=//p' | head -n1 || true)"
if [ -n "$EXISTING_STACK" ] && [ -f "$EXISTING_STACK/docker-compose.yml" ]; then
  STACK_DIR="$EXISTING_STACK"
  echo "  re-using the stack this box already runs: $STACK_DIR"
else
  STACK_DIR=/opt/gateflame/dns-stack
fi
install -d -m 0755 "$STACK_DIR"
# Compose files and configs are refreshed; .env (the password) and data/ (Pi-hole's
# state) are never overwritten. Skipped when the stack IS this folder's dns-stack.
if [ "$(realpath "$STACK_DIR")" != "$(realpath "$HERE/dns-stack")" ]; then
  ( cd "$HERE/dns-stack" && find . -path ./data -prune -o -type f ! -name '.env*' -print ) | while read -r f; do
    install -D -m 0644 "$HERE/dns-stack/$f" "$STACK_DIR/$f"
  done
fi
export GATEFLAME_DNS_STACK="$STACK_DIR"
bash "$HERE/install-dns-stack.sh"

say "4/7 watchdog"
bash "$HERE/install-watchdog.sh"

say "5/7 automation timers"
bash "$HERE/install-automation.sh"

say "6/7 kiosk"
if [ -d "$HERE/kiosk" ] && { ls /sys/class/drm/*/status 2>/dev/null | xargs -r grep -l '^connected' >/dev/null; }; then
  bash "$HERE/install-kiosk.sh" "$HERE/kiosk"
else
  echo "  no display connected (or no kiosk bundle) - skipped. Re-run later: sudo bash install-kiosk.sh $HERE/kiosk"
fi

say "7/7 fleet feed"
if [ -n "$FEED_URL" ] && [ -n "$FEED_TOKEN" ]; then
  install -d /etc/systemd/system/gateflame-node-agent.service.d
  umask 077
  cat > /etc/systemd/system/gateflame-node-agent.service.d/50-feed.conf <<EOF
[Service]
Environment=GATEFLAME_FEED_ENABLED=true
Environment=GATEFLAME_FEED_URL=$FEED_URL
Environment=GATEFLAME_FEED_TOKEN=$FEED_TOKEN
EOF
  systemctl daemon-reload && systemctl restart gateflame-node-agent
  # jobs.env follows the new drop-in. Quiet on success, loud on failure: this used
  # to be `>/dev/null` under set -e, so a failure ended the install with no words.
  if ! AUTO_OUT="$(bash "$HERE/install-automation.sh" 2>&1)"; then
    printf '%s\n' "$AUTO_OUT" | grep -E '!!|FAILURES' >&2 || printf '%s\n' "$AUTO_OUT" | tail -n 20 >&2
    exit 1
  fi
  echo "  feed -> $FEED_URL"
else
  echo "  not configured (pass --feed-url and --feed-token to report into a fleet console)"
fi

umask 022
echo "$RELEASE" > /opt/gateflame/RELEASE
IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src"){print $(i+1); exit}}')"
[ -n "$IP" ] || IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{sub(/\/.*/,"",$4); print $4; exit}')"
cat <<EOF

INSTALLED. Gate^Flame $RELEASE on $MODEL
  DNS stack ...... $STACK_DIR   (Pi-hole data and password live here; this release folder can be deleted)
  API / kiosk .... http://${IP}:8080/device-kiosk/   (live data only on the box's own screen or a paired phone)
  DNS ............ ${IP}:53   (point the ROUTER's upstream/WAN DNS here - never the devices; ADR-001)
  Pi-hole admin .. http://${IP}:8081/admin
  Pair a phone ... curl -s -X POST http://127.0.0.1:8080/api/v1/pair/request   (6-digit code, 5 minutes)
  Report ......... /tmp/gateflame-deploy-report.txt
EOF
