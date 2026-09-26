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
# Create the file at 0600 BEFORE anything is written into it. The old order -
# redirect first, chmod two lines later - left GATEFLAME_PIHOLE_PASSWORD
# world-readable for the gap between them, at the shell's default umask.
install -m 0600 /dev/null "$ENV_FILE"
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
# THE RESULT LINE IS THE JOB'S OWN JSON, NOT "THE LAST LINE OF THE UNIT'S JOURNAL".
#
# 1.0.3 read `journalctl -u <unit> -n 1`. For a oneshot, the last journal line of
# the unit is systemd's own "Finished gateflame-job@..." / "Deactivated
# successfully", never the job's output - so every job "did not report ok" and the
# release printed nothing but "FAIL install-automation.sh". The job prints exactly
# one JSON object; that line is selected by this run's invocation id, then by time,
# then from .DUMP/logs/jobs.log - and whatever fails, the reason is printed.
job_line() {  # job, invocation-id, start-epoch
  local job="$1" inv="$2" since="$3" line=""
  if [[ -n "$inv" ]]; then
    line="$(journalctl "_SYSTEMD_INVOCATION_ID=$inv" -o cat --no-pager 2>/dev/null | grep -E '^\{' | tail -n 1)"
  fi
  if [[ -z "$line" ]]; then
    line="$(journalctl -u "gateflame-job@${job}.service" --since "@${since}" -o cat --no-pager 2>/dev/null | grep -E '^\{' | tail -n 1)"
  fi
  if [[ -z "$line" && -r "$DATA_ROOT/logs/jobs.log" ]]; then
    line="$(tail -n 50 "$DATA_ROOT/logs/jobs.log" | grep -F "\"job\": \"${job}\"" | tail -n 1)"
  fi
  printf '%s' "$line"
}

fail=0
FAILED=()
for job in selfcheck backup anomaly; do
  since=$(( $(date +%s) - 1 ))
  unit="gateflame-job@${job}.service"
  # `|| rc=$?`, not `; rc=$?`: under set -e a failing assignment would end the
  # script right here - the exact silence this block exists to replace.
  rc=0
  err="$(systemctl start "$unit" 2>&1)" || rc=$?
  inv="$(systemctl show -p InvocationID --value "$unit" 2>/dev/null || true)"
  line="$(job_line "$job" "$inv" "$since")"
  if [[ $rc -eq 0 && "$line" == *'"ok": true'* ]]; then
    echo "  $job: OK  $line"
    continue
  fi
  fail=1
  if [[ $rc -ne 0 ]]; then
    result="$(systemctl show -p Result --value "$unit" 2>/dev/null || true)"
    status="$(systemctl show -p ExecMainStatus --value "$unit" 2>/dev/null || true)"
    why="the unit failed (result=${result:-?}, exit status=${status:-?})${err:+: $err}"
  elif [[ -z "$line" ]]; then
    why="the job ran but its result line could not be found in the journal or $DATA_ROOT/logs/jobs.log"
  else
    why="the job reported a failure: $line"
  fi
  echo "  !! $job FAILED - $why"
  # The job's own last words, so nobody has to go and look them up.
  journalctl -u "$unit" --since "@${since}" -n 8 -o cat --no-pager 2>/dev/null | sed 's/^/  !!    | /' || true
  FAILED+=("$job")
done

echo "==> timers"
systemctl list-timers 'gateflame-*' --no-pager | sed 's/^/  /' || true

if [[ $fail -ne 0 ]]; then
  echo "AUTOMATION INSTALLED WITH FAILURES: ${FAILED[*]} (reasons above, marked !!)" >&2
  exit 1
fi
echo "AUTOMATION INSTALLED AND EVERY JOB RAN OK"
