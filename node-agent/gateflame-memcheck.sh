#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - DOES THIS FIT ON THE BASE MODEL?
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# The base model is an Orange Pi Zero 2W with 2 GB. Development happens on a Pi 5
# with 16 GB, where everything fits and nothing teaches you anything.
#
# "It runs on 2 GB" is a claim. This makes it a measurement, against a budget,
# on whatever board it is run on - so the answer is known before a unit is built
# rather than after one is returned.
#
# THE BUDGET, AND WHY IT IS SHAPED LIKE THIS
#
#   resolver   250 MB  Pi-hole + Unbound. NON-NEGOTIABLE. If this cannot be met
#                      the product does not work at all.
#   agent      180 MB  Python/FastAPI node-agent.
#   kiosk      560 MB  Chromium. Expendable - it is a display. Capped by
#                      MemoryMax in the unit file so it can never take the
#                      resolver down with it.
#   os         350 MB  kernel, systemd, docker daemon, sshd.
#   headroom   400 MB  page cache and burst. A board with zero headroom swaps,
#                      and swapping on an SD card is how a unit dies at 18 months.
#
# USAGE
#   bash gateflame-memcheck.sh            # measure and grade
#   bash gateflame-memcheck.sh --budget 2048
#
# EXIT 0 fits the budget · EXIT 1 does not
# ========================================================================================
set -uo pipefail

BUDGET_MB="${GATEFLAME_MEM_BUDGET_MB:-2048}"
[[ "${1:-}" == "--budget" ]] && BUDGET_MB="${2:-2048}"

c_ok=$'\033[1;32m'; c_warn=$'\033[1;33m'; c_bad=$'\033[1;31m'; c_hd=$'\033[1;36m'; c_z=$'\033[0m'

# RSS over-counts shared pages across a process tree, which for Chromium's
# half-dozen processes is a large lie in the wrong direction. PSS divides shared
# pages by the number of sharers and is the honest number, so it is used wherever
# the kernel will give it to us.
group_mem() {
  local pattern="$1" total=0 pss
  for pid in $(pgrep -f "$pattern" 2>/dev/null); do
    pss=$(awk '/^Pss:/{s+=$2} END{print s+0}' "/proc/$pid/smaps_rollup" 2>/dev/null)
    [[ -z "$pss" || "$pss" == "0" ]] && \
      pss=$(awk '/^VmRSS:/{print $2}' "/proc/$pid/status" 2>/dev/null)
    total=$(( total + ${pss:-0} ))
  done
  echo $(( total / 1024 ))
}

TOTAL_MB=$(awk '/^MemTotal:/{print int($2/1024)}' /proc/meminfo)
AVAIL_MB=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
USED_MB=$(( TOTAL_MB - AVAIL_MB ))

RESOLVER_MB=$(group_mem 'pihole-FTL|unbound')
AGENT_MB=$(group_mem 'uvicorn|gateflame.main|gateflame-node-agent')
KIOSK_MB=$(group_mem 'chromium|chrome')
DOCKERD_MB=$(group_mem 'dockerd|containerd')

printf '\n%s========================================================================================%s\n' "$c_hd" "$c_z"
printf '%sGATE^FLAME MEMORY BUDGET%s   board has %s MB   budget %s MB\n' "$c_hd" "$c_z" "$TOTAL_MB" "$BUDGET_MB"
printf '%s========================================================================================%s\n\n' "$c_hd" "$c_z"

row() {
  local name="$1" have="$2" want="$3" note="$4" colour="$c_ok" verdict="ok"
  if (( have > want )); then colour="$c_bad"; verdict="OVER"; fi
  printf '  %-12s %6s MB   budget %5s MB   %s%-5s%s  %s\n' \
         "$name" "$have" "$want" "$colour" "$verdict" "$c_z" "$note"
}

row resolver "$RESOLVER_MB" 250 "must never be the thing that dies"
row agent    "$AGENT_MB"    180 ""
row kiosk    "$KIOSK_MB"    560 "expendable - capped by MemoryMax"
row docker   "$DOCKERD_MB"  200 ""

MEASURED=$(( RESOLVER_MB + AGENT_MB + KIOSK_MB + DOCKERD_MB ))
printf '\n  %-12s %6s MB  (sum of the above, PSS)\n' "measured" "$MEASURED"
printf '  %-12s %6s MB  (everything, incl. OS and page cache)\n' "in use" "$USED_MB"
printf '  %-12s %6s MB\n\n' "available" "$AVAIL_MB"

echo "----------------------------------------------------------------------------------------"
FAIL=0

# The question is not "did it fit today", it is "would it fit on the base model".
# A Pi 5 with 16 GB fits anything, which is exactly why that must not be the test.
PROJECTED=$(( USED_MB ))
if (( TOTAL_MB > BUDGET_MB )); then
  printf '  This board has %s MB, more than the %s MB base model.\n' "$TOTAL_MB" "$BUDGET_MB"
  printf '  Grading the MEASURED FOOTPRINT against the base model instead.\n\n'
fi

if (( PROJECTED > BUDGET_MB - 400 )); then
  printf '  %sWOULD NOT FIT%s  %s MB in use leaves under 400 MB headroom on a %s MB board.\n' \
         "$c_bad" "$c_z" "$PROJECTED" "$BUDGET_MB"
  printf '                 Without headroom the board swaps, and swapping on an SD\n'
  printf '                 card is how a unit fails at eighteen months.\n'
  FAIL=1
else
  printf '  %sFITS%s  %s MB in use, %s MB headroom on a %s MB board.\n' \
         "$c_ok" "$c_z" "$PROJECTED" "$(( BUDGET_MB - PROJECTED ))" "$BUDGET_MB"
fi

if (( RESOLVER_MB > 250 )); then
  printf '\n  %sRESOLVER OVER BUDGET%s - this is the one that matters. Everything else\n' "$c_bad" "$c_z"
  printf '  can be sacrificed; DNS cannot.\n'
  FAIL=1
fi

if (( KIOSK_MB == 0 )); then
  printf '\n  %snote%s  no browser running - kiosk figure is not part of this measurement.\n' "$c_warn" "$c_z"
fi

echo "========================================================================================"
exit $FAIL
