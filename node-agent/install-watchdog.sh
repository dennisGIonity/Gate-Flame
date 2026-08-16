#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - INSTALL THE DNS WATCHDOG
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# Installs dns-watchdog.sh on a 60-second systemd timer.
#
# Run this BEFORE pointing a router at this box. Once the box is the network's only
# resolver, it being down means the house has no internet at all - so the resilience
# has to exist before the dependency does, not after.
#
#   sudo bash install-watchdog.sh
#   sudo bash install-watchdog.sh --uninstall
# ========================================================================================

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="/usr/local/bin/gateflame-dns-watchdog"
UNIT="/etc/systemd/system/gateflame-dns-watchdog.service"
TIMER="/etc/systemd/system/gateflame-dns-watchdog.timer"

ok()   { printf '    \033[1;32m[ OK ]\033[0m %s\n' "$*"; }
say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl disable --now gateflame-dns-watchdog.timer 2>/dev/null || true
  rm -f "$UNIT" "$TIMER" "$TARGET"
  systemctl daemon-reload
  ok "watchdog removed"
  exit 0
fi

[[ $EUID -eq 0 ]] || die "Run as root: sudo bash install-watchdog.sh"
[[ -f "$HERE/dns-watchdog.sh" ]] || die "dns-watchdog.sh not found next to this script"

say "Installing the watchdog"
install -m 755 "$HERE/dns-watchdog.sh" "$TARGET"
ok "$TARGET"

cat > "$UNIT" <<EOF
[Unit]
Description=Gate^Flame DNS watchdog - verifies the resolver is answering
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
Environment=GATEFLAME_DNS_STACK=$HERE/dns-stack
ExecStart=$TARGET
# The watchdog restarts containers, so it needs root. It touches nothing outside
# the docker socket and /var/lib/gateflame.
User=root
EOF

cat > "$TIMER" <<'EOF'
[Unit]
Description=Run the Gate^Flame DNS watchdog every minute

[Timer]
# Start checking a minute after boot - the stack needs time to come up, and
# alarming about a resolver that is still starting is noise.
OnBootSec=60s
OnUnitActiveSec=60s
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now gateflame-dns-watchdog.timer >/dev/null
ok "timer enabled, running every 60s"

say "Making the DNS stack restart itself too"
# Belt and braces. `restart: unless-stopped` in compose covers a crashed container;
# the watchdog covers a container that is running but not ANSWERING - which is the
# failure that actually takes a household offline, and the one docker cannot see.
if systemctl is-enabled docker >/dev/null 2>&1; then
  ok "docker starts at boot, so the stack returns after a power cut"
else
  systemctl enable docker >/dev/null 2>&1 && ok "enabled docker at boot"
fi

say "First run"
"$TARGET" && ok "watchdog reports DNS healthy" || die "watchdog reports DNS is NOT healthy - fix that before going further"

cat <<EOF

  Watchdog ....... every 60s, restarts the stack if DNS stops answering
  Escalation ..... 1 miss = wait, 2 = restart, 3+ = full recreate
  Logs ........... journalctl -t gateflame-dns-watchdog -f
  Timer status ... systemctl status gateflame-dns-watchdog.timer

  The box can now survive a container dying, a wedge, or a power cut without a
  human. That is the precondition for letting the router hand it out as the
  network's only DNS server.

EOF
