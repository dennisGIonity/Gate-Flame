#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME — ONE-SHOT PI DEPLOYMENT
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Document ID: DOC-2026-08-015-PIDEP | Version: 1.0 | Updated: 2026-08-15 SAST
# Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
# Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
# Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
# ========================================================================================
#
# Run this ON the Pi, as root:   sudo bash deploy-on-pi.sh
#
# It does four things, in order, and stops at the first real failure:
#   1. installs OS prerequisites the agent needs (python venv, iproute2, nftables)
#   2. runs node-agent/install.sh (systemd unit, venv, service enabled + started)
#   3. drops a systemd override granting CAP_NET_ADMIN / CAP_NET_RAW so the
#      firewall and DPI modules can report `running` instead of `degraded`
#   4. runs node-agent/validate-on-pi.sh and prints the PASS/FAIL table
#
# Everything it does is reversible: see UNINSTALL at the bottom of this file.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${GATEFLAME_PORT:-8080}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root:  sudo bash deploy-on-pi.sh" >&2
  exit 1
fi

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. preflight ─────────────────────────────────────────────────────────────
# Cheap checks first, so a run fails in five seconds with a clear reason rather
# than five minutes into a pip build.
say "0/4  Preflight"

MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
echo "  model:   ${MODEL:-<unknown — not a Pi?>}"
echo "  kernel:  $(uname -srm)"
echo "  os:      $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo unknown)"
echo "  python:  $(python3 -V 2>&1)"
echo "  arch:    $(dpkg --print-architecture 2>/dev/null || uname -m)"

case "$MODEL" in
  *Raspberry*) : ;;
  *) warn "This does not report as Raspberry Pi hardware. Deployment will still" \
          "proceed, but validate-on-pi.sh will fail its first check by design —" \
          "a PASS on thermal or throttle readings off real hardware proves nothing." ;;
esac

# python3-venv is the single most common missing piece on a fresh image, and its
# absence surfaces as an opaque ensurepip error much later.
python3 -c 'import ensurepip' 2>/dev/null || warn "python3-venv looks absent — installing it below."

# Port conflict. Pi-hole ships lighttpd on :80, but a second Gate^Flame install,
# a stray uvicorn, or Home Assistant can all be sitting on :8080.
if command -v ss >/dev/null 2>&1; then
  HOLDER="$(ss -lntp "sport = :${PORT}" 2>/dev/null | awk 'NR>1' || true)"
  if [ -n "$HOLDER" ]; then
    if echo "$HOLDER" | grep -q 'uvicorn\|gateflame'; then
      echo "  port ${PORT}: held by a previous Gate^Flame agent — it will be replaced."
    else
      die "Port ${PORT} is already in use by something that is not Gate^Flame:
  ${HOLDER}
Free it, or re-run with a different port:
  sudo GATEFLAME_PORT=8081 bash deploy-on-pi.sh"
    fi
  else
    echo "  port ${PORT}: free"
  fi
fi

# Free space. A venv with uvicorn[standard] and psutil needs ~120 MB; a full
# card fails the pip step in a way that reads like a network error.
AVAIL_MB="$(df -Pm /opt 2>/dev/null | awk 'NR==2{print $4}')"
echo "  free on /opt: ${AVAIL_MB:-?} MB"
[ -n "${AVAIL_MB:-}" ] && [ "$AVAIL_MB" -lt 250 ] && die "Less than 250 MB free on /opt. Free some space first."

# ── 1. prerequisites ─────────────────────────────────────────────────────────
say "1/4  Installing OS prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || warn "apt-get update failed — continuing with the cached index."

# build-essential + python3-dev are here for psutil. On 64-bit Raspberry Pi OS
# PyPI has an aarch64 wheel and these go unused; on 32-bit armv7l there is no
# manylinux wheel, so pip falls back to a source build and needs a compiler and
# Python headers. Without them the failure is a wall of gcc output ending in
# "fatal error: Python.h: No such file or directory", which reads like a broken
# package rather than a missing dependency.
apt-get install -y -qq \
  python3-venv python3-pip python3-dev build-essential \
  iproute2 nftables curl ca-certificates avahi-daemon avahi-utils \
  || die "Prerequisite install failed. Check network and apt sources, then re-run."

# vcgencmd lives in raspi-utils or libraspberrypi-bin depending on OS release.
# Not fatal if absent — validate-on-pi.sh reports it honestly either way.
apt-get install -y -qq raspi-utils 2>/dev/null || apt-get install -y -qq libraspberrypi-bin 2>/dev/null || true
command -v vcgencmd >/dev/null 2>&1 || warn "vcgencmd not available — throttle flags will report as a named gap."

# ── 2. the agent itself ──────────────────────────────────────────────────────
say "2/4  Installing node-agent"
cd "$HERE/node-agent"
bash install.sh

# ── 3. capabilities ──────────────────────────────────────────────────────────
# install.sh deliberately ships without these. Granting them is a separate,
# visible decision because they are real privilege: CAP_NET_ADMIN lets the
# process change the kernel firewall, CAP_NET_RAW lets it open raw sockets.
# This is still far narrower than running the unit as root.
say "3/4  Granting CAP_NET_ADMIN / CAP_NET_RAW"
mkdir -p /etc/systemd/system/gateflame-node-agent.service.d
cat > /etc/systemd/system/gateflame-node-agent.service.d/10-capabilities.conf <<'EOF'
# Gate^Flame — capabilities required by module_firewall_bounce and module_dpi_flow.
# Without these both modules report `degraded` with this file as the remedy,
# which is correct behaviour, not a bug. Delete this file to revoke them.
[Service]
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW
EOF

# ProtectSystem=strict in the base unit makes /etc read-only for the process.
# nft needs to read /etc/nftables.conf but never writes it, so strict stays.
systemctl daemon-reload
systemctl restart gateflame-node-agent
sleep 3
systemctl --no-pager --lines=0 status gateflame-node-agent || true

# ── 3b. mDNS name ────────────────────────────────────────────────────────────
# The phone app's first discovery candidate is http://gateflame.local:8080.
# Publishing that alias means a customer never types an IP, and it keeps working
# when DHCP moves the node. This is an *alias* — the Pi's own hostname is left
# alone, so nothing else on the box changes.
say "3b/4  Publishing gateflame.local over mDNS"
cat > /etc/avahi/services/gateflame.service <<'EOF'
<?xml version="1.0" standalone='no'?><!--*-nxml-*-->
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Gate^Flame Node on %h</name>
  <service>
    <type>_http._tcp</type>
    <port>8080</port>
    <txt-record>path=/api/v1/system/status</txt-record>
  </service>
</service-group>
EOF
systemctl enable --now avahi-daemon
# avahi-publish runs in the foreground, so it needs its own unit to survive.
#
# The address is resolved at START time by a wrapper, not baked into the unit.
# A unit with a hardcoded IP goes stale the moment DHCP moves the node, and the
# failure mode is the worst kind: gateflame.local still resolves, to an address
# nothing is listening on, so the phone reports "found a node" and then times
# out on every call.
install -m 0755 /dev/stdin /usr/local/bin/gateflame-mdns-alias <<'WRAP'
#!/usr/bin/env bash
# Publishes gateflame.local -> this node's current primary IPv4 address.
# Re-resolved on every start, so a DHCP lease change is fixed by a restart.
set -euo pipefail
for _ in $(seq 1 30); do
  ip4="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
  [ -n "${ip4:-}" ] && break
  sleep 2   # network-online.target can fire before DHCP has actually finished
done
if [ -z "${ip4:-}" ]; then
  echo "gateflame-mdns-alias: no primary IPv4 address yet; giving up this attempt" >&2
  exit 1
fi
echo "gateflame-mdns-alias: publishing gateflame.local -> ${ip4}"
exec /usr/bin/avahi-publish -a -R gateflame.local "${ip4}"
WRAP

cat > /etc/systemd/system/gateflame-mdns-alias.service <<'EOF'
[Unit]
Description=Publish gateflame.local as an mDNS alias for this node
After=avahi-daemon.service network-online.target
Wants=network-online.target
Requires=avahi-daemon.service

[Service]
ExecStart=/usr/local/bin/gateflame-mdns-alias
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now avahi-daemon
systemctl daemon-reload
systemctl enable --now gateflame-mdns-alias
sleep 2
LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
if systemctl is-active --quiet gateflame-mdns-alias; then
  echo "gateflame.local -> ${LAN_IP:-<resolving>}"
else
  warn "mDNS alias did not start. The app can still reach the node by address."
  systemctl --no-pager --lines=5 status gateflame-mdns-alias || true
fi

# ── 4. validation ────────────────────────────────────────────────────────────
say "4/4  Validating against real hardware"

# Wait for the agent to actually answer before validating it. systemd reports a
# Type=simple unit "active" the instant it forks, which is well before uvicorn
# has bound the port — validating in that window fails a check that would have
# passed a second later, which is worse than no check at all.
READY=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/v1/system/status" >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 1
done
if [ "$READY" -eq 1 ]; then
  echo "  agent answering on :${PORT}"
else
  warn "Agent did not answer on :${PORT} within 30s. Recent log:"
  journalctl -u gateflame-node-agent --no-pager --lines=40 || true
fi

set +e
bash "$HERE/node-agent/validate-on-pi.sh"
VALIDATE_RC=$?
set -e

say "Node identity"
curl -s "http://127.0.0.1:${PORT}/api/v1/system/status" || echo "agent not answering on port ${PORT}"
echo

say "Module capability report (honest — 'degraded' means a named gap, not a crash)"
curl -s "http://127.0.0.1:${PORT}/api/v1/services" || true
echo

# ── diagnostic bundle ────────────────────────────────────────────────────────
# One file with everything needed to diagnose a failure remotely, so a problem
# costs one round trip instead of ten.
REPORT="/tmp/gateflame-deploy-report.txt"
{
  echo "GATE^FLAME DEPLOY REPORT"
  echo "generated: $(date -Is)"
  echo "validate-on-pi.sh exit code: ${VALIDATE_RC}"
  echo
  echo "== hardware =="
  echo "model:  ${MODEL:-unknown}"
  echo "kernel: $(uname -srm)"
  echo "os:     $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
  echo "arch:   $(dpkg --print-architecture 2>/dev/null || uname -m)"
  echo "python: $(python3 -V 2>&1)"
  echo
  echo "== service =="
  systemctl --no-pager --lines=0 status gateflame-node-agent 2>&1 || true
  echo
  echo "== drop-ins =="
  cat /etc/systemd/system/gateflame-node-agent.service.d/*.conf 2>/dev/null || echo "(none)"
  echo
  echo "== mdns alias =="
  systemctl --no-pager --lines=0 status gateflame-mdns-alias 2>&1 || true
  echo
  echo "== listening sockets =="
  ss -lntp 2>/dev/null | grep -E "State|:${PORT}" || echo "(nothing on :${PORT})"
  echo
  echo "== capabilities of the running process =="
  PID="$(systemctl show -p MainPID --value gateflame-node-agent 2>/dev/null)"
  if [ -n "${PID:-}" ] && [ "$PID" != "0" ]; then
    grep -E 'CapAmb|CapEff|Groups' "/proc/$PID/status" 2>/dev/null || true
  else
    echo "(no main pid)"
  fi
  echo
  echo "== external tools =="
  for t in ip nft vcgencmd avahi-publish curl; do
    printf '%-14s %s\n' "$t" "$(command -v $t || echo MISSING)"
  done
  echo
  echo "== api: system/status =="
  curl -s --max-time 5 "http://127.0.0.1:${PORT}/api/v1/system/status" 2>&1; echo
  echo "== api: services =="
  curl -s --max-time 5 "http://127.0.0.1:${PORT}/api/v1/services" 2>&1; echo
  echo "== api: telemetry/summary =="
  curl -s --max-time 5 "http://127.0.0.1:${PORT}/api/v1/telemetry/summary" 2>&1; echo
  echo "== api: clients =="
  curl -s --max-time 5 "http://127.0.0.1:${PORT}/api/v1/clients" 2>&1; echo
  echo
  echo "== validate-on-pi.sh (re-run, captured) =="
  bash "$HERE/node-agent/validate-on-pi.sh" 2>&1 || true
  echo
  echo "== last 120 log lines =="
  journalctl -u gateflame-node-agent --no-pager --lines=120 2>&1 || true
} > "$REPORT" 2>&1
chmod 0644 "$REPORT"

cat <<EOF

────────────────────────────────────────────────────────────────────────────
This node is reachable at:
    http://${LAN_IP:-<this-pi-ip>}:${PORT}
    http://gateflame.local:${PORT}        (mDNS — what the app tries first)

NEXT: pair your phone.

There is no kiosk display on this node yet, and pairing codes are issued only
to loopback callers — so issue one from this shell:

    curl -s -X POST http://127.0.0.1:${PORT}/api/v1/pair/request

Type the 6-digit code into the Gate^Flame app on your phone within 5 minutes.
Five wrong guesses destroys that code; just request another.

validate-on-pi.sh exit code: ${VALIDATE_RC}   (0 = every required check passed)

A full diagnostic report was written to:
    ${REPORT}

If anything above failed, send me that one file — it has the hardware, the
service state, the granted capabilities, every API response and the last 120
log lines, which is everything needed to diagnose it without a shell.
────────────────────────────────────────────────────────────────────────────

UNINSTALL (all of it, in this order):
    systemctl disable --now gateflame-node-agent gateflame-mdns-alias
    rm -f  /etc/systemd/system/gateflame-mdns-alias.service
    rm -f  /usr/local/bin/gateflame-mdns-alias
    rm -f  /etc/avahi/services/gateflame.service
    rm -rf /etc/systemd/system/gateflame-node-agent.service.d
    rm -f  /etc/systemd/system/gateflame-node-agent.service
    systemctl daemon-reload
    rm -rf /opt/gateflame /var/lib/gateflame
    userdel gateflame

EOF
exit $VALIDATE_RC
