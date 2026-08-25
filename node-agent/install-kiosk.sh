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
#   sudo bash install-kiosk.sh /path/to/dist-kiosk                # auto-detect display
#   sudo bash install-kiosk.sh /path/to/dist-kiosk --display :0   # force a display
#   sudo bash install-kiosk.sh --uninstall
#
# DISPLAY DETECTION
#
# An earlier version took a --vnc flag that hardcoded DISPLAY=:1. That was an
# assumption, and it was wrong on the very first machine it met: wabakipi runs
# its VNC server on port 5900, which is display :0, not :1. The unit would have
# restart-looped on "cannot open display" with nothing obviously at fault.
#
# The display is therefore DETECTED - from the X sockets that actually exist
# and the VNC ports that are actually listening (5900+N = display :N).
# --display overrides it when you know better.
# ========================================================================================

set -euo pipefail

KIOSK_DIR="/opt/gateflame/kiosk"
UNIT="gateflame-kiosk.service"
DROPIN_DIR="/etc/systemd/system/gateflame-node-agent.service.d"
KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-pi}}"
PORT="${GATEFLAME_PORT:-8080}"
DISPLAY_VAL=""   # empty => auto-detect
SESSION_KIND=""  # wayland | x11


# Detect the graphical session: Wayland or X11.
#
# HISTORY, BECAUSE THIS HAS BEEN WRONG TWICE.
#
# v1 hardcoded DISPLAY=:1. Wrong: this Pi's VNC is on port 5900, i.e. :0.
#
# v2 detected the display from X sockets and VNC ports. Also wrong, and more
# subtly: Raspberry Pi OS 13 (Trixie) runs WAYLAND via labwc, and Xwayland
# still publishes /tmp/.X11-unix/X0. So the socket existed, the detection
# concluded X11, and the unit launched Chromium with DISPLAY=:0 and no
# XDG_RUNTIME_DIR, WAYLAND_DISPLAY or DBUS_SESSION_BUS_ADDRESS. Chromium came
# up, grabbed the whole output fullscreen and rendered BLACK - on both the
# HDMI console and the VNC session - while the journal filled with
# "Failed to connect to the bus: Could not parse server address".
#
# The lesson: an Xwayland socket proves Xwayland is running, NOT that the
# session is X11. Check for a Wayland socket FIRST, because on a Wayland
# session both exist.
detect_session() {
    local uid runtime sock
    uid="$(id -u "$KIOSK_USER" 2>/dev/null || echo "")"
    [ -n "$uid" ] || return 1
    runtime="/run/user/${uid}"

    # 1. Wayland first - on Trixie both sockets exist and Wayland is the truth.
    if [ -d "$runtime" ]; then
        for sock in "$runtime"/wayland-*; do
            case "$sock" in *.lock) continue ;; esac
            [ -S "$sock" ] || continue
            SESSION_KIND="wayland"
            WAYLAND_SOCK="${sock##*/}"
            XDG_RUNTIME="$runtime"
            return 0
        done
    fi

    # 2. Genuine X11: an X socket with no Wayland socket beside it.
    local n
    for n in 0 1 2 3 4; do
        if [ -e "/tmp/.X11-unix/X${n}" ]; then
            SESSION_KIND="x11"
            DISPLAY_VAL=":${n}"
            return 0
        fi
    done

    return 1
}

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

[[ $EUID -eq 0 ]] || die "Run as root:  sudo bash install-kiosk.sh <dist-kiosk> [--display :N]"

SRC="${1:-}"
[[ -n "$SRC" ]] || die "Give me the dist-kiosk directory."
[[ -f "$SRC/index.html" ]] || die "$SRC has no index.html - run 'npm run build:html-kiosk' first."
[[ -d "$SRC/assets" ]] || warn "$SRC has no assets/ - the page will render blank."

for arg in "${@:2}"; do
  case "$arg" in
    --display) die "--display needs a value, e.g. --display :0" ;;
    --display=*) DISPLAY_VAL="${arg#*=}" ;;
    --display\ *) DISPLAY_VAL="${arg#* }" ;;
    :[0-9]*) DISPLAY_VAL="$arg" ;;
    --vnc)
      # Kept so the old instruction does not silently do the wrong thing.
      die "--vnc is gone. The session type is detected now (Wayland vs X11). Omit it, or pass --display :N to force bare X11" ;;
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

if [[ -n "$DISPLAY_VAL" ]]; then
  SESSION_KIND="x11"
  ok "session: X11 on $DISPLAY_VAL (forced with --display)"
else
  if detect_session; then
    case "$SESSION_KIND" in
      wayland) ok "session: Wayland ($WAYLAND_SOCK, XDG_RUNTIME_DIR=$XDG_RUNTIME)" ;;
      x11)     ok "session: X11 on $DISPLAY_VAL" ;;
    esac
  else
    die "No graphical session found for user $KIOSK_USER. Log in at the console or start a VNC session, then re-run - or pass --display :0 for a bare X11 setup."
  fi
fi

# Order after graphical.target only when it exists. A VNC-only or Wayland user
# session is brought up by the user's own session manager and may not be
# ordered by that target at all, so waiting on it can hang the unit.
if systemctl list-unit-files graphical.target >/dev/null 2>&1; then
  EXTRA_AFTER="graphical.target"
else
  EXTRA_AFTER=""
fi

# Build the environment and browser flags for the session we actually found.
#
# Wayland needs XDG_RUNTIME_DIR, WAYLAND_DISPLAY and DBUS_SESSION_BUS_ADDRESS.
# Omitting the last one is what produced the black screen: Chromium started,
# could not reach the session bus, and never painted.
if [[ "$SESSION_KIND" == "wayland" ]]; then
  UID_VAL="$(id -u "$KIOSK_USER")"
  SESSION_ENV=$(cat <<ENVEOF
Environment=XDG_RUNTIME_DIR=$XDG_RUNTIME
Environment=WAYLAND_DISPLAY=$WAYLAND_SOCK
Environment=XDG_SESSION_TYPE=wayland
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME/bus
ENVEOF
)
  # --ozone-platform=wayland makes Chromium a native Wayland client instead of
  # routing through Xwayland, which is what a labwc session expects.
  PLATFORM_FLAGS="--ozone-platform=wayland"
else
  SESSION_ENV=$(cat <<ENVEOF
Environment=DISPLAY=$DISPLAY_VAL
Environment=XAUTHORITY=/home/$KIOSK_USER/.Xauthority
Environment=XDG_SESSION_TYPE=x11
ENVEOF
)
  PLATFORM_FLAGS="--ozone-platform=x11"
fi

cat > "/etc/systemd/system/$UNIT" <<EOF
[Unit]
Description=Gate^Flame device kiosk (Chromium)
After=network-online.target gateflame-node-agent.service $EXTRA_AFTER
Wants=gateflame-node-agent.service

[Service]
Type=simple
User=$KIOSK_USER
$SESSION_ENV
ExecStartPre=/bin/sh -c 'until curl -fsS http://127.0.0.1:$PORT/api/v1/system/status >/dev/null; do sleep 2; done'
ExecStart=$BROWSER \\
  $PLATFORM_FLAGS \\
  --kiosk --incognito --noerrdialogs --disable-infobars \\
  --disable-session-crashed-bubble \\
  --check-for-update-interval=31536000 \\
  --enable-low-end-device-mode \\
  --renderer-process-limit=1 \\
  --process-per-site \\
  --disable-dev-shm-usage \\
  --disk-cache-size=8388608 \\
  --js-flags=--max-old-space-size=96 \\
  --disable-background-networking \\
  --disable-component-update \\
  --disable-extensions \\
  --disable-default-apps \\
  --disable-sync \\
  --disable-breakpad \\
  --no-first-run \\
  --no-default-browser-check \\
  --force-color-profile=srgb \\
  --disable-features=TranslateUI,Translate,BackForwardCache,OptimizationHints,MediaRouter,InterestFeedContentSuggestions,CalculateNativeWinOcclusion \\
  http://localhost:$PORT/device-kiosk/
Restart=always
RestartSec=5

# THE RESOLVER MUST OUTLIVE THE WALL PANEL.
#
# The base model is an Orange Pi Zero 2W with 2 GB. Chromium's default
# behaviour on such a board is to expand until the kernel starts reclaiming,
# and what the kernel reclaims is whatever it feels like - which can be
# Pi-hole. A household losing its display is a cosmetic fault. A household
# losing DNS is an outage.
#
# MemoryHigh throttles and reclaims from Chromium FIRST, before the OOM killer
# is ever consulted, so pressure lands on the expendable process by design
# rather than by luck. MemoryMax is the hard stop; with Restart=always the
# panel comes back on its own and nobody phones anyone.
#
# Measure before changing these: gateflame-memcheck.sh prints real RSS.
MemoryHigh=420M
MemoryMax=560M

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
  Session ....... $SESSION_KIND ${DISPLAY_VAL}${WAYLAND_SOCK:-}

  PAIR A PHONE
      curl -s -X POST http://127.0.0.1:$PORT/api/v1/pair/request

  LOGS
      journalctl -u $UNIT -f
      journalctl -u gateflame-node-agent -f

  UNINSTALL
      sudo bash install-kiosk.sh --uninstall

EOF
