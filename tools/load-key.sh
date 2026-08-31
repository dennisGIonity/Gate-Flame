#!/bin/bash
# Load the SSH key into an agent that the REST OF THE MACHINE can find.
#
# The subtlety this script exists for: a dead agent leaves its socket file
# behind, `ssh-agent -a` then refuses that path, and the obvious fallback
# (`ssh-agent -s`) succeeds at a random temp path - loading the key into an
# agent nothing else can reach while printing every sign of success.
#
# Safe to run twice. Never removes a socket that still has an agent behind it.
SOCK="$HOME/.ssh/agent.sock"
KEY="$HOME/.ssh/id_ed25519"

if [ ! -f "$KEY" ]; then
  echo "  ERROR: no key at $KEY"
  exit 1
fi

export SSH_AUTH_SOCK="$SOCK"

# ssh-add -l has THREE outcomes and they need three different responses:
#   0 = agent reachable, key already loaded  -> nothing to do
#   1 = agent reachable but EMPTY            -> add the key, keep the agent
#   2 = cannot connect                       -> socket is dead or absent
# Collapsing 1 and 2 would delete the socket of a live-but-empty agent and
# orphan it, which is the same shape of bug this script was written to fix.
ssh-add -l >/dev/null 2>&1
case $? in
  0)
    echo "  Agent already running with a key loaded:"
    ssh-add -l | sed 's/^/    /'
    ;;
  1)
    echo "  Agent is running but empty - adding the key."
    echo ""
    ssh-add "$KEY" || { echo "  Key was NOT added."; exit 1; }
    ;;
  *)
    # Nothing is listening, so any file at this path is a leftover and safe to
    # clear. Verified by the failed connect immediately above, not assumed.
    if [ -e "$SOCK" ]; then
      echo "  Clearing a stale socket left behind by a dead agent."
      rm -f "$SOCK"
    fi

    eval "$(ssh-agent -a "$SOCK" -s)" >/dev/null 2>&1
    if [ ! -e "$SOCK" ]; then
      echo "  ERROR: agent would not bind to $SOCK"
      exit 1
    fi

    echo ""
    ssh-add "$KEY" || { echo "  Key was NOT added."; exit 1; }
    ;;
esac

# READ-BACK. ssh-add succeeding proves the key entered SOME agent; it does not
# prove the agent is reachable at the canonical path, and it does not prove
# GitHub accepts the key. Ask GitHub.
echo ""
echo "  Verifying against GitHub..."
OUT=$(SSH_AUTH_SOCK="$SOCK" ssh -o BatchMode=yes -o ConnectTimeout=10 -T git@github.com 2>&1)
case "$OUT" in
  *"successfully authenticated"*)
    echo "  KEY LOADED AND VERIFIED - $(echo "$OUT" | head -1)"
    ;;
  *)
    echo "  KEY IS NOT WORKING YET. GitHub said:"
    echo "$OUT" | sed 's/^/    /'
    exit 1
    ;;
esac

# Anything started AFTER this needs the variable too. Persist it for the user's
# own future shells so they are not the only thing that has to remember.
if ! grep -q "SSH_AUTH_SOCK=$SOCK" "$HOME/.bashrc" 2>/dev/null; then
  echo "export SSH_AUTH_SOCK=$SOCK" >> "$HOME/.bashrc"
fi
