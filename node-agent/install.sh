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

# Replace the package rather than merging over it.
#
# `cp -r ./gateflame "$INSTALL_DIR"/` onto an existing install MERGES: files
# present in both are overwritten, but any module the new version deleted or
# renamed survives from the old one. The install then holds a mix of two
# versions and starts cleanly, so nothing looks wrong — right up until a stale
# module shadows a renamed one, or a removed module is still importable and
# still registers a route that was deliberately withdrawn.
#
# Upgrades and re-runs are the normal case, not the exception, so the package
# directory is removed before it is written.
rm -rf "$INSTALL_DIR/gateflame"
cp -r ./gateflame "$INSTALL_DIR"/
cp ./requirements.txt "$INSTALL_DIR"/
# Stale bytecode survives a source replacement and is loaded in preference to
# a .py whose mtime it still matches. Clear it with the source.
find "$INSTALL_DIR" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
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
# vcgencmd talks to the VideoCore mailbox at /dev/vcio, which udev owns as
# root:video. Without this the agent runs vcgencmd successfully as a binary and
# gets a permission error back, so throttle flags read null on a machine that
# can perfectly well report them — a silent, plausible-looking wrong answer.
# The group does not exist on non-Pi hosts; systemd tolerates that.
SupplementaryGroups=video
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

# `enable --now` STARTS a stopped service and does nothing at all to a running
# one. On every re-install - which is the normal case, since this script is how
# code gets deployed - it copied the new source into /opt and left the old
# process serving the old code.
#
# It failed silently and looked like a success: the installer printed "started",
# the service was active, the journal showed healthy traffic, and the new routes
# 404'd. Diagnosing it took a round trip through openapi.json to notice the
# running app knew 20 routes while the file on disk defined 25.
#
# An explicit restart is the whole fix. It is idempotent and costs a second.
systemctl restart gateflame-node-agent

# Prove the process actually picked up this code rather than trusting that it
# did. A deploy that reports success while running the previous build is worse
# than one that fails loudly.
sleep 3
if systemctl is-active --quiet gateflame-node-agent; then
  echo "node-agent restarted (PID $(systemctl show gateflame-node-agent -p MainPID --value))"
else
  echo "WARNING: node-agent is not active after restart - check: journalctl -u gateflame-node-agent -n 30" >&2
fi

echo "node-agent installed and started. Check: systemctl status gateflame-node-agent"
echo "Logs: journalctl -u gateflame-node-agent -f"
