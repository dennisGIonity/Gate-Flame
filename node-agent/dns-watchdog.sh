#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - DNS WATCHDOG
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# WHY THIS EXISTS
#
# Once the router hands out this box as the network's only DNS server, the box being
# down means the house has no internet. Not degraded - none. Nothing resolves.
#
# The tempting fix is to hand out 1.1.1.1 as a DHCP secondary. That does NOT work as a
# fallback: clients query primary and secondary in arbitrary order, often in parallel,
# so a large share of queries would bypass filtering entirely. Filtering would become
# intermittent and unexplainable - an ad appears sometimes and not others.
#
# So the box is the sole resolver, and the answer to "what if it dies" is that it must
# not die. This watchdog is that answer:
#
#   - checks that DNS is genuinely ANSWERING, not merely that a container is "up"
#   - restarts the stack when it is not
#   - escalates to a full compose recreate if a plain restart does not fix it
#   - never touches the router; recovery of last resort is documented, not automated
#
# Run from a systemd timer every 60s. Logs to the journal.
#
# EXIT CODES
#   0 healthy (or successfully recovered)
#   1 unhealthy and recovery failed - this is the state a human must see
# ========================================================================================

set -uo pipefail   # deliberately NOT -e: a failing check must be handled, not fatal

STACK="${GATEFLAME_DNS_STACK:-/home/wabapi/node-agent/dns-stack}"
PROBE_DOMAIN="${GATEFLAME_PROBE_DOMAIN:-dns.google}"
STATE_DIR="/var/lib/gateflame"
FAIL_COUNT_FILE="$STATE_DIR/dns-watchdog-fails"
BYPASS_FLAG="$STATE_DIR/bypass"

# Five consecutive minutes of a resolver that will not answer, after a restart and a
# recreate have both failed. At that point the household has had no internet for five
# minutes and the priority stops being "keep filtering" and becomes "give them their
# internet back".
BYPASS_AFTER_FAILS="${GATEFLAME_BYPASS_AFTER:-5}"

mkdir -p "$STATE_DIR" 2>/dev/null || true

log() { logger -t gateflame-dns-watchdog "$*"; echo "$*"; }

# Every compose invocation goes through this.
#
# dns-stack/.env holds the Pi-hole admin password at mode 600, owned by root -
# correct, it is a credential. But `docker compose` READS .env to interpolate
# ${PIHOLE_PASSWORD}, so any invocation that is not root fails with
#
#     open .../dns-stack/.env: permission denied
#
# and, because compose exits non-zero without starting anything, does so
# silently from the caller's point of view.
#
# The watchdog runs as root under systemd so it would not have hit this. It was
# found by running the bypass test by hand as wabapi: bypass engaged correctly,
# and then leave_bypass() could not bring filtering back - the box would have
# sat unfiltered forever, retrying every ten minutes and failing identically
# each time. The most dangerous kind of bug: only reachable on the recovery
# path, so it stays invisible until the day it matters.
#
# Using sudo -n explicitly means the script behaves the same whether systemd or
# a human started it, and fails loudly rather than quietly if it cannot.
compose() {
  if [[ $EUID -eq 0 ]]; then
    docker compose "$@"
  else
    sudo -n docker compose "$@"
  fi
}

# A real DNS query. No dig/nslookup dependency - neither Trixie nor Armbian ship them,
# and a watchdog that depends on an absent binary reports a healthy service as dead.
dns_answers() {
  python3 - "$PROBE_DOMAIN" <<'PYEOF' 2>/dev/null
import socket, struct, random, sys
name = sys.argv[1]
q = struct.pack('>HHHHHH', random.randint(0, 65535), 0x0100, 1, 0, 0, 0)
for part in name.split('.'):
    q += bytes([len(part)]) + part.encode()
q += b'\x00' + struct.pack('>HH', 1, 1)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(5)
try:
    s.sendto(q, ('127.0.0.1', 53))
    data, _ = s.recvfrom(512)
except Exception:
    sys.exit(1)
finally:
    s.close()
# Any answer at all means the resolver is alive. A blocked domain returning 0.0.0.0
# is still a healthy resolver, so answer COUNT is not the test - a response is.
sys.exit(0 if len(data) > 12 else 1)
PYEOF
}

read_fails() { cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0; }
write_fails() { echo "$1" > "$FAIL_COUNT_FILE" 2>/dev/null || true; }

in_bypass() { [[ -f "$BYPASS_FLAG" ]]; }

enter_bypass() {
  log "ENTERING BYPASS - the household has had no DNS for ${BYPASS_AFTER_FAILS} minutes"
  cd "$STACK" || return 1
  # Take the filtered stack fully down first. Bypass binds the same port 53, so both
  # cannot run at once - which is deliberate: it makes it structurally impossible for
  # queries to leak past the filter while things are healthy.
  compose down >/dev/null 2>&1
  compose -f docker-compose.bypass.yml up -d >/dev/null 2>&1
  sleep 5
  if dns_answers; then
    date -Iseconds > "$BYPASS_FLAG"
    log "BYPASS ACTIVE - internet restored, UNFILTERED. Household is NOT protected."
    return 0
  fi
  log "FATAL: bypass resolver also failed to answer. The box cannot serve DNS at all."
  compose -f docker-compose.bypass.yml down >/dev/null 2>&1
  return 1
}

leave_bypass() {
  log "attempting to restore filtered DNS"
  cd "$STACK" || return 1
  compose -f docker-compose.bypass.yml down >/dev/null 2>&1
  compose up -d >/dev/null 2>&1
  for _ in $(seq 1 20); do
    sleep 3
    if dns_answers; then
      rm -f "$BYPASS_FLAG"
      write_fails 0
      log "FILTERING RESTORED - household protected again"
      return 0
    fi
  done
  # Could not get the filtered stack back. Put bypass back rather than leaving the
  # house with nothing - a degraded product beats a broken one, every time.
  log "could not restore filtering - returning to bypass"
  compose down >/dev/null 2>&1
  compose -f docker-compose.bypass.yml up -d >/dev/null 2>&1
  return 1
}

# ------------------------------------------------------------------ bypass path
# While in bypass, DNS is answering (that is the point), so the healthy check below
# would report all-clear and never try to restore filtering. Handle it first.
if in_bypass; then
  # Retry roughly every 10 minutes rather than every minute: each attempt costs the
  # household a short outage while port 53 changes hands, and thrashing that every
  # 60s is worse than being unfiltered a little longer.
  attempts="$(read_fails)"
  write_fails $(( attempts + 1 ))
  if (( (attempts + 1) % 10 == 0 )); then
    leave_bypass
  else
    log "in BYPASS (unfiltered) since $(cat "$BYPASS_FLAG" 2>/dev/null) - next restore attempt in $(( 10 - (attempts + 1) % 10 )) min"
  fi
  exit 0
fi

# ------------------------------------------------------------------ healthy path
if dns_answers; then
  prev="$(read_fails)"
  if [[ "$prev" != "0" ]]; then
    log "DNS recovered after $prev consecutive failure(s)"
  fi
  write_fails 0
  exit 0
fi

# ---------------------------------------------------------------- unhealthy path
fails=$(( $(read_fails) + 1 ))
write_fails "$fails"
log "DNS did not answer on 127.0.0.1:53 (consecutive failures: $fails)"

# One failure can be a container mid-restart or a momentary stall. Two in a row at
# 60s apart is a real outage. Acting on the first tick would mean restarting the
# resolver for every transient blip, which causes more downtime than it prevents.
if (( fails < 2 )); then
  log "first failure - waiting one more cycle before acting"
  exit 1
fi

cd "$STACK" 2>/dev/null || { log "FATAL: stack directory $STACK not found"; exit 1; }

# Escalate. Restart is cheap and fixes most things; recreate handles a container that
# is wedged in a way restart cannot clear.
if (( fails == 2 )); then
  log "restarting the DNS containers"
  compose restart >/dev/null 2>&1
else
  log "restart did not help ($fails failures) - recreating the stack"
  compose down >/dev/null 2>&1
  compose up -d >/dev/null 2>&1
fi

# Give it time to bind and answer before declaring the outcome.
for _ in $(seq 1 15); do
  sleep 2
  if dns_answers; then
    log "DNS restored after intervention"
    write_fails 0
    exit 0
  fi
done

log "ALERT: DNS still down after intervention. The network has no working resolver."

# Five minutes of no internet for the whole household. Stop defending the filter and
# give them a working connection.
if (( fails >= BYPASS_AFTER_FAILS )); then
  if enter_bypass; then
    write_fails 0
    exit 0
  fi
  log "ALERT: bypass failed too. Manual recovery required."
  log "Set the router's DHCP DNS back to automatic, then investigate the box."
  exit 1
fi

log "will enter unfiltered bypass mode after $BYPASS_AFTER_FAILS consecutive failures (currently $fails)"
exit 1
