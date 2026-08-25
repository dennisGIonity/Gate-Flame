#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - REPO DOCTOR
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# WHY THIS EXISTS
#
# On 2026-08-25 an audit found NINETEEN checkouts of this repository on one
# machine, EIGHT different author identities in the history, branches with no
# upstream, and a local `main` twenty-eight commits ahead of the remote. Work had
# been going missing repeatedly and nobody could see why, because no single view
# existed that would show it.
#
# This is that view. Read-only: it reports and never changes anything.
#
#   bash scripts/gateflame-doctor.sh
#
# EXIT 0 clean · EXIT 1 something needs attention
# ========================================================================================
set -uo pipefail

CANONICAL_DIR="/e/Gateflame"
CANONICAL_NAME="DennisIonity"
CANONICAL_EMAIL="dennis@ionitynetwork.onmicrosoft.com"
REMOTE_MATCH="Gate-Flame"

c_ok=$'\033[1;32m'; c_warn=$'\033[1;33m'; c_bad=$'\033[1;31m'; c_hd=$'\033[1;36m'; c_z=$'\033[0m'
PROBLEMS=0

hd()   { printf '\n%s==> %s%s\n' "$c_hd" "$*" "$c_z"; }
ok()   { printf '    %s[ OK ]%s %s\n' "$c_ok" "$c_z" "$*"; }
warn() { printf '    %s[WARN]%s %s\n' "$c_warn" "$c_z" "$*"; }
bad()  { PROBLEMS=$((PROBLEMS+1)); printf '    %s[FAIL]%s %s\n' "$c_bad" "$c_z" "$*"; }

hd "1. Identity - one banner, no overrides"
N="$(git config user.name 2>/dev/null)"
E="$(git config user.email 2>/dev/null)"
if [ "$N" = "$CANONICAL_NAME" ] && [ "$E" = "$CANONICAL_EMAIL" ]; then
  ok "$N <$E>"
else
  bad "identity is $N <$E>, expected $CANONICAL_NAME <$CANONICAL_EMAIL>"
fi

# The split that started this: a session passing -c user.name=... invented an
# author that looked like a second person committing to the same branch.
if [ -n "${GIT_AUTHOR_NAME:-}${GIT_COMMITTER_NAME:-}" ]; then
  bad "GIT_AUTHOR_NAME/GIT_COMMITTER_NAME is set in this environment - it will override the identity"
else
  ok "no author override in the environment"
fi

hd "2. How many copies of this repo exist on this machine"
CLONES=()
for root in /e /c/Users/DGMic; do
  while IFS= read -r g; do
    d="$(dirname "$g")"
    git -C "$d" remote -v 2>/dev/null | grep -qi "$REMOTE_MATCH" && CLONES+=("$d")
  done < <(find "$root" -maxdepth 4 -type d -name .git 2>/dev/null)
done
COUNT=${#CLONES[@]}
if [ "$COUNT" -le 1 ]; then
  ok "one checkout"
elif [ "$COUNT" -le 3 ]; then
  warn "$COUNT checkouts - workable, but only $CANONICAL_DIR should be edited"
else
  bad "$COUNT checkouts. Every extra one is somewhere work can be done and forgotten."
  printf '           (14 of these are Antigravity IDE snapshots under ~/antigravity)\n'
fi

hd "3. Work that exists in only one place"
UNIQUE_TOTAL=0
for d in "${CLONES[@]}"; do
  n=$(git -C "$d" log --branches --not --remotes --oneline 2>/dev/null | wc -l | tr -d ' ')
  [ "${n:-0}" = "0" ] && continue
  UNIQUE_TOTAL=$((UNIQUE_TOTAL + n))
  bad "$n unpushed commit(s) in $d"
  git -C "$d" log --branches --not --remotes --format='             %h %ad %an  %s' --date=short 2>/dev/null | head -6
done
if [ "$UNIQUE_TOTAL" = "0" ]; then
  ok "nothing is unpushed - every commit exists on GitHub too"
else
  printf '           %sRun GATEFLAME-SAVE-EVERYTHING.cmd before deleting anything.%s\n' "$c_bad" "$c_z"
fi

hd "4. Branches with nowhere to push to"
for d in "${CLONES[@]}"; do
  while IFS= read -r line; do
    br="${line%% *}"; up="${line#* }"
    if [ "$up" = "-" ] || [ -z "$up" ]; then
      warn "$(basename "$d")/$br has no upstream - pushes will not go anywhere by default"
    fi
  done < <(git -C "$d" for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads 2>/dev/null)
done

hd "5. Authors in the history"
AUTHORS=$(git -C "$CANONICAL_DIR" log --all --format='%an <%ae>' 2>/dev/null | sort -u | wc -l | tr -d ' ')
if [ "${AUTHORS:-0}" -le 2 ]; then
  ok "$AUTHORS identity/identities"
else
  warn "$AUTHORS different identities in the history:"
  git -C "$CANONICAL_DIR" log --all --format='%an <%ae>' 2>/dev/null | sort | uniq -c | sort -rn | sed 's/^/           /'
  printf '           Historic and NOT worth rewriting - rewriting shared history is\n'
  printf '           itself a way to lose work. What matters is that new commits are one.\n'
fi

echo
echo "========================================================================================"
if [ "$PROBLEMS" -eq 0 ]; then
  printf '  %sONE CLEAR LINE.%s Nothing unpushed, one identity, canonical copy is %s\n' "$c_ok" "$c_z" "$CANONICAL_DIR"
else
  printf '  %s%s thing(s) need attention.%s\n' "$c_bad" "$PROBLEMS" "$c_z"
fi
echo "========================================================================================"
exit $(( PROBLEMS > 0 ? 1 : 0 ))
