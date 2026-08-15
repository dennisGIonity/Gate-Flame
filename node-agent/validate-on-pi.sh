#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME — REAL-HARDWARE VALIDATION (RUN THIS ON THE PI ITSELF)
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Document ID: DOC-2026-08-014-PIVAL | Version: 1.0 | Updated: 2026-08-14 SAST
# Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
# Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
# Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
# ========================================================================================
#
# WHY THIS EXISTS
#
# Nothing in this project has ever executed on real Raspberry Pi hardware. Every
# telemetry reading so far came from a Linux container with no thermal zone, no
# vcgencmd, and no real ARP table — so every "didn't crash" result so far proves
# only that the FALLBACK paths work. It does not prove a single number the
# dashboard shows is a real device reading.
#
# This script closes that gap. It runs ON the Pi and checks, one source at a time,
# whether node-agent's inputs are genuine hardware readings or container artifacts:
#
#   /sys/class/thermal      → telemetry.read_thermal_c()
#   vcgencmd get_throttled  → telemetry.read_throttle_flags()
#   vcgencmd measure_temp   → cross-check; disagreement means one source is lying
#   psutil                  → telemetry.host_snapshot()
#   ip neigh + DHCP leases  → clients.list_clients()
#   CAP_NET_ADMIN / _RAW    → gate module_firewall_bounce and module_dpi_flow
#   nft / ip                → the firewall module's dependencies
#   cgroup v2               → the systemd hardening in install.sh depends on it
#   /api/v1/system/status   → the agent itself, over loopback
#
# It is real-hardware validation item #8 from node-agent/README.md, made runnable.
#
# PROPERTIES OF THIS SCRIPT
#   • Read-only. It changes nothing on the Pi: no writes, no installs, no config,
#     no service restarts, no network probes beyond one loopback GET.
#   • Safe to run repeatedly, at any time, on a production node.
#   • Does NOT require root. Checks that would need privilege are reported as
#     skipped, with what to re-run as root, rather than silently passing.
#
# USAGE
#   bash node-agent/validate-on-pi.sh
#   bash node-agent/validate-on-pi.sh --json     # summary as JSON lines too
#
#   Exit code 0 = every PASS-required check passed.
#   Exit code 1 = at least one PASS-required check failed — the numbers coming
#                 back from this node cannot be trusted as real readings yet.
#
# Environment honoured: GATEFLAME_PORT (default 8080), GATEFLAME_UNIT
# (default gateflame-node-agent.service).
# ========================================================================================

set -uo pipefail

PORT="${GATEFLAME_PORT:-8080}"
UNIT="${GATEFLAME_UNIT:-gateflame-node-agent.service}"
AGENT_VENV_PY="/opt/gateflame/node-agent/venv/bin/python3"
EMIT_JSON=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --json) EMIT_JSON=1; shift ;;
    -h|--help)
      awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
      exit 0 ;;
    *) printf 'Unknown argument: %s (try --help)\n' "$1" >&2; exit 2 ;;
  esac
done

# ── Presentation ───────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

say()     { printf '%s\n' "$*"; }
heading() { printf '\n%s\n' "${C_BOLD}${C_CYAN}== $* ==${C_RESET}"; }
rule()    { printf '%s\n' "──────────────────────────────────────────────────────────────────────────────"; }

# ── Result table ───────────────────────────────────────────────────────────────────────
# Parallel arrays rather than a delimited string, so an observed value containing
# any character at all cannot corrupt the table.
CHECK_NAME=(); CHECK_STATUS=(); CHECK_REQ=(); CHECK_VALUE=()
FAILED_REQUIRED=0
NOTES=()

record() {
  # record <PASS|FAIL|N/A> <yes|no : is a PASS required> <name> <observed value>
  local status="$1" req="$2" name="$3" value="$4" colour=""
  CHECK_NAME+=("$name"); CHECK_STATUS+=("$status")
  CHECK_REQ+=("$req");   CHECK_VALUE+=("$value")

  case "$status" in
    PASS) colour="$C_GREEN" ;;
    FAIL) colour="$C_RED" ;;
    *)    colour="$C_YELLOW" ;;
  esac
  if [ "$status" = "FAIL" ] && [ "$req" = "yes" ]; then
    FAILED_REQUIRED=$((FAILED_REQUIRED + 1))
  fi
  printf '  %s[%-4s]%s %-40s %s\n' "$colour" "$status" "$C_RESET" "$name" "$value"
}

note() { NOTES+=("$1"); }

# ── Header ─────────────────────────────────────────────────────────────────────────────
rule
say "${C_BOLD}Gate^Flame node-agent — real-hardware validation${C_RESET}"
rule
say "host        : $(hostname 2>/dev/null || echo unknown)"
say "date        : $(date '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || echo unknown)"
say "user        : $(id -un 2>/dev/null || echo unknown) (uid $(id -u 2>/dev/null || echo '?'))"
say "read-only   : yes — this script changes nothing on this device"
if [ "$(id -u 2>/dev/null || echo 1)" -eq 0 ]; then
  note "Running as root. Root is NOT required for any check here; the results are the same unprivileged, except that root can read DHCP lease files with restrictive modes."
fi

# ── 1. Identity: is this actually a Raspberry Pi? ───────────────────────────────────────
heading "1. Device identity"

PI_MODEL=""
if [ -r /proc/device-tree/model ]; then
  # device-tree strings are NUL-terminated; tr strips the trailing NUL.
  PI_MODEL=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)
fi
if [ -z "$PI_MODEL" ] && [ -r /proc/cpuinfo ]; then
  PI_MODEL=$(awk -F': ' '/^Model/ {print $2; exit}' /proc/cpuinfo 2>/dev/null || true)
fi

IS_PI=0
case "$PI_MODEL" in
  *"Raspberry Pi"*) IS_PI=1 ;;
esac

if [ "$IS_PI" -eq 1 ]; then
  record PASS yes "Raspberry Pi hardware" "$PI_MODEL"
else
  record FAIL yes "Raspberry Pi hardware" "${PI_MODEL:-no model string (/proc/device-tree/model absent)}"
  printf '\n%s\n' "${C_RED}${C_BOLD}!! THIS DOES NOT LOOK LIKE A RASPBERRY PI !!${C_RESET}" >&2
  cat >&2 <<'EOF'
   Everything below still runs, but it proves nothing about the product.
   The whole point of this script is to distinguish real device readings from
   container artifacts — on a non-Pi host, a PASS on the thermal or throttle
   checks would be measuring some other machine's hardware, and an N/A tells
   you nothing about whether the Pi paths work.

   Run this again on the actual appliance: flash Raspberry Pi OS, run
   `sudo bash node-agent/install.sh`, then re-run this script there.
EOF
  note "Not a Raspberry Pi: the run is informational only. Re-run on real hardware before trusting any telemetry field."
fi

OS_PRETTY=""
if [ -r /etc/os-release ]; then
  # Sourced inside a subshell, so none of its variables leak into this script.
  # shellcheck source=/dev/null
  OS_PRETTY=$( (. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-${NAME:-}}") || true)
fi
record "$( [ -n "$OS_PRETTY" ] && echo PASS || echo 'N/A' )" no \
  "OS release" "${OS_PRETTY:-/etc/os-release unreadable}"

KERNEL="$(uname -srm 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"
record PASS no "Kernel / architecture" "$KERNEL"
case "$ARCH" in
  aarch64) : ;;
  armv7l|armv6l)
    note "32-bit userland ($ARCH). Works, but 64-bit Raspberry Pi OS is the supported target for the agent — psutil wheels and vcgencmd behaviour differ." ;;
  x86_64)
    note "x86_64 architecture — this is not Pi hardware." ;;
esac

# cgroup v2: the systemd hardening in install.sh (ProtectSystem=strict,
# ReadWritePaths, PrivateTmp) is enforced through cgroup/namespace features. On a
# host still on cgroup v1 those directives behave differently or are ignored.
if [ -e /sys/fs/cgroup/cgroup.controllers ]; then
  CG_CTRL=$(tr '\n' ' ' < /sys/fs/cgroup/cgroup.controllers 2>/dev/null | cut -c1-90)
  record PASS yes "cgroup v2 mounted" "controllers: ${CG_CTRL:-<empty>}"
else
  record FAIL yes "cgroup v2 mounted" "/sys/fs/cgroup/cgroup.controllers missing — systemd unit hardening in install.sh may not apply"
fi

# ── 2. Thermal ─────────────────────────────────────────────────────────────────────────
heading "2. Thermal zone (telemetry.read_thermal_c)"

THERM_ZONE=""; THERM_RAW=""; THERM_C=""
for zf in /sys/class/thermal/thermal_zone*/temp; do
  [ -r "$zf" ] || continue
  raw=$(cat "$zf" 2>/dev/null || true)
  case "$raw" in
    ''|*[!0-9-]*) continue ;;
  esac
  THERM_ZONE="$zf"; THERM_RAW="$raw"
  break
done

if [ -z "$THERM_RAW" ]; then
  record FAIL yes "CPU temperature source" \
    "no readable /sys/class/thermal/thermal_zone*/temp — telemetry.read_thermal_c() falls back to psutil sensors, and returns None if those are absent too (tempC: null + thermalGap)"
else
  ZTYPE=""
  [ -r "${THERM_ZONE%/temp}/type" ] && ZTYPE=$(cat "${THERM_ZONE%/temp}/type" 2>/dev/null || true)
  THERM_C=$(awk -v r="$THERM_RAW" 'BEGIN { printf "%.1f", r / 1000 }')
  DESC="${THERM_ZONE} (${ZTYPE:-unknown type}) raw=${THERM_RAW} → ${THERM_C}°C"

  if [ "$THERM_RAW" -ge 20000 ] && [ "$THERM_RAW" -le 85000 ]; then
    record PASS yes "CPU temperature plausible" "$DESC"
  elif [ "$THERM_RAW" -gt 85000 ] && [ "$THERM_RAW" -lt 100000 ]; then
    record FAIL yes "CPU temperature plausible" \
      "$DESC — above the plausible idle band (20-85°C). Either this Pi is genuinely overheating (check the case/heatsink) or the sensor is bogus."
  elif [ "$THERM_RAW" -ge 100000 ]; then
    record FAIL yes "CPU temperature plausible" \
      "$DESC — 100000+ raw is the classic container/stub artifact, not a Pi reading."
  elif [ "$THERM_RAW" -ge 20 ] && [ "$THERM_RAW" -le 85 ]; then
    record FAIL yes "CPU temperature plausible" \
      "$DESC — this zone reports DEGREES, not millidegrees. telemetry.read_thermal_c() divides by 1000 unconditionally, so it would report ${THERM_C}°C. Wrong source."
  else
    record FAIL yes "CPU temperature plausible" \
      "$DESC — outside any plausible range (0 or a stub value means the zone is not a real sensor)."
  fi
fi

# ── 3. vcgencmd: throttling and a second temperature opinion ───────────────────────────
heading "3. vcgencmd (telemetry.read_throttle_flags)"

decode_throttled() {
  # Bit meanings per the Raspberry Pi firmware documentation. Bits 0-3 are the
  # live state; bits 16-19 are the same conditions latched since boot. A latched
  # bit with a clear live bit is the important case: it means the node HAS been
  # under-volted or throttled and recovered, which is invisible in a spot check.
  local hex="${1#0x}" val out
  case "$hex" in
    ''|*[!0-9a-fA-F]*) printf 'unparseable value: %s' "$1"; return 1 ;;
  esac
  val=$((16#$hex))
  out=()
  (( (val >> 0)  & 1 )) && out+=("under-voltage RIGHT NOW (inadequate PSU or cable)")
  (( (val >> 1)  & 1 )) && out+=("ARM frequency capped right now")
  (( (val >> 2)  & 1 )) && out+=("currently throttled")
  (( (val >> 3)  & 1 )) && out+=("soft temperature limit active right now")
  (( (val >> 16) & 1 )) && out+=("under-voltage HAS OCCURRED since boot")
  (( (val >> 17) & 1 )) && out+=("ARM frequency capping HAS OCCURRED since boot")
  (( (val >> 18) & 1 )) && out+=("throttling HAS OCCURRED since boot")
  (( (val >> 19) & 1 )) && out+=("soft temperature limit HAS OCCURRED since boot")
  if [ "${#out[@]}" -eq 0 ]; then
    printf 'no throttling or under-voltage flags set'
  else
    local joined="" item
    for item in "${out[@]}"; do
      if [ -z "$joined" ]; then joined="$item"; else joined="${joined}; ${item}"; fi
    done
    printf '%s' "$joined"
  fi
}

VCGENCMD=""
if command -v vcgencmd >/dev/null 2>&1; then
  VCGENCMD=$(command -v vcgencmd)
fi

MEASURED_C=""
if [ -z "$VCGENCMD" ]; then
  if [ "$IS_PI" -eq 1 ]; then
    record FAIL yes "vcgencmd present" \
      "not on PATH, but this IS a Pi — install raspberrypi-utils/libraspberrypi-bin, or throttleFlags will be permanently absent from telemetry"
  else
    record "N/A" no "vcgencmd present" "not on PATH (expected off Pi hardware — throttleFlags is simply omitted)"
    record "N/A" no "vcgencmd get_throttled" "no vcgencmd"
    record "N/A" no "vcgencmd vs thermal zone" "no vcgencmd"
  fi
else
  record PASS no "vcgencmd present" "$VCGENCMD"

  TH_OUT=$("$VCGENCMD" get_throttled 2>&1)
  TH_RC=$?
  case "$TH_OUT" in
    *throttled=0x*|*throttled=*)
      TH_VAL="${TH_OUT#*throttled=}"
      TH_VAL="${TH_VAL%%[[:space:]]*}"
      DECODED=$(decode_throttled "$TH_VAL")
      if [ "$DECODED" = "no throttling or under-voltage flags set" ]; then
        record PASS yes "vcgencmd get_throttled" "throttled=${TH_VAL} — ${DECODED}"
      else
        # A real, decoded value is a working sensor; the flags themselves are an
        # operational problem, not a validation failure of the reading path.
        record PASS yes "vcgencmd get_throttled" "throttled=${TH_VAL} — ${DECODED}"
        note "Throttle flags are set: ${DECODED}. Under-voltage on a security appliance means silent packet loss and SD-card corruption — fix the PSU/cable before shipping this unit."
      fi
      ;;
    *"VCHI"*|*"Permission denied"*|*"vchiq"*)
      record FAIL yes "vcgencmd get_throttled" \
        "vcgencmd exists but cannot talk to the firmware: ${TH_OUT}"
      note "vcgencmd needs access to /dev/vchiq — add the agent's user to the 'video' group (usermod -aG video gateflame) or the throttle field will always be missing. Re-check with: sudo -u gateflame vcgencmd get_throttled"
      ;;
    *)
      record FAIL yes "vcgencmd get_throttled" \
        "unexpected output (rc=${TH_RC}): ${TH_OUT}"
      ;;
  esac

  MT_OUT=$("$VCGENCMD" measure_temp 2>&1)
  case "$MT_OUT" in
    *temp=*)
      MEASURED_C="${MT_OUT#*temp=}"
      MEASURED_C="${MEASURED_C%\'C*}"
      if [ -n "$THERM_C" ]; then
        DIFF=$(awk -v a="$THERM_C" -v b="$MEASURED_C" 'BEGIN { d = a - b; if (d < 0) d = -d; printf "%.1f", d }')
        AGREE=$(awk -v d="$DIFF" 'BEGIN { print (d <= 2.0) ? "yes" : "no" }')
        if [ "$AGREE" = "yes" ]; then
          record PASS yes "vcgencmd vs thermal zone" \
            "thermal_zone=${THERM_C}°C, measure_temp=${MEASURED_C}°C, Δ=${DIFF}°C (within 2.0°C)"
        else
          record FAIL yes "vcgencmd vs thermal zone" \
            "thermal_zone=${THERM_C}°C, measure_temp=${MEASURED_C}°C, Δ=${DIFF}°C — the two sources disagree, so one of them is lying. Do not trust tempC until this is resolved."
        fi
      else
        record "N/A" no "vcgencmd vs thermal zone" \
          "measure_temp=${MEASURED_C}°C but no thermal zone to compare against"
      fi
      ;;
    *)
      record FAIL no "vcgencmd measure_temp" "unexpected output: ${MT_OUT}"
      ;;
  esac
fi

# ── 4. psutil ──────────────────────────────────────────────────────────────────────────
heading "4. psutil readings (telemetry.host_snapshot)"

PY=""
for cand in "$AGENT_VENV_PY" "${AGENT_VENV_PY%3}" python3; do
  if [ -n "$cand" ] && command -v "$cand" >/dev/null 2>&1; then
    PY=$(command -v "$cand"); break
  fi
done

if [ -z "$PY" ]; then
  record FAIL yes "psutil readings" "no python3 interpreter found (looked for the agent venv at ${AGENT_VENV_PY}, then python3 on PATH)"
else
  PSUTIL_OUT=$("$PY" -c '
import sys, time
try:
    import psutil
except Exception as exc:
    sys.stdout.write("NOPSUTIL " + str(exc) + "\n")
    sys.exit(2)
cpu = psutil.cpu_percent(interval=0.5)
vm = psutil.virtual_memory()
du = psutil.disk_usage("/")
used_mb = (vm.total - vm.available) / 1048576.0
total_mb = vm.total / 1048576.0
boot = psutil.boot_time()
uptime = time.time() - boot
problems = []
if total_mb <= 0:                        problems.append("memory total is 0")
if not (0 <= used_mb <= total_mb):       problems.append("memory used out of range")
if du.total <= 0:                        problems.append("disk total is 0")
if not (0.0 <= du.percent <= 100.0):     problems.append("disk percent out of range")
if boot <= 0:                            problems.append("boot_time is 0")
if uptime <= 0:                          problems.append("uptime is not positive")
note = "" if cpu > 0.0 else " [cpu reads exactly 0.0]"
sys.stdout.write("%s psutil %s: cpu=%.1f%% mem=%d/%dMB (%.1f%%) disk=%.1f%% of %.1fGB uptime=%ds%s%s\n" % (
    "OK" if not problems else "BAD",
    psutil.__version__, cpu, used_mb, total_mb, vm.percent,
    du.percent, du.total / 1073741824.0, uptime, note,
    ("; " + "; ".join(problems)) if problems else ""))
sys.exit(0 if not problems else 1)
' 2>&1)
  PSUTIL_RC=$?
  case "$PSUTIL_OUT" in
    NOPSUTIL*)
      record FAIL yes "psutil readings" "psutil not importable by ${PY}: ${PSUTIL_OUT#NOPSUTIL }" ;;
    OK*)
      record PASS yes "psutil readings self-consistent" "${PSUTIL_OUT#OK } (via ${PY})"
      case "$PSUTIL_OUT" in
        *"cpu reads exactly 0.0"*)
          note "psutil.cpu_percent() returned exactly 0.0. Plausible on a genuinely idle Pi, but it is also what a stub returns — re-run under load (e.g. while 'openssl speed' runs) to confirm it moves." ;;
      esac ;;
    BAD*)
      record FAIL yes "psutil readings self-consistent" "${PSUTIL_OUT#BAD }" ;;
    *)
      record FAIL yes "psutil readings" "unexpected output (rc=${PSUTIL_RC}) from ${PY}: ${PSUTIL_OUT}" ;;
  esac
fi

# ── 5. Neighbour table and DHCP leases ─────────────────────────────────────────────────
heading "5. Network neighbours (clients.list_clients)"

IP_BIN=""
if command -v ip >/dev/null 2>&1; then IP_BIN=$(command -v ip); fi
if [ -z "$IP_BIN" ]; then
  record FAIL yes "ip on PATH" "not found — clients.list_clients() would always return [] (iproute2 missing)"
else
  IP_VER=$("$IP_BIN" -V 2>/dev/null | head -1 || true)
  record PASS yes "ip on PATH" "${IP_BIN} (${IP_VER:-version unknown})"
fi

NEIGH=""
NEIGH_MACS=""
if [ -n "$IP_BIN" ]; then
  NEIGH=$("$IP_BIN" neigh show 2>/dev/null || true)
  USABLE=$(printf '%s\n' "$NEIGH" | awk '/lladdr/ && /REACHABLE|STALE|DELAY|PERMANENT/ { n++ } END { print n + 0 }')
  TOTAL=$(printf '%s\n' "$NEIGH" | awk 'NF { n++ } END { print n + 0 }')
  NEIGH_MACS=$(printf '%s\n' "$NEIGH" \
    | awk '{ for (i = 1; i <= NF; i++) if ($i == "lladdr") print tolower($(i + 1)) }' \
    | sort -u)

  # clients.py only keeps REACHABLE/STALE/DELAY/PERMANENT entries with an lladdr,
  # so that — not the raw line count — is what the dashboard will actually show.
  if [ "$USABLE" -ge 1 ]; then
    FIRST=$(printf '%s\n' "$NEIGH" | awk '/lladdr/ && /REACHABLE|STALE|DELAY|PERMANENT/ { print; exit }')
    record PASS yes "ip neigh returns real neighbours" \
      "${USABLE} usable of ${TOTAL} entries; e.g. ${FIRST}"
  else
    record FAIL yes "ip neigh returns real neighbours" \
      "${USABLE} usable of ${TOTAL} entries — a Pi on a live LAN must at minimum see its gateway. An empty table means clients.list_clients() returns [] and the dashboard client list is permanently empty."
  fi

  GW=$("$IP_BIN" route show default 2>/dev/null \
       | awk '/default/ { for (i = 1; i <= NF; i++) if ($i == "via") { print $(i + 1); exit } }')
  if [ -z "$GW" ]; then
    record FAIL no "default gateway present" "no default route — this node has no upstream, so it is not on a live LAN"
  elif printf '%s\n' "$NEIGH" | awk -v g="$GW" '$1 == g && /lladdr/ { found = 1 } END { exit !found }'; then
    GWLINE=$(printf '%s\n' "$NEIGH" | awk -v g="$GW" '$1 == g { print; exit }')
    record PASS no "gateway resolved in neighbour table" "$GWLINE"
  else
    record FAIL no "gateway resolved in neighbour table" \
      "default gateway ${GW} has no lladdr entry — the ARP cache may have been queried before any traffic flowed"
  fi
else
  record FAIL yes "ip neigh returns real neighbours" "ip binary missing"
  record "N/A" no "gateway resolved in neighbour table" "ip binary missing"
fi

# Cross-check against the dnsmasq/Pi-hole lease file, exactly the two paths
# clients.py LEASE_PATHS looks at.
LEASE_FOUND=""
for lf in /etc/pihole/dhcp.leases /var/lib/misc/dnsmasq.leases; do
  [ -e "$lf" ] || continue
  LEASE_FOUND="$lf"
  if [ ! -r "$lf" ]; then
    record "N/A" no "DHCP lease cross-check" "${lf} exists but is not readable as $(id -un)"
    note "Lease file ${lf} is unreadable without privilege. The agent runs as the 'gateflame' user, so it will hit the same wall and hostnames will come back null. Verify with: sudo -u gateflame cat ${lf}"
    break
  fi
  LEASE_MACS=$(awk 'NF >= 4 { print tolower($2) }' "$lf" 2>/dev/null | sort -u)
  LEASE_COUNT=$(printf '%s\n' "$LEASE_MACS" | awk 'NF { n++ } END { print n + 0 }')
  MATCHED=0
  if [ -n "$LEASE_MACS" ] && [ -n "$NEIGH_MACS" ]; then
    MATCHED=$(printf '%s\n' "$NEIGH_MACS" | grep -Fxc -f <(printf '%s\n' "$LEASE_MACS") 2>/dev/null || true)
    [ -n "$MATCHED" ] || MATCHED=0
  fi
  if [ "$LEASE_COUNT" -gt 0 ] && [ "$MATCHED" -gt 0 ]; then
    record PASS no "DHCP lease cross-check" \
      "${lf}: ${LEASE_COUNT} leased MACs, ${MATCHED} also present in the neighbour table → hostnames will resolve"
  elif [ "$LEASE_COUNT" -gt 0 ]; then
    record FAIL no "DHCP lease cross-check" \
      "${lf}: ${LEASE_COUNT} leased MACs but NONE match the neighbour table — one of the two sources is describing a different network, so hostname will be null for every client"
  else
    record "N/A" no "DHCP lease cross-check" "${lf} exists but holds no parseable leases"
  fi
  break
done
if [ -z "$LEASE_FOUND" ]; then
  record "N/A" no "DHCP lease cross-check" \
    "no lease file at /etc/pihole/dhcp.leases or /var/lib/misc/dnsmasq.leases — clients will list with hostname: null (expected unless this node is the DHCP server)"
fi

# ── 6. Firewall / DPI prerequisites ────────────────────────────────────────────────────
heading "6. Firewall & DPI prerequisites (module_firewall_bounce, module_dpi_flow)"

if command -v nft >/dev/null 2>&1; then
  NFT_VER=$(nft --version 2>/dev/null | head -1 || true)
  record PASS no "nft on PATH" "$(command -v nft) (${NFT_VER:-version unknown})"
else
  record FAIL no "nft on PATH" "not found — install nftables before module_firewall_bounce can be wired up"
fi

# Effective capabilities of THIS shell. CAP_NET_ADMIN = bit 12, CAP_NET_RAW = 13,
# both inside the low 32 bits, so the low 8 hex digits are sufficient and avoid
# 64-bit overflow in shell arithmetic.
CAPEFF=$(awk '/^CapEff:/ { print $2 }' /proc/self/status 2>/dev/null || true)
cap_present() {
  local mask="$1" bit="$2" low v
  [ -n "$mask" ] || return 2
  low="${mask: -8}"
  case "$low" in
    ''|*[!0-9a-fA-F]*) return 2 ;;
  esac
  v=$((16#$low))
  (( (v >> bit) & 1 ))
}

for capdef in "CAP_NET_ADMIN:12:nftables rule changes (module_firewall_bounce)" \
              "CAP_NET_RAW:13:AF_PACKET SNI/Host capture (module_dpi_flow)"; do
  CAPNAME="${capdef%%:*}"
  CAPREST="${capdef#*:}"
  CAPBIT="${CAPREST%%:*}"
  CAPUSE="${CAPREST#*:}"
  if cap_present "$CAPEFF" "$CAPBIT"; then
    record PASS no "${CAPNAME} available to this shell" "CapEff=0x${CAPEFF} — gates ${CAPUSE}"
  elif [ "$?" -eq 2 ]; then
    record "N/A" no "${CAPNAME} available to this shell" "could not read CapEff from /proc/self/status"
  else
    record FAIL no "${CAPNAME} available to this shell" \
      "absent (CapEff=0x${CAPEFF:-?}) — ${CAPUSE} cannot work until the unit grants it"
  fi
done
note "The capability rows above are advisory, not required: module_firewall_bounce and module_dpi_flow report not_implemented today (see node-agent/README.md). When they are wired up, grant the minimum via the systemd unit — AmbientCapabilities=CAP_NET_ADMIN (and CAP_NET_RAW for DPI) with CapabilityBoundingSet set to the same — never by running the agent as root."

# ── 7. The agent itself ────────────────────────────────────────────────────────────────
heading "7. node-agent service and API"

AGENT_PID=""
UNIT_EXISTS=0
if command -v systemctl >/dev/null 2>&1 && systemctl cat "$UNIT" >/dev/null 2>&1; then
  UNIT_EXISTS=1
  STATE=$(systemctl is-active "$UNIT" 2>/dev/null || true)
  AGENT_PID=$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null || true)
  case "$AGENT_PID" in
    ''|*[!0-9]*) AGENT_PID="" ;;
    0) AGENT_PID="" ;;
  esac
  SINCE=$(systemctl show -p ActiveEnterTimestamp --value "$UNIT" 2>/dev/null || true)
  if [ "$STATE" = "active" ]; then
    record PASS no "${UNIT} active" "state=${STATE}, MainPID=${AGENT_PID:-unknown}${SINCE:+, since ${SINCE}}"
  else
    record FAIL no "${UNIT} active" "state=${STATE:-unknown} — start it with: sudo systemctl start ${UNIT}; logs: journalctl -u ${UNIT} -n50"
  fi
else
  record "N/A" no "${UNIT} active" "unit not installed — run 'sudo bash node-agent/install.sh' on this Pi first"
  note "The agent service is not installed here, so the API and agent-capability checks below could not be performed."
fi

# Capabilities the RUNNING agent actually holds — /proc/<pid>/status is
# world-readable, so this needs no privilege and is the honest answer for "the
# agent's user", rather than inferring it from the unit file.
if [ -n "$AGENT_PID" ] && [ -r "/proc/${AGENT_PID}/status" ]; then
  A_CAPEFF=$(awk '/^CapEff:/ { print $2 }' "/proc/${AGENT_PID}/status" 2>/dev/null || true)
  A_UID=$(awk '/^Uid:/ { print $2 }' "/proc/${AGENT_PID}/status" 2>/dev/null || true)
  A_USER=$(getent passwd "${A_UID:-x}" 2>/dev/null | cut -d: -f1 || true)
  A_LIST=""
  cap_present "$A_CAPEFF" 12 && A_LIST="${A_LIST}CAP_NET_ADMIN "
  cap_present "$A_CAPEFF" 13 && A_LIST="${A_LIST}CAP_NET_RAW "
  record PASS no "agent process capabilities" \
    "pid ${AGENT_PID} runs as ${A_USER:-uid ${A_UID:-?}}, CapEff=0x${A_CAPEFF:-?}, net caps: ${A_LIST:-none}"
else
  record "N/A" no "agent process capabilities" "agent not running, or /proc/<pid>/status unavailable"
fi

STATUS_URL="http://127.0.0.1:${PORT}/api/v1/system/status"
http_get() {
  # Loopback GET only. require_lan() in security.py permits 127.0.0.1, and this
  # route needs no pairing token, so it is the one honest liveness probe.
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 "$url" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- --timeout=5 "$url" 2>/dev/null
  elif [ -n "$PY" ]; then
    "$PY" -c 'import sys, urllib.request; sys.stdout.write(urllib.request.urlopen(sys.argv[1], timeout=5).read().decode())' "$url" 2>/dev/null
  else
    return 3
  fi
}

if [ "$UNIT_EXISTS" -eq 1 ] && [ "${STATE:-}" = "active" ]; then
  BODY=$(http_get "$STATUS_URL" || true)
  if [ -z "$BODY" ]; then
    record FAIL yes "GET /api/v1/system/status (loopback)" \
      "no response from ${STATUS_URL} although the unit is active — check GATEFLAME_PORT and 'journalctl -u ${UNIT} -n50'"
  else
    case "$BODY" in
      *nodeId*agentVersion*|*agentVersion*nodeId*)
        record PASS yes "GET /api/v1/system/status (loopback)" "${STATUS_URL} → ${BODY}" ;;
      *)
        record FAIL yes "GET /api/v1/system/status (loopback)" \
          "${STATUS_URL} answered without nodeId/agentVersion — something else is listening on ${PORT}: ${BODY}" ;;
    esac
  fi
else
  record "N/A" no "GET /api/v1/system/status (loopback)" \
    "agent not active — nothing to query on 127.0.0.1:${PORT}"
fi

# ── Summary ────────────────────────────────────────────────────────────────────────────
printf '\n'
rule
say "${C_BOLD}SUMMARY${C_RESET}   (REQ = a PASS is required; a FAIL there fails this run)"
rule
printf '%-6s %-4s %s\n' "STATUS" "REQ" "CHECK / OBSERVED VALUE"
rule
PASS_N=0; FAIL_N=0; NA_N=0
i=0
while [ "$i" -lt "${#CHECK_NAME[@]}" ]; do
  st="${CHECK_STATUS[$i]}"
  case "$st" in
    PASS) PASS_N=$((PASS_N + 1)); col="$C_GREEN" ;;
    FAIL) FAIL_N=$((FAIL_N + 1)); col="$C_RED" ;;
    *)    NA_N=$((NA_N + 1));     col="$C_YELLOW" ;;
  esac
  printf '%s%-6s%s %-4s %s\n' "$col" "$st" "$C_RESET" "${CHECK_REQ[$i]}" "${CHECK_NAME[$i]}"
  printf '%s\n' "                  ${CHECK_VALUE[$i]}" | fold -s -w 92 | sed '2,$s/^/                  /'
  i=$((i + 1))
done
rule
printf 'PASS %d   FAIL %d   N/A %d   (of %d checks; %d required check(s) failed)\n' \
  "$PASS_N" "$FAIL_N" "$NA_N" "${#CHECK_NAME[@]}" "$FAILED_REQUIRED"

if [ "${#NOTES[@]}" -gt 0 ]; then
  printf '\n%s\n' "${C_BOLD}NOTES / SKIPPED WITHOUT PRIVILEGE${C_RESET}"
  rule
  for n in "${NOTES[@]}"; do
    printf '%s\n' "  • ${n}" | fold -s -w 92 | sed '2,$s/^/    /'
  done
fi

if [ "$EMIT_JSON" -eq 1 ]; then
  printf '\n%s\n' "JSON:"
  i=0
  while [ "$i" -lt "${#CHECK_NAME[@]}" ]; do
    esc_name=$(printf '%s' "${CHECK_NAME[$i]}"  | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_val=$(printf '%s'  "${CHECK_VALUE[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"check":"%s","status":"%s","required":"%s","observed":"%s"}\n' \
      "$esc_name" "${CHECK_STATUS[$i]}" "${CHECK_REQ[$i]}" "$esc_val"
    i=$((i + 1))
  done
fi

printf '\n'
if [ "$FAILED_REQUIRED" -eq 0 ]; then
  printf '%s\n' "${C_GREEN}${C_BOLD}RESULT: every required check passed on this device.${C_RESET}"
  say "The telemetry, throttle and client fields this node reports are real hardware"
  say "readings, not container fallbacks. Record this output against the node's serial"
  say "number — it is the evidence for real-hardware validation item #8 in"
  say "node-agent/README.md."
  say ""
  say "Still unproven by this script, by design: Pi-hole query/block counts (needs"
  say "GATEFLAME_PIHOLE_URL configured and Pi-hole answering), and the four modules"
  say "that honestly report not_implemented at /api/v1/services."
  exit 0
else
  printf '%s\n' "${C_RED}${C_BOLD}RESULT: ${FAILED_REQUIRED} required check(s) failed.${C_RESET}"
  say "Do not treat this node's telemetry as real yet. Every FAIL above names the"
  say "source and what the dashboard would show instead — fix those, then re-run."
  say "Nothing on this device was modified by this script."
  exit 1
fi

# ========================================================================================
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
# Governance: Policy 986 AED | Building Tomorrow, Today. | Anything is Possible with God.
# ========================================================================================
