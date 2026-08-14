#!/usr/bin/env bash
# Installs node-agent as a systemd service on Raspberry Pi OS / Armbian.
# Run as root: sudo bash install.sh
set -euo pipefail

INSTALL_DIR="/opt/gateflame/node-agent"
DATA_DIR="/var/lib/gateflame"
SERVICE_USER="gateflame"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

id -u "$SERVICE_USER" &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"

mkdir -p "$INSTALL_DIR" "$DATA_DIR"
cp -r ./gateflame ./requirements.txt "$INSTALL_DIR"/
chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR"

python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

cat > /etc/systemd/system/gateflame-node-agent.service <<'EOF'
[Unit]
Description=Gate^Flame node-agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gateflame
Group=gateflame
Environment=GATEFLAME_DB_PATH=/var/lib/gateflame/state.db
Environment=GATEFLAME_HOST=0.0.0.0
Environment=GATEFLAME_PORT=8080
# Uncomment and point at a local Pi-hole install to get real query/block/
# client counts and a real threat log instead of honestly-reported gaps.
# Environment=GATEFLAME_PIHOLE_URL=http://127.0.0.1
# Health feed is off by default — see docs/PAIRING-AND-TELEMETRY.md §4.
# Environment=GATEFLAME_FEED_ENABLED=true
# Environment=GATEFLAME_FEED_TOKEN=<issued at provisioning>
WorkingDirectory=/opt/gateflame/node-agent
ExecStart=/opt/gateflame/node-agent/venv/bin/uvicorn gateflame.main:app --host 0.0.0.0 --port 8080
Restart=on-failure
RestartSec=5

# Hardening. See docs/PAIRING-AND-TELEMETRY.md and module_zero_trust's design
# note: these are set at process start and cannot be retrofitted, so get them
# right here rather than promising to "harden later".
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/gateflame
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now gateflame-node-agent

echo "node-agent installed and started. Check: systemctl status gateflame-node-agent"
echo "Logs: journalctl -u gateflame-node-agent -f"
