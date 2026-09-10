#!/usr/bin/env bash
# Gate^Flame - install the automation timers and the .DUMP data root.
# Run as root on the box:   sudo bash install-automation.sh
#
# What this does, and nothing else:
#   1. creates /opt/gateflame/.DUMP/{storage,profiles,ml,history,logs,exports,backups}
#      owned by the service user, mode 0750
#   2. adds a systemd drop-in so the AGENT may write there (ProtectSystem=strict
#      otherwise makes the whole of /opt read-only to it) and knows the root
#   3. installs three timers that run `python -m gateflame.jobs <job>` as the
#      same user, with the same environment, as the agent:
#        gateflame-anomaly    every 5 min   on-box DNS anomaly scoring
#        gateflame-backup     daily 03:15   state.db + profiles into .DUMP/backups
#        gateflame-selfcheck  every 15 min  storage/pihole/upstream one-liner
#   4. runs each job once, right now, and prints the JSON line it produced -
#      so this script cannot print "installed" without the jobs having run.
#
# None of these change filtering, upstream, or anything a device on the LAN
# can see. Re-running is safe; every step is idempotent.
set -euo pipefail

INSTALL_DIR="/opt/gateflame/node-agent"
DATA_ROOT="${GATEFLAME_DATA_ROOT:-/opt/gateflame/.DUMP}"
SERVICE_USER="gateflame"
UNIT="gateflame-node-agent.service"
DROPIN_DIR="/etc/systemd/system/${UNIT}.d"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi
[[ -x "$INSTALL_DIR/venv/bin/python" ]] || { echo "node-agent is not installed at $INSTALL_DIR (run install.sh first)" >&2; exit 1; }
id -u "$SERVICE_USER" &>/dev/null || { echo "service user $SERVICE_USER missing (run install.sh first)" >&2; exit 1; }

echo "==> 1. data root $DATA_ROOT"
for sub in storage profiles ml history logs exports backups; do
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_ROOT/$sub"
done
chown "$SERVICE_USER":"$SERVICE_USER" "$DATA_ROOT"
chmod 0750 "$DATA_ROOT"

echo "==> 2. agent drop-in (ReadWritePaths + GATEFLAME_DATA_ROOT)"
install -d "$DROPIN_DIR"
cat > "$DROPIN_DIR/60-data-root.conf" <<EOF
# Installed by install-automation.sh. The agent's unit sets ProtectSystem=strict,
# which makes /opt read-only; this grants exactly the data root and nothing else.
[Service]
Environment=GATEFLAME_DATA_ROOT=$DATA_ROOT
ReadWritePaths=$DATA_ROOT
EOF

echo "==> 3. timers"
# The job service is a template: gateflame-job@anomaly.service etc. It imports
# the agent's environment drop-ins by reading the same files systemd does, via
# EnvironmentFile on every *.conf that carries Environment= lines is not
# possible directly, so the template simply declares the same drop-in dir:
# systemd applies gateflame-node-agent.service.d/ only to that unit. Instead we
# copy the agent's resolved environment at install time into one file the
# template reads. Secrets stay root:root 0600, same as the agent's drop-ins.
ENV_FILE="/etc/gateflame/jobs.env"
install -d -m 0755 /etc/gateflame
systemctl show "$UNIT" -p Environment --value 2>/dev/null | tr ' ' '\n' | grep -E '^GATEFLAME_' > "$ENV_FILE" || true
grep -q '^GATEFLAME_DATA_ROOT=' "$ENV_FILE" || echo "GATEFLAME_DATA_ROOT=$DATA_ROOT" >> "$ENV_FILE"
chmod 0600 "$ENV_FILE"

cat > /etc/systemd/system/gateflame-job@.service <<EOF
[Unit]
Description=Gate^Flame automation job (%i)
After=network-online.target $UNIT

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/venv/bin/python -m gateflame.jobs %i
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA_ROOT
ProtectHome=true
PrivateTmp=true
EOF

make_timer() {  # name, OnCalendar-or-OnUnitActiveSec, randomize
  local job="$1" when="$2" jitter="$3"
  cat > "/etc/systemd/system/gateflame-${job}.timer" <<EOF
[Unit]
Description=Gate^Flame ${job} timer

[Timer]
${when}
RandomizedDelaySec=${jitter}
Persistent=true
Unit=gateflame-job@${job}.service

[Install]
WantedBy=timers.target
EOF
}
make_timer anomaly   "OnBootSec=2min
OnUnitActiveSec=5min" 30
make_timer selfcheck "OnBootSec=3min
OnUnitActiveSec=15min" 60
make_timer backup    "OnCalendar=*-*-* 03:15:00" 600

systemctl daemon-reload
systemctl restart "$UNIT"
for job in anomaly selfcheck backup; do
  systemctl enable --now "gateflame-${job}.timer" >/dev/null
done

echo "==> 4. run each job once, now"
fail=0
for job in selfcheck backup anomaly; do
  if out=$(systemctl start "gateflame-job@${job}.service" 2>&1 && journalctl -u "gateflame-job@${job}.service" -n 1 -o cat --no-pager); then
    echo "  $job: $out"
    echo "$out" | grep -q '"ok": true' || { echo "  !! $job did not report ok"; fail=1; }
  else
    echo "  !! $job failed to start: $out"; fail=1
  fi
done

echo "==> timers"
systemctl list-timers 'gateflame-*' --no-pager | sed 's/^/  /'

if [[ $fail -ne 0 ]]; then
  echo "AUTOMATION INSTALLED WITH FAILURES - see above" >&2
  exit 1
fi
echo "AUTOMATION INSTALLED AND EVERY JOB RAN OK"
