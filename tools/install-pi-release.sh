#!/bin/bash
# ========================================================================================
# GATE^FLAME - NODE RELEASE INSTALL (runs AS ROOT on the box, staged by stage-pi-release.sh)
# ========================================================================================
# Upgrades an installed node to exactly what is in the repo, and reads every part back:
#   1. agent package      backup -> replace -> compileall -> (pip if reqs changed)
#                         + 20-version.conf drop-in: GATEFLAME_VERSION = this release
#   2. automation timers  install-automation.sh (regenerates /etc/gateflame/jobs.env)
#   3. kiosk bundle       backup -> replace
#   4. DNS watchdog       /usr/local/bin/gateflame-dns-watchdog (LAN-renumber self-heal)
#   5. dns-stack compose  compose files only; .env is NEVER touched here except the
#                         LAN IP self-heal, which reads the address the box actually holds
#   6. feed URL drop-in   host -> $FEED_HOST (the fleet console)
#   7. read-back          agent + version, every real route, DNS on BOTH listeners
#                         (blocking vs. no-WAN told apart), bundle served = bundle staged
# Rolls the agent back automatically if it will not compile or will not answer.
# Nothing here changes what other devices on the LAN see: no RA, no DHCP, no gateway.
#
# Board-neutral: runs on the lab Pi 5 (user wabapi, stack in /home/wabapi/node-agent)
# and on a Radxa Cubie A7A installed by install-all.sh (stack wherever the watchdog
# unit says it is). Nothing below assumes a user name or a home directory.
# ========================================================================================
set -u
FEED_HOST="${1:-192.168.124.4}"
# The directory this script sits in IS the staged release: /tmp/gfstage when pushed by
# stage-pi-release.sh, or the unpacked GateFlame-Node tarball when run as upgrade.sh.
STAGE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT=/opt/gateflame/node-agent
KIOSK=/opt/gateflame/kiosk
UNIT=gateflame-node-agent
DROPIN_DIR=/etc/systemd/system/${UNIT}.service.d
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/var/backups/gateflame/$STAMP"
API=http://127.0.0.1:8080/api/v1
FAIL=0
pass() { echo "      PASS  $*"; }
warn() { echo "      WARN  $*"; }
bad()  { echo "      FAIL  $*"; FAIL=1; }

# The release version, validated. The 1.0.2 banner printed
#   "(# VERSION_NAME  human-facing semver shown in app settings and on the store.
#    1.0.2+10b3bda)"
# because an unanchored grep of android/version.properties matched its COMMENT
# line too, and `cut -d= -f2` returns a line with no '=' whole. Whatever is in
# VERSION now, only a line that IS a version is used - never a paragraph.
read_version() {
  local f="$1"
  [ -f "$f" ] || return 1
  tr -d '\r' < "$f" | grep -Em1 '^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$'
}
VER="$(read_version "$STAGE/VERSION" || true)"

# The first global IPv4 this box holds on its default-route interface, or - on an
# isolated segment with no default route (a lab switch) - its first global IPv4.
lan_ip() {
  local ip
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src"){print $(i+1); exit}}')"
  [ -n "$ip" ] || ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '{sub(/\/.*/,"",$4); print $4; exit}')"
  echo "$ip"
}

# Where the DNS stack lives. The watchdog unit carries it (install-watchdog.sh writes
# GATEFLAME_DNS_STACK into it), so ask the unit rather than assume a home directory.
resolve_stack() {
  local s c
  s="$(systemctl show -p Environment --value gateflame-dns-watchdog.service 2>/dev/null \
        | tr ' ' '\n' | sed -n 's/^GATEFLAME_DNS_STACK=//p' | head -n1)"
  for c in "$s" /home/wabapi/node-agent/dns-stack /opt/gateflame/dns-stack; do
    [ -n "$c" ] && [ -f "$c/docker-compose.yml" ] && { echo "$c"; return 0; }
  done
  return 1
}

echo "=============================================================="
echo " Gate^Flame node release  $STAMP  (${VER:-version unknown})"
echo "=============================================================="
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
[ -d "$STAGE/gateflame" ] || { echo "nothing staged at $STAGE"; exit 1; }
[ -x "$AGENT/venv/bin/python" ] || { echo "no venv at $AGENT - fresh device? use install-all.sh"; exit 1; }
mkdir -p "$BACKUP"
[ -n "$VER" ] || echo "      (no valid version in $STAGE/VERSION - the agent will report its built-in default)"

rollback() {
  echo "      ROLLING BACK agent to $BACKUP"
  rm -rf "$AGENT/gateflame"; cp -a "$BACKUP/gateflame" "$AGENT/gateflame"
  if [ -f "$BACKUP/20-version.conf" ]; then cp -a "$BACKUP/20-version.conf" "$DROPIN_DIR/20-version.conf"
  else rm -f "$DROPIN_DIR/20-version.conf"; fi
  systemctl daemon-reload
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
# The version the agent reports on /system/status, as a drop-in so it survives
# package replacement and is one file to read when support asks "what build is this".
install -d "$DROPIN_DIR"
[ -f "$DROPIN_DIR/20-version.conf" ] && cp -a "$DROPIN_DIR/20-version.conf" "$BACKUP/20-version.conf"
if [ -n "$VER" ]; then
  printf '[Service]\nEnvironment=GATEFLAME_VERSION=%s\n' "$VER" > "$DROPIN_DIR/20-version.conf"
  chmod 0644 "$DROPIN_DIR/20-version.conf"
  pass "version drop-in: GATEFLAME_VERSION=$VER"
else
  # A stale drop-in would make this build claim to be the previous one.
  rm -f "$DROPIN_DIR/20-version.conf"
  warn "no version drop-in written (VERSION missing or not a version)"
fi

echo; echo "[2/7] automation timers"
if bash "$STAGE/install-automation.sh" >/tmp/gf-automation.log 2>&1; then
  pass "install-automation.sh"
else
  bad "install-automation.sh - which job, and why:"
  grep -E '^\s*!!|FAILURES' /tmp/gf-automation.log | sed 's/^/            /'
  echo "            (full log: /tmp/gf-automation.log)"
fi

echo; echo "[3/7] kiosk bundle"
mkdir -p "$BACKUP/kiosk"; [ -d "$KIOSK" ] && cp -a "$KIOSK/." "$BACKUP/kiosk/"
rm -rf "$KIOSK"; mkdir -p "$KIOSK"; cp -a "$STAGE/kiosk/." "$KIOSK/"; chmod -R a+rX "$KIOSK"
pass "installed $(ls "$KIOSK/assets" | wc -l) assets"

echo; echo "[4/7] DNS watchdog"
STACK="$(resolve_stack || true)"
cp -a /usr/local/bin/gateflame-dns-watchdog "$BACKUP/" 2>/dev/null
install -m 0755 "$STAGE/dns-watchdog.sh" /usr/local/bin/gateflame-dns-watchdog
# The lab Pi also keeps a copy beside its stack; refresh it only if it is there.
if [ -n "$STACK" ] && [ -f "$(dirname "$STACK")/dns-watchdog.sh" ]; then
  OWN="$(stat -c '%U:%G' "$(dirname "$STACK")/dns-watchdog.sh")"
  install -m 0755 -o "${OWN%%:*}" -g "${OWN##*:}" "$STAGE/dns-watchdog.sh" "$(dirname "$STACK")/dns-watchdog.sh"
fi
bash -n /usr/local/bin/gateflame-dns-watchdog && pass "watchdog installed" || bad "watchdog syntax"

echo; echo "[5/7] dns-stack compose"
LIVE="$(lan_ip)"
if [ -z "$STACK" ]; then
  bad "no installed dns-stack found (asked gateflame-dns-watchdog.service, looked in /home/wabapi/node-agent and /opt/gateflame) - compose files NOT updated"
else
  echo "      stack: $STACK"
  OWN="$(stat -c '%U:%G' "$STACK/docker-compose.yml")"
  for f in docker-compose.yml docker-compose.bypass.yml; do
    cp -a "$STACK/$f" "$BACKUP/$f" 2>/dev/null
    install -m 0644 -o "${OWN%%:*}" -g "${OWN##*:}" "$STAGE/dns-stack/$f" "$STACK/$f"
  done
  REC="$(awk '/^GATEFLAME_LAN_IP=/{sub(/^GATEFLAME_LAN_IP=/,""); sub(/\r$/,""); print; exit}' "$STACK/.env" 2>/dev/null)"
  echo "      .env LAN IP=${REC:-<unset>}  box holds=${LIVE:-<none>}"
  if [ -n "$LIVE" ] && [ "$REC" != "$LIVE" ]; then
    cp -p "$STACK/.env" "$BACKUP/dns-stack.env"
    sed -i "s/^GATEFLAME_LAN_IP=.*/GATEFLAME_LAN_IP=$LIVE/" "$STACK/.env"
    echo "      rewrote to $LIVE"
  fi
  (cd "$STACK" && docker compose config -q) && pass "compose config valid" || bad "compose config"
  (cd "$STACK" && docker compose up -d 2>&1 | sed 's/^/      /')
  for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' gateflame-pihole 2>/dev/null)" = healthy ] && break; sleep 2; done
  DH="$(docker exec gateflame-pihole pihole-FTL --config dhcp.active 2>/dev/null)"
  [ "$DH" = "false" ] && pass "Pi-hole DHCP off" || { docker exec gateflame-pihole pihole-FTL --config dhcp.active false >/dev/null; bad "Pi-hole DHCP was '$DH' - forced off"; }
fi

echo; echo "[6/7] feed URL"
DROP=$DROPIN_DIR/50-feed.conf
if [ -f "$DROP" ]; then
  cp -a "$DROP" "$BACKUP/"
  sed -i -E "s#(GATEFLAME_FEED_URL=https?://)[^:/\"]+#\1${FEED_HOST}#" "$DROP"
  echo "      $(grep -o 'GATEFLAME_FEED_URL=[^\"]*' "$DROP")"
else
  echo "      no feed drop-in - this box does not report to a fleet console"
fi
systemctl daemon-reload
systemctl reset-failed "$UNIT" gateflame-dns-watchdog 2>/dev/null
systemctl restart "$UNIT"
# Regenerate jobs.env from the new drop-ins, and say so if that fails too.
bash "$STAGE/install-automation.sh" >>/tmp/gf-automation.log 2>&1 \
  || { bad "install-automation.sh (second pass, after the restart) - see:"; grep -E '^\s*!!' /tmp/gf-automation.log | tail -n 6 | sed 's/^/            /'; }

echo; echo "[7/7] read-back"
for i in $(seq 1 30); do curl -fsS --max-time 2 "$API/system/status" >/dev/null 2>&1 && break; sleep 1; done
ST="$(curl -fsS --max-time 5 "$API/system/status" 2>/dev/null)"
[ -n "$ST" ] && pass "status $ST" || { bad "agent not answering"; rollback; }
if [ -n "$VER" ]; then
  echo "$ST" | grep -q "\"agentVersion\":\"$VER\"" && pass "agent reports $VER" \
    || bad "agent does not report $VER (drop-in not applied? systemctl show $UNIT -p Environment)"
fi

# Every route the kiosk, the phone and IoniBot actually call (gateflame/main.py), on
# loopback (= kiosk scope). The 1.0.3 read-back probed three routes that never
# existed (/filtering/state, /threats/summary, /network/devices) and printed their
# 404s as if they meant something. A 404 here now means this build is not the one
# running; anything but 200 is a FAIL.
ROUTES="system/status system/storage system/kiosk system/feed services telemetry/summary
filtering threats/recent?limit=5 clients profiles profiles/accessibility dns/upstream
vpn/regions vpn/continents vpn/devices ml/anomalies wan/summary flows/recent
firewall/bounced posture/audit posture/netcheck
dns/history?window=24h dns/history?window=7d history/system?window=24h history/system?window=7d"
for r in $ROUTES; do
  body="$(curl -s -w '\n%{http_code}' --max-time 35 "$API/$r" 2>/dev/null)"
  code="${body##*$'\n'}"; body="${body%$'\n'*}"
  note=""
  case "$r" in
    dns/history*|history/system*)
      gap="$(printf '%s' "$body" | python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: print("unparseable"); sys.exit()
print("%d points%s" % (len(d.get("points") or []), ("; gap: " + d["gap"]) if d.get("gap") else ""))' 2>/dev/null)"
      note="  ($gap)" ;;
  esac
  if [ "$code" = "200" ]; then echo "      200   /$r$note"; else bad "$code  /$r"; fi
done

# DNS on BOTH listeners, told apart properly (gateflame/dnsprobe.py): blocking proven
# by 0.0.0.0 from gravity needs no internet; a clean name that cannot resolve is a
# WARN when this box has no WAN uplink (the lab today) and a FAIL when it has one.
READBACK="$(cd "$STAGE" && python3 -m gateflame.dnsprobe readback 127.0.0.1 "$LIVE" 2>&1)"
RB=$?
printf '%s\n' "$READBACK"
[ $RB -eq 0 ] || FAIL=1

SERVED=$(curl -sL --max-time 10 http://127.0.0.1:8080/device-kiosk/ | grep -o 'assets/[A-Za-z0-9._-]*\.js' | sort -u)
EXPECT=$(grep -o 'assets/[A-Za-z0-9._-]*\.js' "$STAGE/kiosk/index.html" | sort -u)
[ -n "$SERVED" ] && [ "$SERVED" = "$EXPECT" ] && pass "kiosk serves the staged bundle" || bad "kiosk bundle mismatch"
GATEFLAME_DNS_STACK="${STACK:-}" /usr/local/bin/gateflame-dns-watchdog >/dev/null 2>&1 && pass "watchdog run: healthy" || bad "watchdog run reported unhealthy"
systemctl restart gateflame-kiosk 2>/dev/null
for u in $UNIT gateflame-kiosk gateflame-mdns-alias gateflame-dns-watchdog.timer gateflame-anomaly.timer gateflame-selfcheck.timer gateflame-backup.timer; do
  echo "      $(systemctl is-active $u 2>/dev/null)  $u"
done
echo "${VER:-unknown}" > /opt/gateflame/RELEASE
echo
[ $FAIL -eq 0 ] && echo "RELEASE INSTALLED AND READ BACK OK. Backup: $BACKUP" || echo "INSTALLED WITH FAILURES ABOVE. Backup: $BACKUP"
exit $FAIL
