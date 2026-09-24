#!/bin/bash
# ========================================================================================
# GATE^FLAME - NODE RELEASE INSTALL (runs AS ROOT on the Pi, staged by stage-pi-release.sh)
# ========================================================================================
# Upgrades an installed node to exactly what is in the repo, and reads every part back:
#   1. agent package      backup -> replace -> compileall -> (pip if reqs changed)
#   2. automation timers  install-automation.sh (regenerates /etc/gateflame/jobs.env)
#   3. kiosk bundle       backup -> replace
#   4. DNS watchdog       /usr/local/bin/gateflame-dns-watchdog (LAN-renumber self-heal)
#   5. dns-stack compose  compose files only; .env is NEVER touched here except the
#                         LAN IP self-heal, which reads the address the box actually holds
#   6. feed URL drop-in   host -> $FEED_HOST (the fleet console)
#   7. read-back          agent, routes, DNS on BOTH listeners, bundle served = bundle staged
# Rolls the agent back automatically if it will not compile or will not answer.
# Nothing here changes what other devices on the LAN see: no RA, no DHCP, no gateway.
# ========================================================================================
set -u
FEED_HOST="${1:-192.168.124.4}"
STAGE=/tmp/gfstage
AGENT=/opt/gateflame/node-agent
KIOSK=/opt/gateflame/kiosk
STACK=/home/wabapi/node-agent/dns-stack
UNIT=gateflame-node-agent
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/var/backups/gateflame/$STAMP"
API=http://127.0.0.1:8080/api/v1
FAIL=0
pass() { echo "      PASS  $*"; }
bad()  { echo "      FAIL  $*"; FAIL=1; }

echo "=============================================================="
echo " Gate^Flame node release  $STAMP  ($(cat $STAGE/VERSION 2>/dev/null))"
echo "=============================================================="
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
[ -d "$STAGE/gateflame" ] || { echo "nothing staged at $STAGE"; exit 1; }
[ -x "$AGENT/venv/bin/python" ] || { echo "no venv at $AGENT - fresh device? use install-all.sh"; exit 1; }
mkdir -p "$BACKUP"

rollback() {
  echo "      ROLLING BACK agent to $BACKUP"
  rm -rf "$AGENT/gateflame"; cp -a "$BACKUP/gateflame" "$AGENT/gateflame"
  systemctl restart "$UNIT"; sleep 4
  curl -fsS "$API/system/status" >/dev/null && echo "      rolled back; agent answering" || echo "      ROLLBACK DID NOT ANSWER - journalctl -u $UNIT -n 50"
  exit 1
}

echo; echo "[1/7] agent package"
cp -a "$AGENT/gateflame" "$BACKUP/gateflame"
rm -rf "$AGENT/gateflame"; cp -a "$STAGE/gateflame" "$AGENT/gateflame"
find "$AGENT/gateflame" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null
chown -R root:root "$AGENT/gateflame"; chmod -R a+rX "$AGENT/gateflame"
"$AGENT/venv/bin/python" -m compileall -q "$AGENT/gateflame" >/dev/null && pass "compiles ($(ls "$AGENT"/gateflame/*.py | wc -l) modules)" || { bad "compile"; rollback; }
if ! cmp -s "$STAGE/requirements.txt" "$AGENT/requirements.txt"; then
  cp -a "$AGENT/requirements.txt" "$BACKUP/" 2>/dev/null
  cp "$STAGE/requirements.txt" "$AGENT/requirements.txt"
  "$AGENT/venv/bin/pip" install -q -r "$AGENT/requirements.txt" && pass "requirements updated" || { bad "pip install (no internet?)"; rollback; }
fi
install -m 0755 "$STAGE/gateflame-netcheck.sh" "$AGENT/gateflame-netcheck.sh"

echo; echo "[2/7] automation timers"
bash "$STAGE/install-automation.sh" >/tmp/gf-automation.log 2>&1 && pass "install-automation.sh" || bad "install-automation.sh (see /tmp/gf-automation.log)"

echo; echo "[3/7] kiosk bundle"
mkdir -p "$BACKUP/kiosk"; [ -d "$KIOSK" ] && cp -a "$KIOSK/." "$BACKUP/kiosk/"
rm -rf "$KIOSK"; mkdir -p "$KIOSK"; cp -a "$STAGE/kiosk/." "$KIOSK/"; chmod -R a+rX "$KIOSK"
pass "installed $(ls "$KIOSK/assets" | wc -l) assets"

echo; echo "[4/7] DNS watchdog"
cp -a /usr/local/bin/gateflame-dns-watchdog "$BACKUP/" 2>/dev/null
install -m 0755 "$STAGE/dns-watchdog.sh" /usr/local/bin/gateflame-dns-watchdog
install -m 0755 -o wabapi -g wabapi "$STAGE/dns-watchdog.sh" /home/wabapi/node-agent/dns-watchdog.sh
bash -n /usr/local/bin/gateflame-dns-watchdog && pass "watchdog installed" || bad "watchdog syntax"

echo; echo "[5/7] dns-stack compose"
for f in docker-compose.yml docker-compose.bypass.yml; do
  cp -a "$STACK/$f" "$BACKUP/$f"; install -m 0644 -o wabapi -g wabapi "$STAGE/dns-stack/$f" "$STACK/$f"
done
LIVE="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
REC="$(awk '/^GATEFLAME_LAN_IP=/{sub(/^GATEFLAME_LAN_IP=/,""); print; exit}' "$STACK/.env")"
echo "      .env LAN IP=$REC  box holds=$LIVE"
if [ -n "$LIVE" ] && [ "$REC" != "$LIVE" ]; then cp -p "$STACK/.env" "$BACKUP/dns-stack.env"; sed -i "s/^GATEFLAME_LAN_IP=.*/GATEFLAME_LAN_IP=$LIVE/" "$STACK/.env"; echo "      rewrote to $LIVE"; fi
(cd "$STACK" && docker compose config -q) && pass "compose config valid" || bad "compose config"
(cd "$STACK" && docker compose up -d 2>&1 | sed 's/^/      /')
for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' gateflame-pihole 2>/dev/null)" = healthy ] && break; sleep 2; done
DH="$(docker exec gateflame-pihole pihole-FTL --config dhcp.active 2>/dev/null)"
[ "$DH" = "false" ] && pass "Pi-hole DHCP off" || { docker exec gateflame-pihole pihole-FTL --config dhcp.active false >/dev/null; bad "Pi-hole DHCP was '$DH' - forced off"; }

echo; echo "[6/7] feed URL"
DROP=/etc/systemd/system/gateflame-node-agent.service.d/50-feed.conf
if [ -f "$DROP" ]; then
  cp -a "$DROP" "$BACKUP/"
  sed -i -E "s#(GATEFLAME_FEED_URL=https?://)[^:/\"]+#\1${FEED_HOST}#" "$DROP"
  echo "      $(grep -o 'GATEFLAME_FEED_URL=[^\"]*' "$DROP")"
fi
systemctl daemon-reload
systemctl reset-failed "$UNIT" gateflame-dns-watchdog 2>/dev/null
systemctl restart "$UNIT"
bash "$STAGE/install-automation.sh" >>/tmp/gf-automation.log 2>&1   # regenerate jobs.env from the new drop-in

echo; echo "[7/7] read-back"
for i in $(seq 1 30); do curl -fsS --max-time 2 "$API/system/status" >/dev/null 2>&1 && break; sleep 1; done
ST="$(curl -fsS --max-time 5 "$API/system/status" 2>/dev/null)"
[ -n "$ST" ] && pass "status $ST" || { bad "agent not answering"; rollback; }
for r in system/status services telemetry/summary filtering/state threats/summary clients network/devices posture/netcheck dns/upstream profiles vpn/regions system/storage; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$API/$r")"
  echo "      $code  /$r"
done
for s in 127.0.0.1 "$LIVE"; do
  python3 - "$s" <<'PY' && pass "DNS answers on $s" || bad "DNS silent on $s"
import socket,struct,sys
q=struct.pack('>HHHHHH',7,0x0100,1,0,0,0)+b'\x0adoubleclick\x03net\x00'+struct.pack('>HH',1,1)
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(4); s.sendto(q,(sys.argv[1],53)); d=s.recv(512)
sys.exit(0 if len(d)>12 else 1)
PY
done
SERVED=$(curl -sL --max-time 10 http://127.0.0.1:8080/device-kiosk/ | grep -o 'assets/[A-Za-z0-9._-]*\.js' | sort -u)
EXPECT=$(grep -o 'assets/[A-Za-z0-9._-]*\.js' "$STAGE/kiosk/index.html" | sort -u)
[ -n "$SERVED" ] && [ "$SERVED" = "$EXPECT" ] && pass "kiosk serves the staged bundle" || bad "kiosk bundle mismatch"
/usr/local/bin/gateflame-dns-watchdog >/dev/null 2>&1 && pass "watchdog run: healthy" || bad "watchdog run reported unhealthy"
systemctl restart gateflame-kiosk 2>/dev/null
for u in $UNIT gateflame-kiosk gateflame-mdns-alias gateflame-dns-watchdog.timer; do echo "      $(systemctl is-active $u)  $u"; done
echo "$(cat $STAGE/VERSION 2>/dev/null)" > /opt/gateflame/RELEASE
echo
[ $FAIL -eq 0 ] && echo "RELEASE INSTALLED AND READ BACK OK. Backup: $BACKUP" || echo "INSTALLED WITH FAILURES ABOVE. Backup: $BACKUP"
exit $FAIL
