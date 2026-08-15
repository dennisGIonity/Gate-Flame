#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME — ANDROID RELEASE KEYSTORE GENERATOR (RUN ONCE, ON A MACHINE YOU CONTROL)
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Document ID: DOC-2026-08-014-KEYGEN | Version: 1.0 | Updated: 2026-08-14 SAST
# Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
# Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
# Classification: CONFIDENTIAL — creates unrecoverable key material | Building Tomorrow, Today.
# ========================================================================================
#
# ┌────────────────────────────────────────────────────────────────────────────────────┐
# │  NEVER RUN THIS IN A CLOUD SESSION, A CONTAINER, A CI RUNNER, OR ANY MACHINE YOU  │
# │  DO NOT PHYSICALLY CONTROL.                                                       │
# │                                                                                    │
# │  A signing key created in an ephemeral container and passed back through a chat   │
# │  transcript is ALREADY DISCLOSED — treat it as public the moment it exists there. │
# │  There is no "just this once": the key cannot be rotated. Android will not        │
# │  install an update signed by a different key than the one already on a device, so │
# │  a compromised or lost key means every customer in the field must uninstall and   │
# │  re-pair their node. This is the one artifact in the whole project with no         │
# │  recovery path.                                                                    │
# │                                                                                    │
# │  Run it on `wabakipi` (or the equivalent workstation), interactively, once.        │
# └────────────────────────────────────────────────────────────────────────────────────┘
#
# What it does:
#   1. Refuses to run in a container / CI, or non-interactively, or over a keystore
#      that already exists.
#   2. Prompts for the store and key passwords — never argv, never echoed.
#   3. Generates an RSA 4096 key, 30-year validity, with the real Ionity dname.
#   4. Prints the SHA-256 certificate fingerprint and verifies the keystore reads back.
#   5. Optionally writes android/keystore.properties (and checks it is gitignored).
#   6. Prints the 3-2-1 backup checklist and what is unrecoverable if it is lost.
#
# Companion documents:
#   android/KEYSTORE.md               full runbook (backup, CI, handling rules)
#   android/app/build.gradle          how the keystore is consumed at build time
#   android/generate-keystore.ps1     PowerShell twin, for wabakipi (Windows)
#
# Usage:
#   bash android/generate-keystore.sh [--keystore PATH] [--alias NAME]
#                                     [--storetype JKS|PKCS12] [--help]
#
# Passwords are NEVER accepted as arguments. Argv lands in shell history and in
# `ps` output for every user on the machine; that is a disclosure, not a shortcut.
# ========================================================================================

set -uo pipefail

umask 077

# ── Presentation ───────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

say()  { printf '%s\n' "$*"; }
info() { printf '%s\n' "${C_CYAN}$*${C_RESET}"; }
ok()   { printf '%s\n' "${C_GREEN}✓ $*${C_RESET}"; }
warn() { printf '%s\n' "${C_YELLOW}! $*${C_RESET}" >&2; }
die()  { printf '%s\n' "${C_RED}✗ $*${C_RESET}" >&2; exit 1; }
rule() { printf '%s\n' "────────────────────────────────────────────────────────────────────────"; }

# ── Defaults ───────────────────────────────────────────────────────────────────────────
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)   # .../android
ALIAS="gateflame"
STORETYPE="JKS"
# Deliberately OUTSIDE the repository. .gitignore covers *.jks, but the safest
# file is one git can never see, in a directory git is not watching.
KEYSTORE_PATH="${HOME}/.gateflame-signing/gateflame-release.jks"
DNAME="CN=Gate^Flame, OU=AEDI, O=Ionity (Pty) Ltd, L=Centurion, ST=Gauteng, C=ZA"
VALIDITY_DAYS=10950     # 30 years — see note below
KEYSIZE=4096
KEYALG="RSA"
SIGALG="SHA256withRSA"
PROPS_FILE="${SCRIPT_DIR}/keystore.properties"

usage() {
  # Print the comment header at the top of this file, verbatim minus the '#'.
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
  exit 0
}

# ── Argument parsing (no password may ever arrive this way) ─────────────────────────────
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --keystore)
      [ "$#" -ge 2 ] || die "--keystore needs a path."
      KEYSTORE_PATH="$2"; shift 2 ;;
    --alias)
      [ "$#" -ge 2 ] || die "--alias needs a name."
      ALIAS="$2"; shift 2 ;;
    --storetype)
      [ "$#" -ge 2 ] || die "--storetype needs JKS or PKCS12."
      STORETYPE=$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]'); shift 2 ;;
    *pass*|*PASS*|*Pass*)
      die "Refusing: '$1' looks like a password argument.
  Passwords are prompted for, never passed on the command line — argv is visible
  in shell history and in \`ps\` to every user on this machine." ;;
    *) die "Unknown argument: $1  (try --help)" ;;
  esac
done

case "$STORETYPE" in
  JKS|PKCS12) : ;;
  *) die "--storetype must be JKS or PKCS12 (got '$STORETYPE')." ;;
esac

rule
say "${C_BOLD}Gate^Flame — Android release keystore generation${C_RESET}"
rule
say "This creates key material that CANNOT be regenerated, rotated, or recovered."
say "Read android/KEYSTORE.md first if you have not."
say ""

# ── Guard 1: never in a container, a CI runner, or a cloud session ─────────────────────
CONTAINER_REASONS=()
[ -f /.dockerenv ]        && CONTAINER_REASONS+=("/.dockerenv exists (Docker container)")
[ -f /run/.containerenv ] && CONTAINER_REASONS+=("/run/.containerenv exists (Podman container)")
[ -n "${CI:-}" ]                  && CONTAINER_REASONS+=("\$CI is set (CI runner)")
[ -n "${GITHUB_ACTIONS:-}" ]      && CONTAINER_REASONS+=("\$GITHUB_ACTIONS is set (GitHub Actions)")
[ -n "${CODESPACES:-}" ]          && CONTAINER_REASONS+=("\$CODESPACES is set (GitHub Codespaces)")
[ -n "${GITLAB_CI:-}" ]           && CONTAINER_REASONS+=("\$GITLAB_CI is set (GitLab CI)")
[ -n "${KUBERNETES_SERVICE_HOST:-}" ] && CONTAINER_REASONS+=("\$KUBERNETES_SERVICE_HOST is set (Kubernetes pod)")
if command -v systemd-detect-virt >/dev/null 2>&1; then
  _virt=$(systemd-detect-virt --container 2>/dev/null || true)
  if [ -n "$_virt" ] && [ "$_virt" != "none" ]; then
    CONTAINER_REASONS+=("systemd-detect-virt reports container: ${_virt}")
  fi
fi
if [ -r /proc/1/cgroup ] && grep -qE '(docker|containerd|kubepods|lxc|podman)' /proc/1/cgroup 2>/dev/null; then
  CONTAINER_REASONS+=("/proc/1/cgroup names a container runtime")
fi

if [ "${#CONTAINER_REASONS[@]}" -gt 0 ]; then
  printf '%s\n' "${C_RED}✗ REFUSING TO GENERATE A SIGNING KEY HERE.${C_RESET}" >&2
  for r in "${CONTAINER_REASONS[@]}"; do printf '    - %s\n' "$r" >&2; done
  cat >&2 <<'EOF'

  This looks like a container, a CI runner, or a cloud session.

  A release key created here is disclosed the moment it exists: the filesystem
  is ephemeral and shared, the passwords you type may be captured, and anything
  that has to be copied out of here travels through a transcript, a log, or an
  artifact store. The key cannot be rotated afterwards — an APK signed with a
  different key can never update one already installed in the field.

  Run this on your own workstation (wabakipi), interactively, once:

      bash android/generate-keystore.sh

  If you are here to test the SCRIPT rather than create the real key, do that on
  the workstation too, with --keystore /tmp/throwaway.jks, and delete it after.
EOF
  exit 1
fi
ok "Not a container/CI environment."

# ── Guard 2: must be interactive, so passwords can be prompted for ─────────────────────
if [ ! -t 0 ]; then
  die "stdin is not a terminal.
  Passwords must be typed at a prompt. This script will not read them from a
  pipe, a file, or an environment variable — those all leave copies behind."
fi
ok "Interactive terminal present."

# ── Guard 3: keytool must exist ────────────────────────────────────────────────────────
command -v keytool >/dev/null 2>&1 || die "keytool is not on PATH.
  Install a JDK (17 LTS is fine), or add Android Studio's bundled JDK to PATH:
    Windows: %LOCALAPPDATA%\\Programs\\Android Studio\\jbr\\bin
    Linux:   /opt/android-studio/jbr/bin"
info "keytool: $(command -v keytool)"
keytool -version 2>/dev/null | head -1 || true

# ── Guard 4: never overwrite an existing keystore ──────────────────────────────────────
if [ -e "$KEYSTORE_PATH" ]; then
  die "A keystore already exists at:
    $KEYSTORE_PATH

  REFUSING to touch it. Overwriting it would destroy the only copy of the key
  that signs every Gate^Flame APK already installed in the field — and there is
  no way to get it back.

  If you are certain you want a NEW key (new applicationId, new app, every
  customer reinstalls), move the old file aside yourself, deliberately:
    mv '$KEYSTORE_PATH' '$KEYSTORE_PATH.retired-\$(date +%Y%m%d)'

  To inspect the existing one instead:
    keytool -list -v -keystore '$KEYSTORE_PATH' -alias '$ALIAS'"
fi

KEYSTORE_DIR=$(dirname -- "$KEYSTORE_PATH")
if [ ! -d "$KEYSTORE_DIR" ]; then
  mkdir -p -- "$KEYSTORE_DIR" || die "Could not create $KEYSTORE_DIR"
  ok "Created $KEYSTORE_DIR (mode 0700)."
fi
chmod 700 -- "$KEYSTORE_DIR" 2>/dev/null || warn "Could not chmod 700 $KEYSTORE_DIR — check its permissions yourself."

case "$KEYSTORE_DIR" in
  "$SCRIPT_DIR"*|"$(cd -- "$SCRIPT_DIR/.." && pwd)"*)
    warn "That path is INSIDE the repository working tree.
    .gitignore covers *.jks, but a keystore git can never see is safer.
    Recommended: ${HOME}/.gateflame-signing/" ;;
esac

say ""
info "About to generate:"
say "  keystore   : $KEYSTORE_PATH"
say "  store type : $STORETYPE"
say "  alias      : $ALIAS"
say "  algorithm  : $KEYALG $KEYSIZE, $SIGALG"
say "  validity   : $VALIDITY_DAYS days (~30 years)"
say "  dname      : $DNAME"
say ""
say "Why 30 years: an expired key cannot sign an update, and Android will not"
say "accept an APK re-signed with a replacement key. The key must outlive the"
say "product, not the release cycle. Google Play additionally requires validity"
say "past 2033."
say ""
printf 'Proceed? [y/N] '
read -r reply
case "$reply" in
  y|Y|yes|YES) : ;;
  *) say "Aborted. Nothing was written."; exit 1 ;;
esac

# ── Password prompts ───────────────────────────────────────────────────────────────────
# Read twice, never echoed, validated for the constraints Java .properties and
# keytool actually impose. Nothing is written to disk or exported.
SECRET=""
read_secret() {
  local prompt="$1" min="$2" first="" second=""
  while :; do
    printf '%s' "$prompt" >&2
    IFS= read -r -s first || { printf '\n' >&2; die "No input — aborted."; }
    printf '\n' >&2
    printf '  confirm: ' >&2
    IFS= read -r -s second || { printf '\n' >&2; die "No input — aborted."; }
    printf '\n' >&2

    if [ "$first" != "$second" ]; then
      warn "They do not match. Again."
      continue
    fi
    if [ "${#first}" -lt "$min" ]; then
      warn "Too short (${#first} chars, minimum ${min}). This key has to hold for 30 years."
      continue
    fi
    case "$first" in
      *\\*)
        warn "Backslashes are not usable here: Gradle reads keystore.properties as a
    Java properties file, where '\\' is an escape character. Choose a passphrase
    without backslashes."
        continue ;;
      " "*|*" ")
        warn "Leading/trailing spaces are silently stripped by the properties reader.
    Choose a passphrase without them."
        continue ;;
    esac
    if printf '%s' "$first" | LC_ALL=C grep -q '[^ -~]'; then
      warn "Non-ASCII characters. Gradle loads keystore.properties as ISO-8859-1, so
    these may not survive the round trip. Use printable ASCII."
      continue
    fi
    break
  done
  SECRET="$first"
}

say ""
rule
say "${C_BOLD}Passwords${C_RESET}"
rule
say "Generate them in your password manager NOW and paste them in — do not invent"
say "them here and promise to save them afterwards. Nothing is echoed."
say ""

if [ "$STORETYPE" = "PKCS12" ]; then
  say "PKCS12 keystores cannot hold a key password different from the store"
  say "password — one passphrase is used for both, and keystore.properties will"
  say "carry the same value in storePassword and keyPassword."
  say ""
  read_secret "Keystore passphrase (min 16 chars): " 16
  STORE_PW="$SECRET"; SECRET=""
  KEY_PW="$STORE_PW"
else
  say "JKS: use TWO different, long, randomly generated passphrases."
  say ""
  read_secret "Store passphrase (min 16 chars): " 16
  STORE_PW="$SECRET"; SECRET=""
  read_secret "Key passphrase   (min 16 chars): " 16
  KEY_PW="$SECRET"; SECRET=""
  if [ "$STORE_PW" = "$KEY_PW" ]; then
    warn "Store and key passphrases are identical. Allowed, but one leak then loses both."
    printf 'Continue anyway? [y/N] '
    read -r reply2
    case "$reply2" in y|Y|yes|YES) : ;; *) die "Aborted. Nothing was written." ;; esac
  fi
fi

# ── Generate ───────────────────────────────────────────────────────────────────────────
# Passwords go in on stdin, in the order keytool asks for them. They are NOT
# passed as -storepass/-keypass, because keytool's argv is visible in `ps` to
# every user on the machine for as long as the process runs.
say ""
info "Generating (RSA 4096 takes a few seconds)…"

_gen_stdin() {
  if [ "$STORETYPE" = "PKCS12" ]; then
    printf '%s\n%s\n' "$STORE_PW" "$STORE_PW"
  else
    printf '%s\n%s\n%s\n%s\n' "$STORE_PW" "$STORE_PW" "$KEY_PW" "$KEY_PW"
  fi
}

if ! _gen_stdin | keytool -genkeypair -v \
      -keystore "$KEYSTORE_PATH" \
      -storetype "$STORETYPE" \
      -alias "$ALIAS" \
      -keyalg "$KEYALG" \
      -keysize "$KEYSIZE" \
      -sigalg "$SIGALG" \
      -validity "$VALIDITY_DAYS" \
      -dname "$DNAME"; then
  [ -e "$KEYSTORE_PATH" ] && rm -f -- "$KEYSTORE_PATH"
  die "keytool failed. Nothing usable was left behind."
fi

[ -s "$KEYSTORE_PATH" ] || die "keytool reported success but $KEYSTORE_PATH is empty."
chmod 600 -- "$KEYSTORE_PATH" 2>/dev/null || warn "Could not chmod 600 the keystore — fix its permissions manually."
ok "Keystore written: $KEYSTORE_PATH ($(wc -c <"$KEYSTORE_PATH" | tr -d ' ') bytes, mode 0600)"

# ── Verify it reads back and can be used to sign ───────────────────────────────────────
say ""
info "Verifying the keystore reads back with the passphrase you typed…"
LIST_OUT=$(printf '%s\n' "$STORE_PW" | keytool -list -v \
             -keystore "$KEYSTORE_PATH" -storetype "$STORETYPE" -alias "$ALIAS" 2>&1) || {
  printf '%s\n' "$LIST_OUT" >&2
  die "Could not read the keystore back. Do not ship anything signed with it."
}

trim() { sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
FPR=$(printf '%s\n' "$LIST_OUT"        | grep -Ei 'SHA-?256:'                    | head -1 | trim)
VALID_LINE=$(printf '%s\n' "$LIST_OUT" | grep -E  'Valid from:'                   | head -1 | trim)
KEY_LINE=$(printf '%s\n' "$LIST_OUT"   | grep -Ei 'Subject Public Key Algorithm:' | head -1 | trim)
SIG_LINE=$(printf '%s\n' "$LIST_OUT"   | grep -Ei 'Signature algorithm name:'     | head -1 | trim)
ENTRY_LINE=$(printf '%s\n' "$LIST_OUT" | grep -Ei 'Entry type:'                   | head -1 | trim)

# A PrivateKeyEntry is what signs. A TrustedCertEntry cannot, and would mean the
# keystore is useless for release builds even though the file exists.
case "$ENTRY_LINE" in
  *PrivateKeyEntry*) ok "Entry type is PrivateKeyEntry — signable." ;;
  "")                warn "Could not read the entry type from keytool output." ;;
  *)                 die "Entry is '$ENTRY_LINE', not a PrivateKeyEntry. This keystore cannot sign an APK." ;;
esac

# Prove the private key is usable, not just that the file parses: -certreq must
# unlock the key itself. This is the closest read-only equivalent of signing.
if printf '%s\n%s\n' "$STORE_PW" "$KEY_PW" \
     | keytool -certreq -keystore "$KEYSTORE_PATH" -storetype "$STORETYPE" -alias "$ALIAS" \
       >/dev/null 2>&1; then
  ok "Private key unlocks with the key passphrase — this keystore can sign."
else
  warn "Could not exercise the private key with -certreq. Verify manually before
    the first release build:
      keytool -certreq -keystore '$KEYSTORE_PATH' -alias '$ALIAS' > /dev/null"
fi

say ""
rule
say "${C_BOLD}Certificate${C_RESET}"
rule
[ -n "$KEY_LINE" ]   && say "  $KEY_LINE"
[ -n "$SIG_LINE" ]   && say "  $SIG_LINE"
[ -n "$VALID_LINE" ] && say "  $VALID_LINE"
if [ -n "$FPR" ]; then
  say "  ${C_BOLD}${FPR}${C_RESET}"
else
  warn "Could not parse the SHA-256 fingerprint. Full keytool output:"
  printf '%s\n' "$LIST_OUT"
fi
say ""
say "RECORD THAT FINGERPRINT NOW, somewhere durable and outside this machine."
say "Every future release must show the same one:"
say "    npm run build:apk            # prints the signing fingerprint"
say "    node scripts/apk-fingerprint.mjs release/GateFlame-Mobile.apk"
say "If it ever differs, stop — you have signed with the wrong key, and shipping"
say "it strands every device already paired in the field."

# ── keystore.properties ────────────────────────────────────────────────────────────────
say ""
rule
say "${C_BOLD}android/keystore.properties${C_RESET}"
rule

# storeFile is resolved by Gradle relative to the android/ directory
# (rootProject.file(...) in android/app/build.gradle). An absolute path with
# forward slashes is unambiguous on both Linux and Windows.
STORE_FILE_VALUE="$KEYSTORE_PATH"
REL_HINT=""
if command -v realpath >/dev/null 2>&1; then
  REL_HINT=$(realpath --relative-to="$SCRIPT_DIR" -- "$KEYSTORE_PATH" 2>/dev/null || true)
fi

if [ -e "$PROPS_FILE" ]; then
  warn "$PROPS_FILE already exists — NOT overwriting it."
  say "  It may hold the credentials for a different (possibly the real) keystore."
  say "  Update it yourself; the values for this keystore are:"
  say "    storeFile=${STORE_FILE_VALUE}"
  say "    keyAlias=${ALIAS}"
  say "    storePassword=<the store passphrase you just typed>"
  say "    keyPassword=<the key passphrase you just typed>"
else
  printf 'Write %s now, with the passphrases you just typed? [y/N] ' "$PROPS_FILE"
  read -r write_props
  case "$write_props" in
    y|Y|yes|YES)
      {
        printf '%s\n' "# Gate^Flame Android release signing — LOCAL ONLY, NEVER COMMIT."
        printf '%s\n' "# Generated by android/generate-keystore.sh on $(date '+%Y-%m-%d %H:%M:%S %Z')."
        printf '%s\n' "#"
        printf '%s\n' "# Read by android/app/build.gradle. storeFile is resolved relative to the"
        printf '%s\n' "# android/ directory; an absolute path is used here so it cannot drift."
        [ -n "$REL_HINT" ] && printf '%s\n' "# Relative equivalent: ${REL_HINT}"
        printf '%s\n' "#"
        printf '%s\n' "# This file contains plaintext passphrases. It is mode 0600 and gitignored."
        printf '%s\n' "# CI does NOT read it — CI uses GATEFLAME_KEYSTORE_PATH / _PASSWORD /"
        printf '%s\n' "# GATEFLAME_KEY_ALIAS / GATEFLAME_KEY_PASSWORD instead. See android/KEYSTORE.md."
        printf 'storeFile=%s\n'     "$STORE_FILE_VALUE"
        printf 'storePassword=%s\n' "$STORE_PW"
        printf 'keyAlias=%s\n'      "$ALIAS"
        printf 'keyPassword=%s\n'   "$KEY_PW"
      } > "$PROPS_FILE" || die "Could not write $PROPS_FILE"
      chmod 600 -- "$PROPS_FILE" 2>/dev/null || warn "Could not chmod 600 $PROPS_FILE"
      ok "Wrote $PROPS_FILE (mode 0600)."
      ;;
    *)
      say "Skipped. Create it by hand when you are ready — template:"
      say ""
      say "    storeFile=${STORE_FILE_VALUE}"
      say "    storePassword=<store passphrase>"
      say "    keyAlias=${ALIAS}"
      say "    keyPassword=<key passphrase>"
      say ""
      say "Gradle refuses to build an unsigned release without that file (or the"
      say "GATEFLAME_KEYSTORE_* environment variables), so this is not optional"
      say "before shipping."
      ;;
  esac
fi

# Passwords have done their job. Drop them from this shell's memory.
STORE_PW=""; KEY_PW=""; SECRET=""
unset STORE_PW KEY_PW SECRET

# ── Confirm the gitignore actually covers it ────────────────────────────────────────────
say ""
info "Checking that git can never track the credentials…"
if command -v git >/dev/null 2>&1 && git -C "$SCRIPT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  IGNORE_RULE=$(git -C "$SCRIPT_DIR" check-ignore -v -- "$PROPS_FILE" 2>/dev/null || true)
  if [ -n "$IGNORE_RULE" ]; then
    ok "keystore.properties is ignored by: $IGNORE_RULE"
  else
    printf '%s\n' "${C_RED}✗ keystore.properties is NOT gitignored.${C_RESET}" >&2
    say "  Add these lines to .gitignore BEFORE your next commit:" >&2
    say "      keystore.properties" >&2
    say "      android/keystore.properties" >&2
    say "      *.jks" >&2
    say "      *.keystore" >&2
  fi
  KS_RULE=$(git -C "$SCRIPT_DIR" check-ignore -v -- "$KEYSTORE_PATH" 2>/dev/null || true)
  if [ -n "$KS_RULE" ]; then
    ok "Keystore path is ignored by: $KS_RULE"
  else
    case "$KEYSTORE_PATH" in
      "$(cd -- "$SCRIPT_DIR/.." && pwd)"/*)
        warn "The keystore sits INSIDE the repository and is not covered by a
    .gitignore rule. Move it to ${HOME}/.gateflame-signing/ or add a rule now." ;;
      *) ok "Keystore lives outside the repository — git cannot see it at all." ;;
    esac
  fi
  if git -C "$SCRIPT_DIR" status --short 2>/dev/null | grep -q 'keystore.properties'; then
    printf '%s\n' "${C_RED}✗ git status lists keystore.properties. Do not commit. Fix .gitignore first.${C_RESET}" >&2
  fi
else
  warn "Not a git working tree (or git not installed) — could not verify the ignore rules.
    Before your next commit, run:  git check-ignore -v android/keystore.properties"
fi

# ── Backup checklist ───────────────────────────────────────────────────────────────────
cat <<EOF

$(rule)
${C_BOLD}BACK IT UP BEFORE THE FIRST SIGNED BUILD — 3 copies, 2 media, 1 off-site${C_RESET}
$(rule)

Do this NOW. The window where losing this key is cheap closes the moment the
first signed APK reaches a customer.

  [ ] Copy 1 — working copy, encrypted volume on this machine
                 $KEYSTORE_PATH
  [ ] Copy 2 — offline encrypted USB, stored in a safe
                 NOT in the same building as copy 1
  [ ] Copy 3 — company password manager as a file attachment, or a sealed
                 envelope holding a printed base64 dump
                 (survives loss of both machines)

  [ ] Both passphrases stored in the password manager — SEPARATELY from the
        keystore file. A backup containing the file and both passwords together
        is a single point of compromise, not a single point of recovery.
  [ ] SHA-256 fingerprint recorded off-machine:
        ${FPR:-<re-read it with keytool -list -v>}
  [ ] Restore rehearsed once: copy the backup to a scratch path and run
        keytool -list -v -keystore <copy> -alias $ALIAS
        An untested backup is a hope, not a backup.

${C_YELLOW}UNRECOVERABLE IF LOST OR LEAKED — there is no reset and no support ticket:${C_RESET}
  • The private key in $(basename -- "$KEYSTORE_PATH"). It cannot be regenerated by anyone, ever.
  • The ability to ship ANY update to every Gate^Flame node already in the field.
    Android refuses an update signed by a different key, with no override.
  • The app identity today.ionity.gateflame on Google Play. Recovery means a new
    applicationId — a new app — and every customer uninstalling, reinstalling and
    re-pairing their node. Plan the comms, not the fix.
  • Every pairing on every customer handset, because reinstalling wipes it.

Never paste this keystore, its base64, or either passphrase into a chat window,
an AI session, a ticket, or an email. Anything pasted into a transcript is
disclosed. See android/KEYSTORE.md §"Handling rules".

Next: android/KEYSTORE.md step 4 — npm run build:apk, then compare the printed
fingerprint against the one above.
EOF

exit 0

# ========================================================================================
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
# Governance: Policy 986 AED | Building Tomorrow, Today. | Anything is Possible with God.
# ========================================================================================
