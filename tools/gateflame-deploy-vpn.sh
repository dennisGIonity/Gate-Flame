#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - deploy the VPN (Shield) backend + the rebuilt kiosk console
# Run:  sudo bash ~/gateflame-deploy-vpn.sh
# ========================================================================================
#
# WHY THIS EXISTS
#
# The Shield UI was built on the phone and on the kiosk, but the box itself had
# no VPN service at all: /opt/gateflame/node-agent/gateflame/ had no vpn.py, so
# /api/v1/vpn/regions, /vpn/continents and /vpn/devices all answered 404. Both
# screens were talking to routes that did not exist, so both correctly showed
# "not set up on this box yet" - which reads, from the outside, as "there is no
# VPN". The UI was never the missing part. This is.
#
# It also installs the rebuilt kiosk bundle: /opt/gateflame/kiosk was still the
# 17 August build, from before the console was rebuilt, so the wall panel had no
# Shield tab to show even once the routes exist.
#
# SAFETY
#   * Backs up both the agent and the kiosk before touching either.
#   * Verifies the staged copies BEFORE overwriting anything.
#   * Re-reads after installing and ROLLS BACK if the box does not come back.
#   * Restarts only gateflame-node-agent and gateflame-kiosk. The resolver
#     (Pi-hole / dns-stack) is never touched, so household DNS keeps serving
#     throughout - nothing here changes what other devices on the LAN see.
#   * Idempotent. Safe to re-run.

set -euo pipefail

STAGE_AGENT="/home/${SUDO_USER:-wabapi}/node-agent"
STAGE_KIOSK="/home/${SUDO_USER:-wabapi}/kiosk-staging"
DEST_AGENT=/opt/gateflame/node-agent
DEST_KIOSK=/opt/gateflame/kiosk
STAMP=$(date +%Y%m%d-%H%M%S)
BK_AGENT="/opt/gateflame/node-agent-backup-${STAMP}"
BK_KIOSK="/opt/gateflame/kiosk.backup-${STAMP}"

c_ok=$'\033[1;32m'; c_warn=$'\033[1;33m'; c_err=$'\033[1;31m'; c_hd=$'\033[1;36m'; c_z=$'\033[0m'
ok()   { printf '    %s[ OK ]%s %s\n' "$c_ok"   "$c_z" "$1"; }
warn() { printf '    %s[WARN]%s %s\n' "$c_warn" "$c_z" "$1"; }
die()  { printf '    %s[FAIL]%s %s\n' "$c_err"  "$c_z" "$1"; exit 1; }
hd()   { printf '\n%s==> %s%s\n' "$c_hd" "$1" "$c_z"; }

[[ $EUID -eq 0 ]] || die "run this with sudo"

# ---------------------------------------------------------------- preflight
hd "1/7  checking what is staged, before touching anything"

[[ -d "$STAGE_AGENT/gateflame" ]] || die "no staged agent at $STAGE_AGENT/gateflame"
[[ -f "$STAGE_AGENT/gateflame/vpn.py" ]] || die "staged agent has no vpn.py - wrong package, nothing changed"
[[ -f "$STAGE_AGENT/gateflame/vpngate.py" ]] || die "staged agent has no vpngate.py - wrong package, nothing changed"
[[ -f "$STAGE_AGENT/gateflame/device_names.py" ]] || die "staged agent has no device_names.py - wrong package, nothing changed"
ok "staged agent carries vpn.py + vpngate.py + device_names.py"

[[ -f "$STAGE_KIOSK/index.html" ]] || die "no staged kiosk at $STAGE_KIOSK"
grep -q "Not set up on this box yet" "$STAGE_KIOSK"/assets/kiosk.*.js 2>/dev/null \
  || die "staged kiosk bundle has no Shield panel - wrong build, nothing changed"
ok "staged kiosk bundle carries the Shield panel"

"$DEST_AGENT/venv/bin/python" - <<'PY' || die "staged modules do not compile - nothing changed"
import py_compile, glob, sys, os
os.chdir(os.path.expanduser("~%s/node-agent" % (os.environ.get("SUDO_USER") or "wabapi")))
bad = []
for f in glob.glob("gateflame/*.py"):
    try:
        py_compile.compile(f, doraise=True)
    except Exception as e:
        bad.append((f, e))
if bad:
    for f, e in bad:
        print("  SYNTAX FAIL:", f, e)
    sys.exit(1)
PY
ok "every staged module compiles against this box's own python"

# ---------------------------------------------------------------- backups
hd "2/7  backing up what is running now"
cp -a "$DEST_AGENT" "$BK_AGENT"
ok "agent  -> $BK_AGENT"
cp -a "$DEST_KIOSK" "$BK_KIOSK"
ok "kiosk  -> $BK_KIOSK"

# ---------------------------------------------------------------- agent
hd "3/7  installing the agent (this is what adds the VPN routes)"
cp -f "$STAGE_AGENT"/gateflame/*.py "$DEST_AGENT/gateflame/"
chown -R root:root "$DEST_AGENT/gateflame"
chmod 644 "$DEST_AGENT"/gateflame/*.py
find "$DEST_AGENT/gateflame" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
ok "$(ls -1 "$DEST_AGENT"/gateflame/*.py | wc -l) modules in place, stale bytecode cleared"

if [[ -f "$STAGE_AGENT/gateflame-netcheck.sh" ]]; then
  cp -f "$STAGE_AGENT/gateflame-netcheck.sh" "$DEST_AGENT/gateflame-netcheck.sh"
  chmod 755 "$DEST_AGENT/gateflame-netcheck.sh"
  ok "gateflame-netcheck.sh refreshed beside the package"
fi

# ---------------------------------------------------------------- kiosk
hd "4/7  installing the rebuilt kiosk console"
rm -rf "${DEST_KIOSK:?}"/*
cp -a "$STAGE_KIOSK"/. "$DEST_KIOSK"/
chown -R root:root "$DEST_KIOSK"
chmod -R a+rX "$DEST_KIOSK"
grep -q "Not set up on this box yet" "$DEST_KIOSK"/assets/kiosk.*.js 2>/dev/null \
  || { rm -rf "${DEST_KIOSK:?}"/*; cp -a "$BK_KIOSK"/. "$DEST_KIOSK"/; die "installed kiosk failed read-back - rolled back"; }
ok "kiosk installed and confirmed by re-reading it from disk"

# ---------------------------------------------------- fleet feed drop-in
hd "5/8  pointing the health feed at the local fleet dashboard"
#
# The feed has been off since the box was built (GATEFLAME_FEED_ENABLED
# defaults to false) and pointed at feeds.ionity.today, which does not
# resolve. That is why the fleet dashboard had never received a single
# report. This points it at the dashboard now running on the workstation.
#
# Health fields only - health_feed.py cannot send domains, client IPs,
# hostnames or threat logs, because it does not import the modules that
# hold them. See PAIRING-AND-TELEMETRY.md 4.1.
#
# THIS IS DENNIS'S OWN TEST BOX. Per 4.3 a real customer unit needs a
# consent screen and a kill toggle before this is switched on for them;
# neither is built yet. Do not ship this drop-in to a customer box.
#
# The token is NOT in this file. This script is committed to the repo, and a
# shared secret in git is exactly the mistake this project is already cleaning
# up elsewhere. It is staged separately as ~/gateflame-feed.conf (mode 600,
# never committed) and simply moved into place here.
FEED_DIR=/etc/systemd/system/gateflame-node-agent.service.d
FEED_CONF="$FEED_DIR/50-feed.conf"
FEED_STAGED="/home/${SUDO_USER:-wabapi}/gateflame-feed.conf"

if [[ -f "$FEED_STAGED" ]]; then
  mkdir -p "$FEED_DIR"
  cp -f "$FEED_STAGED" "$FEED_CONF"
  chmod 600 "$FEED_CONF"
  chown root:root "$FEED_CONF"
  systemctl daemon-reload
  ok "feed drop-in installed (mode 600, root-only) and systemd reloaded"
  echo "         target: $(grep -o 'GATEFLAME_FEED_URL=[^ ]*' "$FEED_CONF" || true)"
  warn "the workstation is on DHCP - if its IP changes, edit $FEED_CONF"
else
  warn "no $FEED_STAGED staged - leaving the health feed exactly as it is"
  warn "(the fleet dashboard will keep showing nothing until this is staged)"
fi

# ---------------------------------------------------------------- restart
hd "6/8  restarting (resolver untouched - DNS keeps serving)"
systemctl restart gateflame-node-agent
sleep 6
if ! systemctl is-active --quiet gateflame-node-agent; then
  warn "agent did not come back - rolling the AGENT back now"
  cp -a "$BK_AGENT"/gateflame/*.py "$DEST_AGENT/gateflame/"
  find "$DEST_AGENT/gateflame" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
  systemctl restart gateflame-node-agent
  sleep 5
  systemctl is-active --quiet gateflame-node-agent \
    && die "rolled back to the previous agent - it is running again. VPN NOT deployed." \
    || die "agent is down even after rollback. Backup: $BK_AGENT"
fi
ok "agent is running"

systemctl restart gateflame-kiosk.service || warn "kiosk unit did not restart cleanly"
sleep 2
ok "kiosk (Chromium): $(systemctl is-active gateflame-kiosk.service)"

# ---------------------------------------------------------------- read-back
hd "7/8  read-back - do the VPN routes actually answer now?"
FAIL=0
for r in /vpn/regions /vpn/continents /vpn/devices; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "http://127.0.0.1:8080/api/v1$r" || echo 000)
  # 200 = answering. 401 = route EXISTS but is scoped (also a pass - it is no
  # longer a 404, which is the whole point). 404 = still not deployed.
  case "$CODE" in
    200|401) ok "$r -> HTTP $CODE (route exists)" ;;
    404)     printf '    %s[FAIL]%s %s -> HTTP 404 (still missing)\n' "$c_err" "$c_z" "$r"; FAIL=1 ;;
    *)       warn "$r -> HTTP $CODE (unexpected, but not a 404)" ;;
  esac
done
[[ $FAIL -eq 0 ]] || die "VPN routes still 404 after deploy. Undo: cp -a $BK_AGENT/gateflame/*.py $DEST_AGENT/gateflame/ && systemctl restart gateflame-node-agent"

echo
echo "    What /vpn/regions actually returns:"
curl -s -m 8 http://127.0.0.1:8080/api/v1/vpn/regions | head -c 500
echo

# The device-name work only pays off if the client list is now the household
# and not 17 rows of duplicates and containers. Prove it here, on the box.
echo
echo "    --- /clients: are devices named and de-duplicated? ---"
curl -s -m 8 http://127.0.0.1:8080/api/v1/clients | python3 -c '
import json, sys
try:
    cs = json.load(sys.stdin).get("clients", [])
except Exception as e:
    print("      (could not read /clients:", e, ")"); raise SystemExit
if not cs:
    print("      no clients seen - the neighbour table may be cold")
for c in cs:
    ifaces = ",".join(c.get("interfaces") or [c.get("interface","")])
    print("      %-26s %-18s %-15s %s" % (c.get("label"), c.get("mac"), c.get("ip"), ifaces))
print("      %d household devices" % len(cs))
named = [c for c in cs if c.get("ownerName")]
print("      %d named by the owner" % len(named))
' || echo "      (client list check skipped)"

# ---------------------------------------------------------------- health
hd "8/8  is the box still healthy, and is it reporting to the dashboard?"
echo "    --- fleet feed (posts every 5 min; first one is on startup) ---"
sleep 3
journalctl -u gateflame-node-agent --since "-2 min" --no-pager 2>/dev/null \
  | grep -i "health feed" | tail -3 || echo "    (no feed log lines yet - it posts on its own schedule)"

echo "    --- /api/v1/system/status ---"
curl -s -m 8 http://127.0.0.1:8080/api/v1/system/status | head -c 300; echo
echo "    --- /api/v1/system/kiosk ---"
curl -s -m 8 http://127.0.0.1:8080/api/v1/system/kiosk | head -c 300; echo
echo "    --- is DNS still blocking? (resolver was never touched) ---"
docker exec gateflame-pihole pihole -q doubleclick.net 2>/dev/null | head -3 || echo "    (pihole query unavailable - check separately)"

cat <<EOF

${c_ok}================================================================${c_z}
  Done.

  The phone's Shield tab and the kiosk's Shield tab now have real
  routes to talk to. Open the app and pull to refresh, or reopen it.

  Backups kept:
    agent : $BK_AGENT
    kiosk : $BK_KIOSK

  Undo the agent:
    sudo cp -a $BK_AGENT/gateflame/*.py $DEST_AGENT/gateflame/ \\
      && sudo systemctl restart gateflame-node-agent
${c_ok}================================================================${c_z}
EOF
