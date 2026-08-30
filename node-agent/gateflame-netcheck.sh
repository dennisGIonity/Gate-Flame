#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - NETWORK SHAPE CHECK
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# WHY THIS EXISTS
#
# On 2026-08-18 a live household reported that mobile devices kept losing their
# connection. Every check the box performs on itself said it was healthy, and it was:
# a desktop on the same Wi-Fi resolved 240 consecutive queries through it with zero
# failures and zero slow responses.
#
# The faults were all OUTSIDE the box's own view of itself:
#
#   1. The router was never actually forwarding to the box.
#   2. The router advertised IPv6 - including itself as the IPv6 DNS server - on a
#      LAN with no IPv6 route to the internet. Phones prefer IPv6. They asked the
#      router instead of the box (so no filtering), stalled on every AAAA lookup,
#      failed their connectivity validation, and dropped the Wi-Fi.
#   3. The box is dual-homed on ONE subnet while port 53 is published on ONE of its
#      two addresses.
#   4. The watchdog only ever probed 127.0.0.1, so none of this could raise an alarm.
#
# A health check that only looks inward will pass in all four states. This one looks
# outward. Read-only: it changes nothing.
#
# USAGE
#   bash gateflame-netcheck.sh              # check
#   bash gateflame-netcheck.sh --json       # machine-readable summary
#
# EXIT CODES
#   0  nothing wrong found
#   1  at least one FAIL
# ========================================================================================

set -uo pipefail

JSON=0
[[ "${1:-}" == "--json" ]] && JSON=1

FAILS=0
WARNS=0
RESULTS=()

c_ok=$'\033[1;32m'; c_warn=$'\033[1;33m'; c_fail=$'\033[1;31m'; c_hd=$'\033[1;36m'; c_z=$'\033[0m'
hd()   { (( JSON )) || printf '\n%s==> %s%s\n' "$c_hd" "$*" "$c_z"; }
pass() { RESULTS+=("PASS|$1|$2"); (( JSON )) || printf '    %s[PASS]%s %s\n' "$c_ok" "$c_z" "$2"; }
warn() { WARNS=$((WARNS+1)); RESULTS+=("WARN|$1|$2"); (( JSON )) || printf '    %s[WARN]%s %s\n' "$c_warn" "$c_z" "$2"; }
fail() { FAILS=$((FAILS+1)); RESULTS+=("FAIL|$1|$2"); (( JSON )) || printf '    %s[FAIL]%s %s\n' "$c_fail" "$c_z" "$2"; }
note() { (( JSON )) || printf '           %s\n' "$*"; }

# A DNS query with no dig/nslookup dependency - neither Raspberry Pi OS Lite nor
# Armbian ship them, and a diagnostic that needs an absent binary reports a working
# network as broken. Prints the first A record, "NXDOMAIN", or nothing on timeout.
dns_query() {
  local server="$1" name="$2" timeout="${3:-5}"
  python3 - "$server" "$name" "$timeout" 2>/dev/null <<'PYEOF' || true
import socket, struct, random, sys
server, name, timeout = sys.argv[1], sys.argv[2], float(sys.argv[3])
q = struct.pack('>HHHHHH', random.randint(0, 65535), 0x0100, 1, 0, 0, 0)
for part in name.split('.'):
    q += bytes([len(part)]) + part.encode()
q += b'\x00' + struct.pack('>HH', 1, 1)
fam = socket.AF_INET6 if ':' in server else socket.AF_INET
s = socket.socket(fam, socket.SOCK_DGRAM)
s.settimeout(timeout)
try:
    s.sendto(q, (server, 53))
    data, _ = s.recvfrom(1024)
except Exception:
    print(''); sys.exit(0)
finally:
    s.close()
if struct.unpack('>H', data[6:8])[0] == 0:
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

LAN_IP="${GATEFLAME_LAN_IP:-$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')}"
GATEWAY="$(ip -4 route show default 2>/dev/null | awk '{print $3; exit}')"
STACK="${GATEFLAME_DNS_STACK:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dns-stack}"

(( JSON )) || cat <<BANNER
========================================================================================
GATE^FLAME NETWORK SHAPE CHECK          $(date -Is)
  this box  : ${LAN_IP:-UNKNOWN}
  router    : ${GATEWAY:-UNKNOWN}
========================================================================================
BANNER

# ---------------------------------------------------------------- 1. addresses
hd "1. This box's addresses"

if [[ -z "$LAN_IP" ]]; then
  fail addr "could not determine this box's LAN address - no default route?"
else
  pass addr "LAN address: $LAN_IP"
fi

SUBNET_PREFIX="$(echo "${LAN_IP:-0.0.0.0}" | cut -d. -f1-3)"
mapfile -t SAME_SUBNET < <(ip -4 -o addr show scope global 2>/dev/null \
                           | awk '{print $2" "$4}' | grep " ${SUBNET_PREFIX}\." || true)
if (( ${#SAME_SUBNET[@]} > 1 )); then
  fail dualhome "DUAL-HOMED ON ONE SUBNET: ${#SAME_SUBNET[@]} addresses on ${SUBNET_PREFIX}.0/24"
  for a in "${SAME_SUBNET[@]}"; do note "$a"; done
  note "Port 53 is published on $LAN_IP only. A client that reaches the other"
  note "address gets no DNS at all. Worse, Linux answers ARP for an address out of"
  note "whichever interface the request arrived on, so a client can ask for $LAN_IP"
  note "and be handed the OTHER interface's MAC - intermittent, per-device, and"
  note "hardest on phones because they re-ARP every time they sleep, wake or roam."
  note "FIX: take one interface down, or move them to different subnets."
elif (( ${#SAME_SUBNET[@]} == 1 )); then
  pass dualhome "single address on ${SUBNET_PREFIX}.0/24 - no ARP ambiguity"
fi

# ------------------------------------------------------------- 2. the listener
hd "2. Is DNS actually being served, and where"

LOOP_ANS="$(dns_query 127.0.0.1 pi.hole)"
if [[ -n "$LOOP_ANS" ]]; then
  pass loopback "127.0.0.1:53 answers ($LOOP_ANS)"
else
  fail loopback "127.0.0.1:53 does not answer - the resolver is down on this box"
fi

if [[ -n "$LAN_IP" ]]; then
  LAN_ANS="$(dns_query "$LAN_IP" pi.hole)"
  if [[ -n "$LAN_ANS" ]]; then
    pass lanlistener "${LAN_IP}:53 answers ($LAN_ANS) - the household-facing listener is alive"
  else
    fail lanlistener "${LAN_IP}:53 DOES NOT ANSWER - nothing on the LAN can resolve through this box"
    note "This is the silent outage: loopback can look perfectly healthy while the"
    note "entire household has no DNS. Check 'ss -lnup | grep :53' and the ports:"
    note "block in $STACK/docker-compose.yml."
  fi
fi

# Every OTHER address this box holds should also be checked - if discovery or mDNS
# hands a client one of them, it needs to work or the client needs to never see it.
for entry in "${SAME_SUBNET[@]}"; do
  other="$(awk '{print $2}' <<<"$entry" | cut -d/ -f1)"
  [[ "$other" == "$LAN_IP" ]] && continue
  if [[ -n "$(dns_query "$other" pi.hole 3)" ]]; then
    pass otheraddr "${other}:53 also answers"
  else
    fail otheraddr "${other}:53 is SILENT while ${other}:8080 serves the API"
    note "avahi publishes both addresses for gateflame.local, and the app's first"
    note "discovery candidate is gateflame.local - so a client can be handed this"
    note "address, reach the API on it happily, and have no resolver behind it."
  fi
done

# ------------------------------------------------------------- 3. the filter
hd "3. Is it filtering, and is it resolving"

BLOCKED="$(dns_query 127.0.0.1 doubleclick.net)"
if [[ "$BLOCKED" == "0.0.0.0" || "$BLOCKED" == "NXDOMAIN" ]]; then
  pass filtering "blocking works: doubleclick.net -> $BLOCKED"
elif [[ -z "$BLOCKED" ]]; then
  fail filtering "no answer for doubleclick.net - resolver not responding"
else
  fail filtering "doubleclick.net resolved to $BLOCKED - NOT BLOCKING. Gravity may be empty."
  note "run: docker exec gateflame-pihole pihole -g"
fi

CLEAN="$(dns_query 127.0.0.1 github.com 8)"
if [[ -n "$CLEAN" && "$CLEAN" != "NXDOMAIN" ]]; then
  pass recursion "clean lookup works: github.com -> $CLEAN"
else
  fail recursion "clean lookups fail while blocked ones work - unbound is down or unreachable"
  note "Pi-hole answers blocked domains from its own list without any upstream, so"
  note "this exact half-failure looks like a network fault and is not one."
  note "check: docker inspect -f '{{.State.Status}}' gateflame-unbound"
fi

# --------------------------------------------------------------- 4. the router
hd "4. Is the router actually using this box"

if [[ -z "$GATEWAY" ]]; then
  warn router "no default gateway found - cannot test the router"
else
  R_BLOCKED="$(dns_query "$GATEWAY" doubleclick.net)"
  if [[ "$R_BLOCKED" == "0.0.0.0" || "$R_BLOCKED" == "NXDOMAIN" ]]; then
    pass router "the router forwards to this box (doubleclick.net -> $R_BLOCKED via $GATEWAY)"
  elif [[ -z "$R_BLOCKED" ]]; then
    warn router "$GATEWAY did not answer DNS - it may not run a resolver at all"
  else
    fail router "THE ROUTER IS NOT USING THIS BOX. $GATEWAY resolves doubleclick.net -> $R_BLOCKED"
    note "Any device that takes DNS from DHCP is being handed the router, and the"
    note "router is answering from its own upstream. Filtering does not apply to"
    note "them at all, whatever the router's web UI claims was saved."
    note "FIX: router DHCP settings > DNS server = $LAN_IP, and NOTHING as secondary."
    note "Then re-run this check. Devices need a DHCP lease renewal to pick it up."
  fi
fi

# ----------------------------------------------------------------- 5. IPv6
hd "5. IPv6 - the one that specifically breaks phones"

HAS_V6_ADDR=0; HAS_V6_ROUTE=0
ip -6 addr show scope global 2>/dev/null | grep -q 'inet6' && HAS_V6_ADDR=1
ip -6 route show default 2>/dev/null | grep -q . && HAS_V6_ROUTE=1

if (( HAS_V6_ADDR == 0 )); then
  pass ipv6 "no global IPv6 on this LAN - nothing can bypass the filter over v6"
elif (( HAS_V6_ROUTE == 1 )); then
  warn ipv6 "IPv6 is present AND routed. This box filters IPv4 only."
  note "Any client using an IPv6 resolver bypasses filtering entirely. Either turn"
  note "IPv6 off on the router, or accept that phones are unfiltered."
else
  fail ipv6 "IPv6 IS ADVERTISED BUT HAS NO DEFAULT ROUTE - addressing without internet"
  ip -6 addr show scope global 2>/dev/null | awk '/inet6/{print "           "$2}'
  note "This is the phone-killer. The router hands out an IPv6 prefix and names"
  note "itself as IPv6 DNS server (RDNSS). Android and iOS PREFER IPv6:"
  note "  - they ask the router, not this box, so filtering never applies to them"
  note "  - they try AAAA records first, and those connections cannot complete"
  note "  - their connectivity validator fails, the OS marks the Wi-Fi as having"
  note "    no internet, and the handset drops to mobile data"
  note "Desktops are unaffected: Windows ranks ULA below IPv4 in RFC 6724."
  note "FIX, best first:"
  note "  1. Turn IPv6 OFF on the router."
  note "  2. Or make the router's IPv6 work end to end."
  note "  3. Last resort, hide it here: add GATEFLAME_DNSMASQ_LINES=filter-AAAA"
  note "     to $STACK/.env and 'docker compose up -d'."
fi

# ------------------------------------------------------- 6. rate limiting
hd "6. Pi-hole rate limiting"

RL="$(docker exec gateflame-pihole pihole-FTL --config dns.rateLimit.count 2>/dev/null || true)"
if [[ -z "$RL" ]]; then
  warn ratelimit "could not read dns.rateLimit.count from FTL (container down?)"
elif [[ "$RL" == "0" ]]; then
  pass ratelimit "rate limiting disabled (count=0) - correct for a forwarding router"
else
  fail ratelimit "RATE LIMIT IS $RL QUERIES PER WINDOW - this will black out the whole house"
  note "When the router forwards, every query in the household arrives from ONE"
  note "source address. A normal home passes 1000/min easily. On trip, FTL REFUSES"
  note "every further query from that address until the window rolls - so the whole"
  note "house loses DNS in ~one-minute blocks, repeatedly, with nothing in any UI."
  note "FIX: FTLCONF_dns_rateLimit_count=0 in docker-compose.yml, then up -d."
fi

# ---------------------------------------------------------- 7. bypass state
hd "7. Protection state"

if [[ -f /var/lib/gateflame/bypass ]]; then
  fail bypass "THIS BOX IS IN BYPASS since $(cat /var/lib/gateflame/bypass 2>/dev/null)"
  note "DNS is being served UNFILTERED. The household is not protected."
else
  pass bypass "not in bypass - filtering is the active mode"
fi

if systemctl is-active --quiet gateflame-dns-watchdog.timer 2>/dev/null; then
  pass watchdog "dns-watchdog timer is active"
else
  warn watchdog "gateflame-dns-watchdog.timer is not active - nothing is monitoring DNS"
  note "install with: sudo bash install-watchdog.sh"
fi

# ------------------------------------------------------- 8. connectivity quality
hd "8. Connectivity quality"
#
# Bucketing idea from surveying AntwerpDesignsIonity/NetworkzeroMonitor
# (2026-08-30): a plain "up/down" check misses the state that actually
# frustrates a household - the WAN answering, but slowly or with loss. Same
# dns_query() used everywhere else in this script, no new dependency.

Q_TARGETS=("1.1.1.1" "8.8.8.8" "9.9.9.9")
Q_OK=0; Q_TOTAL=0; Q_SLOW=0
for t in "${Q_TARGETS[@]}"; do
  Q_TOTAL=$((Q_TOTAL+1))
  start_ns=$(date +%s%N)
  ans="$(dns_query "$t" cloudflare.com 3)"
  end_ns=$(date +%s%N)
  ms=$(( (end_ns - start_ns) / 1000000 ))
  if [[ -n "$ans" ]]; then
    Q_OK=$((Q_OK+1))
    (( ms > 800 )) && Q_SLOW=$((Q_SLOW+1))
  fi
done

if (( Q_OK == Q_TOTAL && Q_SLOW == 0 )); then
  pass quality "Excellent - $Q_OK/$Q_TOTAL upstream resolvers answered, all under 800ms"
elif (( Q_OK > 0 )); then
  warn quality "Degraded - $Q_OK/$Q_TOTAL upstream resolvers answered ($Q_SLOW slow)"
  note "Slow or partial upstream answers here usually mean the WAN itself, not this"
  note "box - check the router's own internet connection before anything else."
else
  fail quality "None - 0/$Q_TOTAL upstream resolvers answered at all"
  note "This box has no working path to the internet. Everything else in this"
  note "report can look healthy while this is true - a household with no WAN"
  note "still gets a resolver that answers doubleclick.net correctly."
fi

# --------------------------------------------------- 9. cross-server DNS agreement
hd "9. Cross-server DNS agreement"
#
# Same NetworkzeroMonitor idea: resolve one CLEAN (never blocked) domain
# through this box and through a public resolver, and compare. This is a
# sanity check, not a security scanner - it catches the box's own upstream
# being wrong, not a sophisticated hijack, and a mismatch is a lead to
# follow, not proof of anything on its own.

CMP_DOMAIN="wikipedia.org"
CMP_LOCAL="$(dns_query 127.0.0.1 "$CMP_DOMAIN" 5)"
CMP_PUBLIC="$(dns_query 1.1.1.1 "$CMP_DOMAIN" 5)"

if [[ -z "$CMP_LOCAL" || -z "$CMP_PUBLIC" ]]; then
  warn crosscheck "could not compare - this box: '${CMP_LOCAL:-no answer}', 1.1.1.1: '${CMP_PUBLIC:-no answer}'"
elif [[ "$CMP_LOCAL" == "$CMP_PUBLIC" ]]; then
  pass crosscheck "$CMP_DOMAIN agrees with 1.1.1.1 ($CMP_LOCAL)"
else
  warn crosscheck "$CMP_DOMAIN differs: this box -> $CMP_LOCAL, 1.1.1.1 -> $CMP_PUBLIC"
  note "Large sites often serve different, equally correct answers from a CDN per"
  note "resolver location - this alone is not a fault. Worth a second look only if"
  note "paired with a FAIL elsewhere in this report, or if the household reports"
  note "a specific site behaving oddly."
fi

# ------------------------------------------------------------------ summary
if (( JSON )); then
  printf '{"fails":%d,"warns":%d,"lan_ip":"%s","gateway":"%s","results":[' \
         "$FAILS" "$WARNS" "${LAN_IP:-}" "${GATEWAY:-}"
  sep=""
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r st id msg <<<"$r"
    printf '%s{"status":"%s","check":"%s","message":"%s"}' \
           "$sep" "$st" "$id" "${msg//\"/\\\"}"
    sep=","
  done
  printf ']}\n'
else
  echo
  echo "========================================================================================"
  if (( FAILS == 0 && WARNS == 0 )); then
    printf '%s  ALL CHECKS PASSED%s\n' "$c_ok" "$c_z"
  else
    printf '  %d FAIL, %d WARN\n' "$FAILS" "$WARNS"
    echo
    echo "  Fix in this order - each one can mask the next:"
    echo "    1. router forwarding   (nothing is filtered until this is right)"
    echo "    2. IPv6                (phones bypass and drop until this is right)"
    echo "    3. dual-homing         (makes everything intermittent and unexplainable)"
    echo "    4. rate limiting       (whole-house blackouts once the router forwards)"
  fi
  echo "========================================================================================"
fi

(( FAILS == 0 ))
