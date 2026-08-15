#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME — ONE-SHOT PI DEPLOYMENT
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Document ID: DOC-2026-08-015-PIDEP | Version: 1.0 | Updated: 2026-08-15 SAST
# Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
# Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
# Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
# ========================================================================================
#
# Run this ON the Pi, as root:   sudo bash deploy-on-pi.sh
#
# It does four things, in order, and stops at the first real failure:
#   1. installs OS prerequisites the agent needs (python venv, iproute2, nftables)
#   2. runs node-agent/install.sh (systemd unit, venv, service enabled + started)
#   3. drops a systemd override granting CAP_NET_ADMIN / CAP_NET_RAW so the
#      firewall and DPI modules can report `running` instead of `degraded`
#   4. runs node-agent/validate-on-pi.sh and prints the PASS/FAIL table
#
# Everything it does is reversible: see UNINSTALL at the bottom of this file.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${GATEFLAME_PORT:-8080}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root:  sudo bash deploy-on-pi.sh" >&2
  exit 1
fi

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

# ── 1. prerequisites ─────────────────────────────────────────────────────────
say "1/4  Installing OS prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip iproute2 nftables curl ca-certificates avahi-daemon avahi-utils
# vcgencmd lives in raspi-utils / libraspberrypi-bin depending on OS release.
# Not fatal if absent — validate-on-pi.sh reports it honestly either way.
apt-get install -y -qq raspi-utils 2>/dev/null || apt-get install -y -qq libraspberrypi-bin 2>/dev/null || true

# ── 2. the agent itself ──────────────────────────────────────────────────────
say "2/4  Installing node-agent"
cd "$HERE/node-agent"
bash install.sh

# ── 3. capabilities ──────────────────────────────────────────────────────────
# install.sh deliberately ships without these. Granting them is a separate,
# visible decision because they are real privilege: CAP_NET_ADMIN lets the
# process change the kernel firewall, CAP_NET_RAW lets it open raw sockets.
# This is still far narrower than running the unit as root.
say "3/4  Granting CAP_NET_ADMIN / CAP_NET_RAW"
mkdir -p /etc/systemd/system/gateflame-node-agent.service.d
cat > /etc/systemd/system/gateflame-node-agent.service.d/10-capabilities.conf <<'EOF'
# Gate^Flame — capabilities required by module_firewall_bounce and module_dpi_flow.
# Without these both modules report `degraded` with this file as the remedy,
# which is correct behaviour, not a bug. Delete this file to revoke them.
[Service]
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW
EOF

# ProtectSystem=strict in the base unit makes /etc read-only for the process.
# nft needs to read /etc/nftables.conf but never writes it, so strict stays.
systemctl daemon-reload
systemctl restart gateflame-node-agent
sleep 3
systemctl --no-pager --lines=0 status gateflame-node-agent || true

# ── 3b. mDNS name ────────────────────────────────────────────────────────────
# The phone app's first discovery candidate is http://gateflame.local:8080.
# Publishing that alias means a customer never types an IP, and it keeps working
# when DHCP moves the node. This is an *alias* — the Pi's own hostname is left
# alone, so nothing else on the box changes.
say "3b/4  Publishing gateflame.local over mDNS"
cat > /etc/avahi/services/gateflame.service <<'EOF'
<?xml version="1.0" standalone='no'?><!--*-nxml-*-->
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Gate^Flame Node on %h</name>
  <service>
    <type>_http._tcp</type>
    <port>8080</port>
    <txt-record>path=/api/v1/system/status</txt-record>
  </service>
</service-group>
EOF
systemctl enable --now avahi-daemon
# avahi-publish runs in the foreground, so it needs its own unit to survive.
LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
if [ -n "${LAN_IP:-}" ]; then
  cat > /etc/systemd/system/gateflame-mdns-alias.service <<EOF
[Unit]
Description=Publish gateflame.local as an mDNS alias for this node
After=avahi-daemon.service
Requires=avahi-daemon.service

[Service]
ExecStart=/usr/bin/avahi-publish -a -R gateflame.local ${LAN_IP}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now gateflame-mdns-alias
  echo "gateflame.local -> ${LAN_IP}"
else
  echo "Could not determine this node's LAN IP — skipping the mDNS alias."
  echo "The app can still be pointed at the node by address."
fi

# ── 4. validation ────────────────────────────────────────────────────────────
say "4/4  Validating against real hardware"
set +e
bash "$HERE/node-agent/validate-on-pi.sh"
VALIDATE_RC=$?
set -e

say "Node identity"
curl -s "http://127.0.0.1:${PORT}/api/v1/system/status" || echo "agent not answering on port ${PORT}"
echo

say "Module capability report (honest — 'degraded' means a named gap, not a crash)"
curl -s "http://127.0.0.1:${PORT}/api/v1/services" || true
echo

cat <<EOF

────────────────────────────────────────────────────────────────────────────
This node is reachable at:
    http://${LAN_IP:-<this-pi-ip>}:8080
    http://gateflame.local:8080          (mDNS — what the app tries first)

NEXT: pair your phone.

There is no kiosk display on this node yet, and pairing codes are issued only
to loopback callers — so issue one from this shell:

    curl -s -X POST http://127.0.0.1:${PORT}/api/v1/pair/request

Type the 6-digit code into the Gate^Flame app on your phone within 5 minutes.
Five wrong guesses locks that code out permanently; just request a new one.

validate-on-pi.sh exit code: ${VALIDATE_RC}   (0 = every required check passed)
────────────────────────────────────────────────────────────────────────────

UNINSTALL (all of it, in this order):
    systemctl disable --now gateflame-node-agent
    rm -rf /etc/systemd/system/gateflame-node-agent.service.d
    rm -f  /etc/systemd/system/gateflame-node-agent.service
    systemctl daemon-reload
    rm -rf /opt/gateflame /var/lib/gateflame
    userdel gateflame

EOF
exit $VALIDATE_RC
