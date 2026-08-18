#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - DNS FILTERING INSTALLER
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# Brings up Pi-hole + Unbound in Docker and points node-agent at them.
#
# WHAT THIS DOES NOT DO
#
# It does not touch your router, your DHCP, or any other device's DNS settings. After
# this runs, the box is CAPABLE of filtering and nothing on the LAN is using it yet.
# Making the network actually use it is a separate, deliberate step - see the closing
# output.
#
# The one thing it does change on THIS box: /etc/resolv.conf is left alone by default.
# Pass --use-locally to have the Pi itself resolve through its own Pi-hole.
#
# USAGE
#   sudo bash install-dns-stack.sh                 # bring the stack up
#   sudo bash install-dns-stack.sh --use-locally   # ...and resolve through it on this box
#   sudo bash install-dns-stack.sh --uninstall     # remove it all, restore resolv.conf
# ========================================================================================

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$HERE/dns-stack"
DROPIN_DIR="/etc/systemd/system/gateflame-node-agent.service.d"
RESOLV_BACKUP="/var/backups/gateflame-resolv.conf.orig"
LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
USE_LOCALLY=0

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[1;32m[ OK ]\033[0m %s\n' "$*"; }
warn() { printf '    \033[1;33m[WARN]\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ uninstall
if [[ "${1:-}" == "--uninstall" ]]; then
  say "Removing the DNS stack"
  (cd "$STACK" && docker compose down 2>/dev/null) || true
  rm -f "$DROPIN_DIR/40-pihole.conf"
  systemctl daemon-reload 2>/dev/null || true
  systemctl restart gateflame-node-agent 2>/dev/null || true
  if [[ -f "$RESOLV_BACKUP" ]]; then
    cp "$RESOLV_BACKUP" /etc/resolv.conf
    ok "restored /etc/resolv.conf from $RESOLV_BACKUP"
  fi
  ok "stack removed. Pi-hole data kept at $STACK/data - delete it by hand if you want it gone."
  echo
  echo "  If you pointed any device or your router at $LAN_IP for DNS, change it back NOW."
  exit 0
fi

[[ $EUID -eq 0 ]] || die "Run as root: sudo bash install-dns-stack.sh"

for arg in "$@"; do
  case "$arg" in
    --use-locally) USE_LOCALLY=1 ;;
    *) die "Unknown option: $arg" ;;
  esac
done

[[ -f "$STACK/docker-compose.yml" ]] || die "$STACK/docker-compose.yml not found"
[[ -n "$LAN_IP" ]] || die "could not determine this box's LAN address"

# ---------------------------------------------------------------- 1. prereqs
say "Step 1/5 - preflight"

command -v docker >/dev/null || die "docker not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin not available"
ok "docker $(docker --version | awk '{print $3}' | tr -d ,)"

# ---------------------------------------------------------------------------
# ARCHITECTURE GATE
#
# mvance/unbound:latest is amd64-ONLY - every published tag. It pulls without
# complaint on ARM64, starts, and dies in a restart loop with
# "exec /unbound.sh: exec format error". Pi-hole is then left with no upstream,
# so blocked domains still resolve from the local list while every clean lookup
# times out. That reads like a network fault and is not one; it cost an evening.
#
# This product runs on ARM64 by definition - Raspberry Pi 5 today, Orange Pi
# Zero 2W (Allwinner H618) for the base model. A silently-amd64 image is a
# recurring hazard, not a one-off, so every image is checked against THIS host's
# architecture before anything is started.
# ---------------------------------------------------------------------------
say "Checking image architectures against this host"

HOST_ARCH="$(docker version --format '{{.Server.Arch}}' 2>/dev/null || uname -m)"
case "$HOST_ARCH" in
  aarch64) HOST_ARCH="arm64" ;;
  x86_64)  HOST_ARCH="amd64" ;;
esac
ok "host architecture: $HOST_ARCH"

assert_image_arch() {
  local image="$1" arches
  # --verbose is REQUIRED, not optional.
  #
  # Plain `docker manifest inspect` on a SINGLE-architecture image returns the
  # bare v2 manifest, which has no "platform" block at all - so the arch list
  # comes back empty and the check skips. That is precisely backwards: the
  # single-arch images are the dangerous ones, and the first version of this
  # gate waved mvance/unbound straight through.
  #
  # --verbose wraps the manifest in a Descriptor that always carries platform,
  # for both single images and manifest lists. Reads the registry only - no pull.
  arches="$(docker manifest inspect --verbose "$image" 2>/dev/null \
            | grep -oE '"architecture"[[:space:]]*:[[:space:]]*"[a-z0-9]+"' \
            | sed -E 's/.*"([a-z0-9]+)"$/\1/' | sort -u | tr '\n' ' ')"

  if [[ -z "$arches" ]]; then
    # Fail closed. An unreadable manifest is exactly the state the amd64-only
    # image produced, and continuing on "probably fine" is how it got in.
    die "$image - cannot read its manifest, so its architecture is unknown. Refusing to deploy an image that may not run on $HOST_ARCH."
  fi
  if grep -qw "$HOST_ARCH" <<<"$arches"; then
    ok "$image supports $HOST_ARCH (has: ${arches% })"
  else
    warn "$image publishes ONLY: ${arches% }"
    die "$image has no $HOST_ARCH build. It would start and then die with 'exec format error'. Find a multi-arch replacement before continuing."
  fi
}

# Read the images straight out of the compose file so this can never drift from
# what is actually deployed.
while read -r img; do
  [[ -n "$img" ]] && assert_image_arch "$img"
done < <(grep -oP '(?<=^\s{4}image:\s).*' "$STACK/docker-compose.yml" 2>/dev/null | tr -d "'\"")


# Port 53 is the one that can break the box's own name resolution. Refuse rather than
# fight whatever is already there - UNLESS it is our own stack from a previous run,
# which is the normal case on a re-run and must not look like a conflict.
if ss -lntu 2>/dev/null | grep -qE "[:.]53\b"; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^gateflame-pihole$'; then
    ok "port 53 held by our own gateflame-pihole - re-running over it"
  else
    warn "something is already listening on port 53:"
    ss -lntup 2>/dev/null | grep -E "[:.]53\b" | sed 's/^/      /'
    die "free port 53 first. If it is systemd-resolved: systemctl disable --now systemd-resolved"
  fi
else
  ok "port 53 free"
fi

if ss -lnt 2>/dev/null | grep -qE "[:.]8081\b"; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^gateflame-pihole$'; then
    ok "port 8081 held by our own stack"
  else
    die "port 8081 in use - the Pi-hole admin UI needs it"
  fi
else
  ok "port 8081 free"
fi

# A DNS query helper that does not need dig.
#
# The first version of this script used `dig` for every check. Raspberry Pi OS Lite
# and Armbian ship neither dig nor nslookup nor drill, so the readiness probe failed
# on a stack that was working perfectly - Pi-hole was up and blocking, and the
# installer declared failure and told the operator to look at the logs.
#
# An installer must not depend on tools the target may not have. Python 3 is present
# on every image this product will ever run on, so the query is built by hand.
#
# NEVER RETURNS NON-ZERO. Under `set -e`, a function that exits 1 inside a command
# substitution kills the whole script with no output at all - which is exactly what
# happened on the second run: the script printed "unbound container running" and then
# vanished back to the prompt with no [FAIL] and no reason. Failure is signalled by
# printing an empty string, and the caller decides what that means.
dns_query() {
  local server="$1" name="$2"
  python3 - "$server" "$name" 2>/dev/null <<'PYEOF' || true
import socket, struct, random, sys
server, name = sys.argv[1], sys.argv[2]
tid = random.randint(0, 65535)
q = struct.pack('>HHHHHH', tid, 0x0100, 1, 0, 0, 0)
for part in name.split('.'):
    q += bytes([len(part)]) + part.encode()
q += b'\x00' + struct.pack('>HH', 1, 1)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(5)
try:
    s.sendto(q, (server, 53))
    data, _ = s.recvfrom(512)
except Exception:
    print(''); sys.exit(0)
finally:
    s.close()
ancount = struct.unpack('>H', data[6:8])[0]
if not ancount:
    print('NXDOMAIN'); sys.exit(0)
i = 12
while data[i]:
    i += data[i] + 1
i += 5
j = i + 2 + 2 + 2 + 4
rdlen = struct.unpack('>H', data[j:j+2])[0]
j += 2
print('.'.join(str(b) for b in data[j:j+4]) if rdlen == 4 else 'OK')
PYEOF
}

ok "LAN address: $LAN_IP"

# ---------------------------------------------------------------------------
# NETWORK SHAPE GATE
#
# Both checks below were added on 2026-08-18 after a live household reported
# "mobile devices keep losing connection" while a desktop on the same Wi-Fi was
# perfectly stable for 240 consecutive queries. Neither fault is visible from the
# box's own point of view - the box resolves fine in both - which is why they have
# to be asserted here rather than discovered later.
# ---------------------------------------------------------------------------
say "Checking the shape of this network"

# --- 1. Two addresses on one subnet -----------------------------------------
#
# If eth0 and wlan0 are both up on the same /24, the box has two addresses on one
# broadcast domain and port 53 is published on only ONE of them. Two things follow:
#
#   * Linux answers ARP for an address out of whichever interface the request
#     arrived on (net.ipv4.conf.*.arp_ignore defaults to 0). A client can ask "who
#     has $LAN_IP" and be told the OTHER interface's MAC. Its DNS then goes to an
#     interface where nothing is listening. Phones re-ARP constantly as they sleep,
#     wake and roam, so they hit this and stationary desktops mostly do not.
#   * mDNS/avahi publishes BOTH addresses for gateflame.local, so discovery can
#     hand a client the address that has no resolver on it.
#
# This is a warning, not a failure - the box still works today - but it is an
# unstable foundation for an appliance and it must be stated out loud.
SUBNET_PREFIX="$(echo "$LAN_IP" | cut -d. -f1-3)"
SAME_SUBNET_ADDRS="$(ip -4 -o addr show scope global 2>/dev/null \
                     | awk '{print $2" "$4}' | grep " ${SUBNET_PREFIX}\." || true)"
SAME_SUBNET_COUNT="$(grep -c . <<<"${SAME_SUBNET_ADDRS:-}" || true)"
if (( SAME_SUBNET_COUNT > 1 )); then
  warn "this box has $SAME_SUBNET_COUNT addresses on ${SUBNET_PREFIX}.0/24:"
  sed 's/^/        /' <<<"$SAME_SUBNET_ADDRS"
  warn "port 53 is published on $LAN_IP ONLY. Clients that reach the other address get no DNS."
  warn "ARP flux between the two interfaces will make this intermittent and per-device."
  warn "FIX: bring one interface down, or give them different subnets."
  warn "     e.g.  sudo nmcli connection down <the-wifi-or-ethernet-connection>"
else
  ok "one address on ${SUBNET_PREFIX}.0/24 - no ARP ambiguity"
fi

# --- 2. IPv6 advertised but not usable ---------------------------------------
#
# This box filters IPv4 only. If the router advertises IPv6 - a prefix plus an
# RDNSS option naming itself as DNS server - then Android and iOS will PREFER that
# IPv6 resolver and never ask this box anything. Filtering silently does not apply
# to the phones, which is bad enough on its own.
#
# It gets worse when the advertised IPv6 has no route to the internet, which is the
# common half-configured ISP-router state. The phone gets an address, believes the
# network is v6-capable, tries AAAA records first, and every one of those attempts
# stalls. Its connectivity validator fails, the OS decides the Wi-Fi is broken, and
# it drops to mobile data. That is the reported symptom exactly.
if ip -6 route show default 2>/dev/null | grep -q .; then
  ok "IPv6 has a default route - the LAN's IPv6 appears usable"
  warn "NOTE: this box does not filter IPv6. Clients using an IPv6 resolver bypass it."
elif ip -6 addr show scope global 2>/dev/null | grep -q 'inet6'; then
  warn "IPv6 addresses are configured on this box but there is NO IPv6 DEFAULT ROUTE."
  warn "The router is advertising IPv6 that does not reach the internet."
  warn "Phones prefer IPv6, will stall on every AAAA lookup, and will drop the Wi-Fi."
  warn "FIX, in order of preference:"
  warn "  1. Turn IPv6 OFF on the router entirely (cleanest), or"
  warn "  2. Make the router's IPv6 actually work end to end, or"
  warn "  3. As a last resort, suppress AAAA on this box:"
  warn "       echo 'GATEFLAME_DNSMASQ_LINES=filter-AAAA' >> $STACK/.env && docker compose up -d"
  warn "     (3) hides someone else's broken network. Prefer (1)."
else
  ok "no IPv6 on this LAN - nothing can bypass the filter over v6"
fi

# ------------------------------------------------------------- 2. the password
say "Step 2/5 - admin password"

ENV_FILE="$STACK/.env"
if [[ -f "$ENV_FILE" ]] && grep -q '^PIHOLE_PASSWORD=' "$ENV_FILE"; then
  ok "existing password kept ($ENV_FILE)"
else
  # Generated, not chosen, and never echoed to the terminal - a password read aloud in
  # a session transcript is a disclosed password.
  GENERATED="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  umask 077
  printf 'PIHOLE_PASSWORD=%s\n' "$GENERATED" > "$ENV_FILE"
  ok "password generated and written to $ENV_FILE (mode 600)"
  echo "        read it with:  sudo grep PIHOLE_PASSWORD $ENV_FILE"
fi

# The compose files publish port 53 on ${GATEFLAME_LAN_IP}. That used to be the
# literal 192.168.0.10 in both files, which meant this box could never be moved,
# renumbered, or deployed to a second network without editing YAML - and if DHCP
# changed the address, docker would refuse to bind and the household would have no
# DNS on every subsequent boot. The address is discovered here, from the live
# routing table, and rewritten on every run so it can never drift.
if grep -q '^GATEFLAME_LAN_IP=' "$ENV_FILE" 2>/dev/null; then
  PREV_IP="$(grep -oP '(?<=^GATEFLAME_LAN_IP=).*' "$ENV_FILE")"
  if [[ "$PREV_IP" != "$LAN_IP" ]]; then
    warn "LAN address changed since last run: $PREV_IP -> $LAN_IP (updating)"
  fi
  sed -i "s|^GATEFLAME_LAN_IP=.*|GATEFLAME_LAN_IP=$LAN_IP|" "$ENV_FILE"
else
  printf 'GATEFLAME_LAN_IP=%s\n' "$LAN_IP" >> "$ENV_FILE"
fi
ok "GATEFLAME_LAN_IP=$LAN_IP recorded in $ENV_FILE"

# ------------------------------------------------------------------ 3. bring up
say "Step 3/5 - starting Pi-hole and Unbound"
mkdir -p "$STACK/data/pihole"
cd "$STACK"
docker compose pull --quiet 2>&1 | tail -2 || true
docker compose up -d
ok "containers started"

say "Waiting for DNS to answer"
READY=0
for _ in $(seq 1 60); do
  if [[ -n "$(dns_query 127.0.0.1 pi.hole)" ]]; then READY=1; break; fi
  sleep 2
done
(( READY == 1 )) || {
  docker compose logs --tail 30
  die "Pi-hole did not answer on 127.0.0.1:53 within 120s"
}
ok "Pi-hole answering on 127.0.0.1:53"

# LOOPBACK IS NOT THE PRODUCT.
#
# 127.0.0.1:53 and $LAN_IP:53 are separate published sockets and they fail
# independently. Declaring success on loopback alone is how a box ships that
# resolves perfectly for itself and serves nothing to the house it is plugged into.
if [[ -n "$(dns_query "$LAN_IP" pi.hole)" ]]; then
  ok "Pi-hole answering on ${LAN_IP}:53 - the household-facing listener works"
else
  ss -lnup 2>/dev/null | grep -E "[:.]53\b" | sed 's/^/      /'
  die "Pi-hole answers on loopback but NOT on ${LAN_IP}:53. Nothing on the LAN can use it. Check the ports: block in docker-compose.yml and that $LAN_IP is still on an interface."
fi

# ---------------------------------------------------------------- 4. verify
say "Step 4/5 - verifying it actually filters"

# Unbound must be UP before a clean lookup can succeed. If its container is dead
# (wrong architecture is the classic cause) Pi-hole still answers blocked domains
# from its own list while every clean lookup times out - a half-failure that reads
# like a network problem and is not.
UNBOUND_STATE="$(docker inspect -f '{{.State.Status}}' gateflame-unbound 2>/dev/null || echo missing)"
if [[ "$UNBOUND_STATE" != "running" ]]; then
  warn "unbound is '$UNBOUND_STATE', not running:"
  docker logs gateflame-unbound --tail 5 2>&1 | sed 's/^/      /'
  die "unbound is not up - Pi-hole has no upstream, so clean lookups cannot work"
fi
ok "unbound container running"

RESOLVED=""
# Unbound is a RECURSIVE resolver with a cold cache on first start: it walks from the
# root servers down for every name, and the first few queries can exceed a 5s timeout
# while it primes root hints. A single-shot check here would report a broken stack
# that is merely warming up.
for _ in $(seq 1 12); do
  RESOLVED="$(dns_query 127.0.0.1 github.com)"
  [[ -n "$RESOLVED" && "$RESOLVED" != "NXDOMAIN" ]] && break
  sleep 5
done
if [[ -n "$RESOLVED" && "$RESOLVED" != "NXDOMAIN" ]]; then
  ok "clean lookup works: github.com -> $RESOLVED"
else
  warn "unbound direct check:"
  UP="$(dns_query 172.28.0.10 github.com)"
  echo "      172.28.0.10:53 -> ${UP:-no answer}"
  docker logs gateflame-unbound --tail 8 2>&1 | sed 's/^/      /'
  die "Pi-hole cannot resolve a clean domain after 60s. If the direct unbound query above WORKED, then FTLCONF_dns_upstreams is pointing at the wrong port."
fi

BLOCKED="$(dns_query 127.0.0.1 doubleclick.net)"
if [[ "$BLOCKED" == "0.0.0.0" || "$BLOCKED" == "NXDOMAIN" || -z "$BLOCKED" ]]; then
  ok "blocking works: doubleclick.net -> ${BLOCKED:-no answer}"
else
  warn "doubleclick.net resolved to $BLOCKED - gravity may still be building"
  warn "check again shortly, or run: docker exec gateflame-pihole pihole -g"
fi

# DNSSEC through unbound. If this fails the recursive path is not working and the box
# is quietly just forwarding.
if [[ -n "$(dns_query 127.0.0.1 dnssec.works)" ]]; then
  ok "recursive resolution via unbound works"
else
  warn "dnssec.works lookup failed - check: docker compose logs unbound"
fi

# ------------------------------------------------------- 5. tell the agent
say "Step 5/5 - pointing node-agent at Pi-hole"
mkdir -p "$DROPIN_DIR"

# Pi-hole v6's REST API is authenticated, so the agent needs the admin password
# to read query counts. The drop-in carries it, at mode 600 - it is a credential,
# not configuration, and it must never land in the repo.
PW="$(grep -oP '(?<=^PIHOLE_PASSWORD=).*' "$ENV_FILE" 2>/dev/null || true)"
umask 077
cat > "$DROPIN_DIR/40-pihole.conf" <<EOF
[Service]
Environment=GATEFLAME_PIHOLE_URL=http://127.0.0.1:8081
Environment=GATEFLAME_PIHOLE_PASSWORD=${PW}
EOF
chmod 600 "$DROPIN_DIR/40-pihole.conf"
systemctl daemon-reload
systemctl restart gateflame-node-agent 2>/dev/null || warn "node-agent not running"
sleep 5
# -A2, not -A1. The services JSON splits on commas into three lines per module -
# id, label, status - so -A1 stops one line short of the thing being tested and
# reports "status seen: none" about a module that is running perfectly.
AGENT_DNS="$(curl -fsS http://127.0.0.1:8080/api/v1/services 2>/dev/null | tr ',' '\n' | grep -A2 module_dns_filter | grep status || true)"
if grep -q 'running' <<<"$AGENT_DNS"; then
  ok "agent reports DNS filtering RUNNING"
  curl -fsS http://127.0.0.1:8080/api/v1/telemetry/summary 2>/dev/null \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('      queries today  :', d.get('totalQueriesToday'))
print('      blocked today  :', d.get('queriesBlockedToday'))
print('      block %        :', d.get('blockPercentage'))
print('      gravity domains:', d.get('domainsOnGravity'))
" 2>/dev/null || true
else
  warn "agent still reports DNS filtering degraded"
  warn "  status seen: ${AGENT_DNS:-none}"
  warn "  check: journalctl -u gateflame-node-agent -n 20"
fi

if (( USE_LOCALLY )); then
  say "Pointing THIS box's own resolver at Pi-hole"
  [[ -f "$RESOLV_BACKUP" ]] || cp /etc/resolv.conf "$RESOLV_BACKUP"
  printf 'nameserver 127.0.0.1\nnameserver 1.1.1.1\n' > /etc/resolv.conf
  ok "/etc/resolv.conf updated (original saved to $RESOLV_BACKUP)"
  warn "NetworkManager may overwrite this on reconnect - that is fine, re-run to reapply"
fi

# ------------------------------------------------------------------- report
cat <<EOF

  ─────────────────────────────────────────────────────────────────────
  THE BOX IS NOW FILTERING. YOUR NETWORK IS NOT USING IT YET.
  ─────────────────────────────────────────────────────────────────────

  Admin UI ....... http://${LAN_IP}:8081/admin
  Password ....... sudo grep PIHOLE_PASSWORD $ENV_FILE
  DNS server ..... ${LAN_IP}

  TEST IT FROM ONE DEVICE FIRST - do not touch the router yet:

    Windows : Wi-Fi adapter > IPv4 > Preferred DNS = ${LAN_IP}
    Android : Wi-Fi > network > Advanced > IP settings Static > DNS 1 = ${LAN_IP}
    Any     : nslookup doubleclick.net ${LAN_IP}   (expect 0.0.0.0)

  Watch the queries arrive at http://${LAN_IP}:8081/admin - that is the proof the
  device is really using it.

  ONLY when one device works, consider the router:

    Router DHCP > DNS servers > ${LAN_IP} AND NOTHING ELSE.

    DO NOT SET A SECONDARY DNS SERVER. This instruction used to say "secondary
    1.1.1.1" and it was wrong - it contradicted the design of this product and
    the watchdog that implements it.

    Clients do not treat a secondary as a failover. They query primary and
    secondary in arbitrary order, often in parallel, and take whichever answers
    first. A share of every household's queries would therefore bypass filtering
    during NORMAL operation. An ad appears on one page load and not the next,
    and nobody can explain why. Intermittent protection is worse than none,
    because it is not honest about what it is doing.

    What happens if this box dies is handled properly instead:
    dns-watchdog.sh checks that DNS is genuinely answering - on loopback AND on
    ${LAN_IP} - every 60 seconds, restarts the stack, recreates it if a restart
    is not enough, and after five consecutive failed minutes drops into an
    unfiltered bypass resolver on this same address so the household gets its
    internet back. The box stays the only resolver; it just stops filtering, and
    says so loudly.

  ALSO CHECK ON THE ROUTER - these break phones specifically:

    IPv6. If the router advertises IPv6 it will also advertise ITSELF as the IPv6
    DNS server. Phones prefer IPv6 and will ask the router, not this box, so
    filtering will not apply to them at all. If that IPv6 additionally has no
    working route to the internet, phones stall on every AAAA lookup, decide the
    Wi-Fi is broken, and drop to mobile data. Turn IPv6 off on the router unless
    it genuinely works end to end.

    Verify the router really forwards. From a PC:
      nslookup doubleclick.net <router-ip>     -> must be 0.0.0.0
    A real address means the router kept its own upstream resolver and your
    setting did not take effect, whatever its web UI claims.

  UNDO EVERYTHING
    sudo bash install-dns-stack.sh --uninstall

EOF
