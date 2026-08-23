#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - ANNOUNCE THIS BOX AS A DNS SERVER (IPv6 RDNSS)
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# WHY
#
# Phones prefer IPv6. If the router advertises itself as the IPv6 DNS server and
# we say nothing, every handset on the network asks the router and our filtering
# never applies to them. That was the live 2026-08-18 fault.
#
# So we announce ourselves - and ONLY that.
#
# WHAT THIS DELIBERATELY DOES NOT DO
#
#   AdvDefaultLifetime 0   We are NOT a router. A lifetime of zero is the
#                          standards-defined way to send an RA that carries
#                          options without offering to route anything. Get this
#                          wrong and every device on the LAN starts sending us
#                          its internet traffic - which for a side-car box means
#                          a black hole, and for the customer means the internet
#                          stopped working the moment they plugged us in.
#
#   No prefix              We advertise no PIO. Handing out addresses is the
#                          router's job and two sources of addressing on one LAN
#                          is the worst failure this product could cause.
#
# HONEST LIMIT
#
# This does not remove the router's own RDNSS. RDNSS has no preference field, so
# clients keep every server they are told about and some queries will still go to
# the router unfiltered. Closing that gap needs the one-time router handshake
# (router_handshake.py) or the premium in-path build. This narrows the gap; it
# does not close it, and the kiosk must not claim otherwise.
#
# USAGE
#   gateflame-ra-advertiser --enable --dns <our-ipv6>
#   gateflame-ra-advertiser --disable
#   gateflame-ra-advertiser --status
# ========================================================================================
set -uo pipefail

CONF=/etc/radvd.conf
MARKER="# managed-by-gateflame"
ACTION=""
DNS_ADDR=""
IFACE="${GATEFLAME_LAN_IFACE:-}"

log() { logger -t gateflame-ra "$*" 2>/dev/null; echo "$*"; }
die() { log "FAIL: $*"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --enable)  ACTION=enable ;;
    --disable) ACTION=disable ;;
    --status)  ACTION=status ;;
    --dns)     DNS_ADDR="${2:-}"; shift ;;
    --iface)   IFACE="${2:-}"; shift ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done
[[ -n "$ACTION" ]] || die "one of --enable, --disable, --status is required"

if [[ "$ACTION" == "status" ]]; then
  if [[ -f "$CONF" ]] && grep -q "$MARKER" "$CONF"; then
    echo "advertising: yes"
    grep -E 'interface|AdvRDNSSAddress|AdvDefaultLifetime' "$CONF" | sed 's/^/  /'
  else
    echo "advertising: no"
  fi
  systemctl is-active radvd 2>/dev/null || true
  exit 0
fi

[[ $EUID -eq 0 ]] || die "must run as root"

if [[ "$ACTION" == "disable" ]]; then
  # Only remove OUR config. A radvd.conf we did not write belongs to someone
  # else and taking it away would break whatever they set it up for.
  if [[ -f "$CONF" ]] && grep -q "$MARKER" "$CONF"; then
    rm -f "$CONF"
    systemctl disable --now radvd >/dev/null 2>&1
    log "stopped advertising"
  else
    log "nothing of ours to remove"
  fi
  exit 0
fi

# ------------------------------------------------------------------- enable
[[ -n "$DNS_ADDR" ]] || die "--dns <address> is required with --enable"

# Refuse to advertise an address this box does not actually hold. Announcing a
# resolver that is not there is worse than announcing nothing: clients would add
# it, try it, and time out on every lookup.
if ! ip -6 addr show 2>/dev/null | grep -qF "$DNS_ADDR"; then
  die "$DNS_ADDR is not an address on this box - refusing to advertise a resolver that does not exist"
fi

# The interface must be the one facing the household, not docker's bridge.
if [[ -z "$IFACE" ]]; then
  IFACE="$(ip -4 route show default 2>/dev/null | awk '{print $5; exit}')"
fi
[[ -n "$IFACE" ]] || die "could not determine the LAN interface"
case "$IFACE" in
  docker*|br-*|veth*|lo) die "$IFACE is not a household-facing interface - refusing" ;;
esac

command -v radvd >/dev/null 2>&1 || {
  log "installing radvd"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq radvd >/dev/null 2>&1 \
    || die "could not install radvd"
}

# net.ipv6.conf.all.forwarding must be on for radvd to start at all. That is a
# radvd requirement, not us becoming a router - AdvDefaultLifetime 0 below is
# what guarantees nobody routes through us.
sysctl -qw net.ipv6.conf.all.forwarding=1 2>/dev/null || true

if [[ -f "$CONF" ]] && ! grep -q "$MARKER" "$CONF"; then
  cp -a "$CONF" "${CONF}.pre-gateflame" 2>/dev/null || true
  log "existing radvd.conf backed up to ${CONF}.pre-gateflame"
fi

cat > "$CONF" <<EOF
$MARKER
# Gate^Flame announces itself as a DNS server and nothing else.
# AdvDefaultLifetime 0 = "I am not a router, do not send me your traffic".
# No prefix is advertised - addressing stays the router's job.
interface $IFACE
{
    AdvSendAdvert on;
    AdvDefaultLifetime 0;
    AdvManagedFlag off;
    AdvOtherConfigFlag off;
    MinRtrAdvInterval 30;
    MaxRtrAdvInterval 100;

    RDNSS $DNS_ADDR
    {
        AdvRDNSSLifetime 300;
    };
};
EOF
chmod 644 "$CONF"

systemctl enable radvd >/dev/null 2>&1
systemctl restart radvd >/dev/null 2>&1
sleep 2

if systemctl is-active --quiet radvd; then
  log "advertising $DNS_ADDR as a DNS server on $IFACE (not as a router)"
else
  journalctl -u radvd -n 10 --no-pager 2>/dev/null | sed 's/^/    /'
  rm -f "$CONF"
  systemctl disable --now radvd >/dev/null 2>&1
  die "radvd would not start - config removed, nothing is being advertised"
fi
