#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - SET ONE KEY IN dns-stack/.env AND APPLY IT
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# Called by netapply. Exists as its own tiny program for one reason: dns-stack/.env
# holds the Pi-hole admin password at mode 600, root-owned. Editing it from the
# agent would mean the agent needed write access to a credential file, so the
# narrow privileged operation is isolated here instead.
#
#   gateflame-env-set <stack-dir> <KEY> <VALUE>
#
# Idempotent: if the key already has that value, nothing is written and the stack
# is not recreated. A 60-second timer must never be able to thrash the resolver.
# ========================================================================================
set -uo pipefail

STACK="${1:-}"
KEY="${2:-}"
VALUE="${3-}"

log() { logger -t gateflame-env-set "$*" 2>/dev/null; echo "$*"; }
die() { log "FAIL: $*"; exit 1; }

[[ -n "$STACK" && -n "$KEY" ]] || die "usage: gateflame-env-set <stack-dir> <KEY> <VALUE>"
[[ -d "$STACK" ]] || die "$STACK is not a directory"
[[ -f "$STACK/docker-compose.yml" ]] || die "$STACK does not look like the dns-stack"
[[ $EUID -eq 0 ]] || die "must run as root - .env is a credential file"

ENVFILE="$STACK/.env"
touch "$ENVFILE"
chmod 600 "$ENVFILE"

CURRENT="$(grep -oP "(?<=^${KEY}=).*" "$ENVFILE" 2>/dev/null || true)"
if [[ "$CURRENT" == "$VALUE" ]]; then
  log "$KEY already = '$VALUE' - nothing to do"
  exit 0
fi

# Rewrite in place, preserving every other line - including the password.
if grep -q "^${KEY}=" "$ENVFILE"; then
  # Value goes through a temp file rather than into the sed expression: a value
  # containing / or & would otherwise be interpreted as sed syntax and silently
  # corrupt the file.
  awk -v k="$KEY" -v v="$VALUE" \
      'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' \
      "$ENVFILE" > "${ENVFILE}.new"
  chmod 600 "${ENVFILE}.new"
  mv "${ENVFILE}.new" "$ENVFILE"
else
  printf '%s=%s\n' "$KEY" "$VALUE" >> "$ENVFILE"
fi
log "$KEY set to '$VALUE' (was '${CURRENT:-unset}')"

cd "$STACK" || die "cannot enter $STACK"
docker compose up -d >/dev/null 2>&1 || die "docker compose up -d failed"
log "stack recreated"
