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
    Router DHCP > DNS servers > primary ${LAN_IP}, secondary 1.1.1.1
    The secondary matters: if this box dies the house degrades to unfiltered
    internet rather than no internet.

  UNDO EVERYTHING
    sudo bash install-dns-stack.sh --uninstall

EOF
