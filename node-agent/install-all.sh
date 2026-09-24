#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - FRESH DEVICE INSTALL (Raspberry Pi 5, Raspberry Pi OS / Debian Trixie, 64-bit)
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
echo "Gate^Flame release: $(cat VERSION 2>/dev/null || echo unknown)"

say "1/7 docker + compose"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose || apt-get install -y -qq docker.io docker-cli-compose
fi
docker compose version >/dev/null 2>&1 || { echo "docker compose (v2) is not available - install the compose plugin and re-run"; exit 1; }
systemctl enable --now docker
id wabapi >/dev/null 2>&1 && usermod -aG docker wabapi || true

say "2/7 agent"
bash "$HERE/deploy-on-pi.sh" || echo "  (validate-on-pi reported gaps - see /tmp/gateflame-deploy-report.txt; continuing)"

say "3/7 DNS stack (Pi-hole + Unbound)"
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
  bash "$HERE/install-automation.sh" >/dev/null   # jobs.env follows the new drop-in
  echo "  feed -> $FEED_URL"
else
  echo "  not configured (pass --feed-url and --feed-token to report into a fleet console)"
fi

echo "$(cat VERSION 2>/dev/null)" > /opt/gateflame/RELEASE
IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
cat <<EOF

INSTALLED. Gate^Flame $(cat VERSION 2>/dev/null)
  API / kiosk .... http://${IP}:8080/device-kiosk/   (live data only on the box's own screen or a paired phone)
  DNS ............ ${IP}:53   (point the ROUTER's upstream/WAN DNS here - never the devices; ADR-001)
  Pi-hole admin .. http://${IP}:8081/admin
  Pair a phone ... curl -s -X POST http://127.0.0.1:8080/api/v1/pair/request   (6-digit code, 5 minutes)
  Report ......... /tmp/gateflame-deploy-report.txt
EOF
