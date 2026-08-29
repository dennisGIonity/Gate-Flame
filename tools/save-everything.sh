#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - SAVE EVERYTHING THAT EXISTS IN ONLY ONE PLACE
# ========================================================================================
# Pushes. Never deletes, never forces, never rewrites. If a push is refused this
# stops and says so rather than forcing - a forced push is how the LAST copy of
# something disappears.
# ========================================================================================
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

CLONES=(/e/Gateflame /c/Users/DGMic/GateFlame-Repo /c/Users/DGMic/gf-scratch)
SAVED=0; FAILED=0; SKIPPED=0

echo '=== 1. SSH AGENT ==='
if ! gf_agent; then
  echo "  agent empty - starting one and loading your key."
  echo "  TYPE YOUR SSH PASSPHRASE WHEN ASKED. Nothing shows while you type."
  echo
  eval "$(ssh-agent -a "$HOME/.ssh/agent.sock" -s 2>/dev/null || ssh-agent -s)" >/dev/null 2>&1
  export SSH_AUTH_SOCK="${SSH_AUTH_SOCK:-$HOME/.ssh/agent.sock}"
  ssh-add "$HOME/.ssh/id_ed25519" || { echo "  KEY NOT LOADED - cannot save anything. Stopping."; exit 1; }
fi
echo "  agent OK: $(ssh-add -l | head -1)"
echo

echo '=== 2. FETCH, SO "UNPUSHED" MEANS SOMETHING ==='
for d in "${CLONES[@]}"; do
  [ -d "$d/.git" ] || continue
  # One clone was still on an https remote, which is why its branches had no
  # upstream and looked unpushed when they were not.
  git -C "$d" remote set-url --push origin git@github.com:dennisGIonity/Gate-Flame.git 2>/dev/null
  printf '  %-38s ' "$d"
  git -C "$d" fetch --all --quiet 2>/dev/null && echo 'fetched' || echo 'FETCH FAILED'
done
echo

echo '=== 3. PUSHING EVERY BRANCH THAT HAS UNIQUE WORK ==='
for d in "${CLONES[@]}"; do
  [ -d "$d/.git" ] || continue
  echo "--- $d"
  # Every local branch, not just the checked-out one. Three commits sat on
  # gf-scratch's `deploybundle` for ten days purely because nobody was standing
  # on that branch when they looked.
  while IFS= read -r br; do
    [ -n "$br" ] || continue
    unique=$(git -C "$d" log "$br" --not --remotes --oneline 2>/dev/null | wc -l | tr -d ' ')
    if [ "${unique:-0}" = "0" ]; then
      printf '      %-30s already safe\n' "$br"; SKIPPED=$((SKIPPED+1)); continue
    fi
    printf '      %-30s %s unique -> ' "$br" "$unique"
    # Two clones can hold same-named branches. Namespace the secondaries so
    # nothing can overwrite anything.
    target="$br"
    case "$d" in
      */gf-scratch)     target="rescue/gf-scratch-$br" ;;
      */GateFlame-Repo) target="rescue/repo-c-$br" ;;
    esac
    [ "$target" != "$br" ] && printf '(as %s) ' "$target"
    if git -C "$d" push origin "$br:refs/heads/$target" 2>/dev/null; then
      echo 'SAVED'; SAVED=$((SAVED+1))
    else
      echo 'REFUSED - not forcing. Needs a human.'; FAILED=$((FAILED+1))
    fi
  done < <(git -C "$d" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null)
done

echo
echo '========================================================================================'
printf '  saved %s, already safe %s, refused %s\n' "$SAVED" "$SKIPPED" "$FAILED"
if [ "$FAILED" -gt 0 ]; then
  echo '  Something was refused. NOTHING has been deleted. Show this before removing a folder.'
else
  echo '  Every commit on this machine now exists on GitHub as well.'
  echo '  Only now is it safe to discuss deleting duplicate folders.'
fi
echo '========================================================================================'
