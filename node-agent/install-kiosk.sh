#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - DEVICE KIOSK INSTALLER (RUN ON THE PI)
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
# Classification: PUBLIC | Building Tomorrow, Today.
# ========================================================================================
#
# WHAT THE KIOSK IS
#
# NOT an Android app. Chromium in --kiosk mode running ON the Pi, pointed at
# http://localhost:8080/device-kiosk. Loopback is what grants `kiosk` scope -
# physical presence at the appliance IS the authorisation, which is why pairing
# codes can only ever be issued to a loopback caller.
#
# USAGE
#   sudo bash install-kiosk.sh /path/to/dist-kiosk           # HDMI console (:0)
#   sudo bash install-kiosk.sh /path/to/dist-kiosk --vnc     # VNC display (:1)
#   sudo bash install-kiosk.sh --uninstall
# ========================================================================================

set -euo pipefail

KIOSK_DIR="/opt/gateflame/kiosk"
UNIT="gateflame-kiosk.service"
DROPIN_DIR="/etc/systemd/system/gateflame-node-agent.service.d"
KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-pi}}"
PORT="${GATEFLAME_PORT:-8080}"
MODE="hdmi"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[1;32m[ OK ]\033[0m %s\n' "$*"; }
warn() { printf '    \033[1;33m[WARN]\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl disable --now "$UNIT" 2>/dev/null || true
  rm -f "/etc/systemd/system/$UNIT" "$DROPIN_DIR/30-kiosk.conf"
  systemctl daemon-reload
  systemctl restart gateflame-node-agent 2>/dev/null || true
  rm -rf "$KIOSK_DIR"
  ok "kiosk removed. node-agent still running; /device-kiosk now 404s honestly."
  exit 0
fi

[[ $EUID -eq 0 ]] || die "Run as root:  sudo bash install-kiosk.sh <dist-kiosk> [--vnc]"

SRC="${1:-}"
[[ -n "$SRC" ]] || die "Give me the dist-kiosk directory."
[[ -f "$SRC/index.html" ]] || die "$SRC has no index.html - run 'npm run build:html-kiosk' first."
[[ -d "$SRC/assets" ]] || warn "$SRC has no assets/ - the page will render blank."

for arg in "${@:2}"; do
  case "$arg" in
    --vnc) MODE="vnc" ;;
    *) die "Unknown option: $arg" ;;
  esac
done

# ------------------------------------------------------------- 1. the bundle
say "Step 1/4 - installing the kiosk bundle"

# Integrity first. This repo has had binaries destroyed by text-mode transfer
# three times (gradle-wrapper.jar, the release tarball, all 26 Android PNGs).
# Do not install a bundle whose assets arrived the same way.
BAD=0
while IFS= read -r -d '' f; do
  if grep -qa $'\xef\xbf\xbd' "$f" 2>/dev/null; then
    warn "U+FFFD in $(basename "$f")"; BAD=$((BAD+1))
  fi
done < <(find "$SRC" -type f \( -name '*.woff*' -o -name '*.png' -o -name '*.jpg' -o -name '*.ico' \) -print0)
(( BAD == 0 )) || die "$BAD corrupt asset(s) - re-copy with scp, in binary."

rm -rf "$KIOSK_DIR"; mkdir -p "$KIOSK_DIR"
cp -r "$SRC"/. "$KIOSK_DIR"/
chown -R root:root "$KIOSK_DIR"; chmod -R a+rX "$KIOSK_DIR"
ok "bundle at $KIOSK_DIR ($(du -sh "$KIOSK_DIR" | cut -f1))"

# --------------------------------------------------------- 2. tell the agent
say "Step 2/4 - pointing node-agent at it"
mkdir -p "$DROPIN_DIR"
cat > "$DROPIN_DIR/30-kiosk.conf" <<EOF
[Service]
Environment=GATEFLAME_KIOSK_DIR=$KIOSK_DIR
EOF
systemctl daemon-reload
systemctl restart gateflame-node-agent
sleep 3

STATE="$(curl -fsS "http://127.0.0.1:$PORT/api/v1/system/kiosk" 2>/dev/null || echo '{}')"
echo "    $STATE"
grep -q '"mounted":true' <<<"$STATE" || die "agent reports kiosk NOT mounted - see the gap field."
ok "agent serving /device-kiosk"

# Prove every asset resolves. "HTML served" and "kiosk works" are not the same
# thing, and the difference is a blank screen.
say "Verifying assets resolve"
MISSING=0
while read -r A; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$A")"
  if [[ "$CODE" == "200" ]]; then printf '    [ OK ] %s\n' "$A"
  else printf '    \033[1;31m[%s]\033[0m %s\n' "$CODE" "$A"; MISSING=$((MISSING+1)); fi
done < <(curl -fsS "http://127.0.0.1:$PORT/device-kiosk/" | grep -o '/assets/[A-Za-z0-9._-]*' | sort -u)
(( MISSING == 0 )) || die "$MISSING asset(s) did not resolve - the kiosk would render blank."
ok "all assets resolve"

# ------------------------------------------------------------ 3. the browser
say "Step 3/4 - installing the browser session"
BROWSER=""
for c in chromium-browser chromium google-chrome; do
  command -v "$c" >/dev/null && { BROWSER="$c"; break; }
done
if [[ -z "$BROWSER" ]]; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium-browser \
    || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium
  for c in chromium-browser chromium; do command -v "$c" >/dev/null && { BROWSER="$c"; break; }; done
fi
[[ -n "$BROWSER" ]] || die "no chromium available"
ok "browser: $BROWSER"

if [[ "$MODE" == "vnc" ]]; then
  DISPLAY_VAL=":1"; EXTRA_AFTER=""
  warn "VNC mode: your VNC session on :1 must already be running."
else
  DISPLAY_VAL=":0"; EXTRA_AFTER="graphical.target"
fi

cat > "/etc/systemd/system/$UNIT" <<EOF
[Unit]
Description=Gate^Flame device kiosk (Chromium)
After=network-online.target gateflame-node-agent.service $EXTRA_AFTER
Wants=gateflame-node-agent.service

[Service]
Type=simple
User=$KIOSK_USER
Environment=DISPLAY=$DISPLAY_VAL
Environment=XAUTHORITY=/home/$KIOSK_USER/.Xauthority
ExecStartPre=/bin/sh -c 'until curl -fsS http://127.0.0.1:$PORT/api/v1/system/status >/dev/null; do sleep 2; done'
ExecStart=$BROWSER \\
  --kiosk --incognito --noerrdialogs --disable-infobars \\
  --disable-session-crashed-bubble --disable-features=TranslateUI \\
  --check-for-update-interval=31536000 \\
  http://localhost:$PORT/device-kiosk/
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
EOF

systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null
ok "unit installed: $UNIT"

# ------------------------------------------------------------------ 4. start
say "Step 4/4 - starting"
systemctl restart "$UNIT" || warn "start failed - journalctl -u $UNIT -n 40"
sleep 4
systemctl is-active --quiet "$UNIT" && ok "kiosk running" || warn "not active yet; check the journal"

LAN="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
cat <<EOF

  Kiosk ......... http://localhost:$PORT/device-kiosk/
  From a desk ... http://${LAN:-<pi-ip>}:$PORT/device-kiosk/
  Display ....... $DISPLAY_VAL ($MODE)

  PAIR A PHONE
      curl -s -X POST http://127.0.0.1:$PORT/api/v1/pair/request

  LOGS
      journalctl -u $UNIT -f
      journalctl -u gateflame-node-agent -f

  UNINSTALL
      sudo bash install-kiosk.sh --uninstall

EOF
