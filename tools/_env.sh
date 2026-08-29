#!/usr/bin/env bash
# ========================================================================================
# GATE^FLAME - shared shell helpers for the tools in this folder
# Owner: Dennis Grobler (Wabakipi) | Ionity Global | Governance: Policy 986 AED
# ========================================================================================
#
# EVERYTHING OPERATIONAL LIVES HERE, ON E:, IN THE REPO.
#
# It used to live loose in C:\Users\DGMic - 62 scratch files at the worst point.
# That is how a machine ends up with nineteen copies of a project and nobody able
# to say which one is real. If a script matters it belongs in version control; if
# it does not matter it should not exist.
#
# THE ONLY THINGS THAT LEGITIMATELY STAY ON C:
#   ~/.ssh                  ssh looks there and nowhere else
#   ~/.gitconfig            git looks there and nowhere else
#   ~/.gateflame-signing    the release keystore - IRREPLACEABLE, back it up
#   ~/.gradle, Android SDK  their tools hardcode those locations
# Those are home-directory by definition. Everything else moves.
# ========================================================================================

REPO_ROOT="${GATEFLAME_REPO:-/e/Gateflame}"

# Resolve the SSH agent.
#
# ~/.ssh/agent.sock may be a REGULAR FILE containing the socket path, or the
# SOCKET ITSELF, depending on how the agent was started. `cat` on the second
# fails with "Operation not supported", which looks exactly like a missing agent
# and is not. Handle both rather than guessing.
gf_agent() {
  local p="$HOME/.ssh/agent.sock"
  if [ -S "$p" ]; then
    export SSH_AUTH_SOCK="$p"
  elif [ -f "$p" ]; then
    export SSH_AUTH_SOCK="$(cat "$p" 2>/dev/null)"
  fi
  # NEVER set GIT_SSH_COMMAND here. The global core.sshCommand uses the 8.3 short
  # path C:/PROGRA~1/... deliberately, because any override containing a space
  # fails with "C:/Program: No such file or directory".
  unset GIT_SSH_COMMAND
  export GIT_TERMINAL_PROMPT=0
  ssh-add -l >/dev/null 2>&1
}

gf_require_agent() {
  gf_agent && return 0
  echo "SSH key is not loaded. Run tools\\load-key.cmd first." >&2
  return 1
}
