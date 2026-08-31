#!/bin/bash
# Runs AS ROOT on the Pi. Staged by tools/stage-pi-update.sh.
#
# Installs three things and reads every one of them back before saying so:
#   1. the non-blocking VPN Gate fetch (vpngate.py, main.py)
#   2. the current kiosk bundle
#   3. the fleet feed URL
#
# "Never claim success without a read-back" is the house rule this file exists
# to honour: a router that reported "saved" without saving cost this household
# days, and a key loader that reported OK without binding cost a morning.
set -u

FEED_HOST="${1:-192.168.0.3}"
STAGE=/tmp/gfstage
AGENT=/opt/gateflame/node-agent
KIOSK=/opt/gateflame/kiosk
DROPIN=/etc/systemd/system/gateflame-node-agent.service.d/50-feed.conf
STAMP="$(date +%Y%m%d-%H%M%S)"
FAIL=0

echo "=============================================================="
echo " Gate^Flame node update  $STAMP"
echo "=============================================================="

# ---------------------------------------------------------------- 1. agent
echo ""
echo "[1/3] agent modules"
mkdir -p "/var/backups/gateflame/$STAMP"
for f in vpngate.py main.py; do
  [ -f "$AGENT/gateflame/$f" ] && cp -a "$AGENT/gateflame/$f" "/var/backups/gateflame/$STAMP/$f"
done
install -o root -g root -m 0644 "$STAGE/gateflame/vpngate.py" "$AGENT/gateflame/vpngate.py"
install -o root -g root -m 0644 "$STAGE/gateflame/main.py"    "$AGENT/gateflame/main.py"
echo "      backup: /var/backups/gateflame/$STAMP"

# Syntax-check with the venv's own interpreter BEFORE restarting. Shipping a
# file that cannot import would take the whole box's API down, and the restart
# would "succeed" while every route 502s.
if "$AGENT/venv/bin/python" -m py_compile "$AGENT/gateflame/vpngate.py" "$AGENT/gateflame/main.py"; then
  echo "      compiles OK"
else
  echo "      COMPILE FAILED - restoring backup, not restarting"
  for f in vpngate.py main.py; do
    [ -f "/var/backups/gateflame/$STAMP/$f" ] && cp -a "/var/backups/gateflame/$STAMP/$f" "$AGENT/gateflame/$f"
  done
  exit 1
fi

# ---------------------------------------------------------------- 2. kiosk
echo ""
echo "[2/3] kiosk bundle"
if [ -d "$STAGE/kiosk" ] && [ -n "$(ls -A "$STAGE/kiosk" 2>/dev/null)" ]; then
  [ -d "$KIOSK" ] && cp -a "$KIOSK" "/var/backups/gateflame/$STAMP/kiosk"
  rm -rf "${KIOSK:?}/"*
  cp -a "$STAGE/kiosk/." "$KIOSK/"
  chown -R root:root "$KIOSK"
  find "$KIOSK" -type f -exec chmod 0644 {} \;
  find "$KIOSK" -type d -exec chmod 0755 {} \;
  echo "      installed to $KIOSK"
else
  echo "      nothing staged - skipped"
fi

# ---------------------------------------------------------------- 3. feed
echo ""
echo "[3/3] fleet feed URL"
if [ -f "$DROPIN" ]; then
  cp -a "$DROPIN" "/var/backups/gateflame/$STAMP/50-feed.conf"
  echo "      was: $(grep -o 'GATEFLAME_FEED_URL=[^\"]*' "$DROPIN" 2>/dev/null || echo '(no FEED_URL line)')"
  sed -i -E "s#(GATEFLAME_FEED_URL=https?://)[^:/]+#\1${FEED_HOST}#" "$DROPIN"
  echo "      now: $(grep -o 'GATEFLAME_FEED_URL=[^\"]*' "$DROPIN" 2>/dev/null || echo '(no FEED_URL line)')"
else
  echo "      $DROPIN not present - skipped"
fi

# ---------------------------------------------------------------- restart
echo ""
echo "restarting agent..."
systemctl daemon-reload
systemctl restart gateflame-node-agent
sleep 4

# ---------------------------------------------------------------- READ BACK
echo ""
echo "=============================================================="
echo " READ-BACK - what is actually true now"
echo "=============================================================="

echo ""
echo "service:  $(systemctl is-active gateflame-node-agent)"
[ "$(systemctl is-active gateflame-node-agent)" = "active" ] || FAIL=1

echo ""
echo "-- /vpn/regions must now answer FAST. It measured 24.1s before."
T=$(curl -s -o /tmp/rr.json -w '%{time_total}' --max-time 30 http://127.0.0.1:8080/api/v1/vpn/regions)
echo "   took ${T}s"
# The client aborts at 4s, so anything at or above that is still broken for
# the phone even if curl eventually succeeds.
if awk "BEGIN{exit !($T < 4.0)}"; then
  echo "   PASS - under the 4s client timeout"
else
  echo "   FAIL - still slower than the phone will wait"
  FAIL=1
fi
head -c 200 /tmp/rr.json; echo

echo ""
echo "-- kiosk bundle the box is serving"
curl -s http://127.0.0.1:8080/device-kiosk | grep -o 'assets/[A-Za-z0-9.-]*\.\(js\|css\)' | sort -u | sed 's/^/   /'

echo ""
if [ "$FAIL" = "0" ]; then
  echo "ALL CHECKS PASSED"
else
  echo "SOMETHING DID NOT PASS - see above. Backup: /var/backups/gateflame/$STAMP"
fi
exit $FAIL
