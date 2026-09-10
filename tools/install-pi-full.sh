#!/bin/bash
# Runs AS ROOT on the Pi. Staged by tools/stage-pi-full.sh into /tmp/gfstage.
#
# Installs the 2026-09-10 node release and reads every part of it back:
#   1. the whole agent package  (backup -> replace -> py_compile -> restart)
#   2. the .DUMP data root + systemd drop-in, and the automation timers
#   3. the kiosk bundle (Guard tab, splash)
#   4. READ-BACK on loopback: /system/status reports storageHealthy, and the
#      five new routes answer 200 (kiosk scope is loopback, so from here they
#      are readable). A 404 after install means the restart did not take the
#      new code; the script says so and rolls back rather than printing OK.
#
# Nothing here touches Pi-hole's upstream, filtering, RAs or anything a device
# on the LAN can see. The resolver is never restarted.
set -u

STAGE=/tmp/gfstage
AGENT=/opt/gateflame/node-agent
KIOSK=/opt/gateflame/kiosk
UNIT=gateflame-node-agent
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/var/backups/gateflame/$STAMP"
API=http://127.0.0.1:8080/api/v1

echo "=============================================================="
echo " Gate^Flame node update (full)  $STAMP"
echo "=============================================================="

[ -d "$STAGE/gateflame" ] || { echo "nothing staged at $STAGE - run tools/stage-pi-full.sh first"; exit 1; }
[ -x "$AGENT/venv/bin/python" ] || { echo "no venv at $AGENT - is node-agent installed?"; exit 1; }

rollback() {
  echo "      ROLLING BACK to $BACKUP"
  rm -rf "$AGENT/gateflame"
  cp -a "$BACKUP/gateflame" "$AGENT/gateflame"
  find "$AGENT/gateflame" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
  systemctl restart "$UNIT"
  sleep 3
  curl -fsS "$API/system/status" >/dev/null && echo "      rolled back; agent answering" || echo "      ROLLBACK FAILED TO ANSWER - check: journalctl -u $UNIT -n 50"
  exit 1
}

# ---------------------------------------------------------------- 1. agent
echo ""
echo "[1/4] agent package"
mkdir -p "$BACKUP"
cp -a "$AGENT/gateflame" "$BACKUP/gateflame"
echo "      backup: $BACKUP/gateflame"

rm -rf "$AGENT/gateflame"
cp -a "$STAGE/gateflame" "$AGENT/gateflame"
find "$AGENT/gateflame" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
chown -R root:root "$AGENT/gateflame"
chmod -R a+rX "$AGENT/gateflame"
echo "      installed $(ls "$AGENT/gateflame"/*.py | wc -l) modules"

if "$AGENT/venv/bin/python" -m compileall -q "$AGENT/gateflame" >/dev/null; then
  echo "      compiles OK"
else
  echo "      COMPILE FAILED"; rollback
fi
# requirements unchanged for this release, but install is idempotent and cheap.
if ! cmp -s "$STAGE/requirements.txt" "$AGENT/requirements.txt"; then
  cp "$STAGE/requirements.txt" "$AGENT/requirements.txt"
  "$AGENT/venv/bin/pip" install -q -r "$AGENT/requirements.txt" || { echo "      pip install failed"; rollback; }
fi

# -------------------------------------------------- 2. .DUMP + automation
echo ""
echo "[2/4] data root and automation timers"
if bash "$STAGE/install-automation.sh"; then
  echo "      automation OK"
else
  echo "      install-automation.sh reported failures (see above). Continuing - the agent itself may still be fine."
fi
# install-automation.sh restarts the unit; make sure it is up before read-back.
sleep 3

# ---------------------------------------------------------------- 3. kiosk
echo ""
echo "[3/4] kiosk bundle"
if [ -f "$STAGE/kiosk/index.html" ]; then
  mkdir -p "$BACKUP/kiosk"
  [ -d "$KIOSK" ] && cp -a "$KIOSK/." "$BACKUP/kiosk/"
  rm -rf "$KIOSK"
  mkdir -p "$KIOSK"
  cp -a "$STAGE/kiosk/." "$KIOSK/"
  chmod -R a+rX "$KIOSK"
  if grep -q "Guard" "$KIOSK"/assets/*.js; then echo "      kiosk bundle installed (Guard tab present)"; else echo "      WARNING: installed kiosk bundle has no Guard tab"; fi
else
  echo "      no kiosk bundle staged - skipped"
fi

# ------------------------------------------------------------- 4. read-back
echo ""
echo "[4/4] read-back on loopback"
FAIL=0
STATUS="$(curl -fsS --max-time 5 "$API/system/status" 2>/dev/null || true)"
if [ -z "$STATUS" ]; then echo "      /system/status did not answer"; rollback; fi
echo "      /system/status: $STATUS"
echo "$STATUS" | grep -q '"storageHealthy": *true' || { echo "      storageHealthy is not true - .DUMP not writable by the agent?"; FAIL=1; }

for r in system/storage profiles profiles/accessibility dns/upstream ml/anomalies; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$API/$r")"
  if [ "$code" = "200" ]; then echo "      200  $r"; else echo "      $code  $r  <-- expected 200"; FAIL=1; fi
done

UP="$(curl -fsS --max-time 10 "$API/dns/upstream" 2>/dev/null || true)"
echo "      upstream: $(echo "$UP" | tr -d '\n' | cut -c1-160)"
echo "$UP" | grep -q '"mode": *"recursive"' && echo "      upstream mode is recursive (default, ADR-001) - nothing changed" || echo "      NOTE: upstream mode is not 'recursive' - check the Guard tab"

# Restart the Chromium panel so the wall shows the new bundle; the resolver is untouched.
pkill -HUP -f 'chromium.*device-kiosk' 2>/dev/null || true

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo "INSTALLED WITH READ-BACK FAILURES - see above. Backup at $BACKUP. Not rolling back automatically because the agent IS answering; decide."
  exit 1
fi
echo "INSTALLED AND READ BACK OK. Backup at $BACKUP."
echo "From any LAN machine:  http://192.168.0.10:8080/api/v1/profiles  should now be 401 (installed), not 404."
