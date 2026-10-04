#!/usr/bin/env bash
# lab-pi-eth0-only.sh - driver (Git-bash): stage the remote script, run it under ONE sudo (you type it),
# keep the log. Output -> tools/lab-pi-eth0-only.last.txt
set -u
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
PI=wabapi@192.168.124.3
O=(-o ConnectTimeout=6 -o HostKeyAlias=raspberrypi -o StrictHostKeyChecking=yes)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG=$ROOT/tools/lab-pi-eth0-only.last.txt
ssh-add -l >/dev/null 2>&1 || { rm -f ~/.ssh/agent.sock; eval "$(ssh-agent -a ~/.ssh/agent.sock -s)" >/dev/null; ssh-add ~/.ssh/id_ed25519 || exit 1; }
scp "${O[@]}" -q "$ROOT/tools/lab-pi-eth0-only-remote.sh" $PI:/tmp/lab-pi-eth0-only-remote.sh || exit 1
# $SSH_CONNECTION is read on the Pi BEFORE sudo strips it, and handed to the script as $1 (the guard).
ssh -t "${O[@]}" $PI 'sudo bash /tmp/lab-pi-eth0-only-remote.sh "$SSH_CONNECTION" 2>&1 | tee /tmp/lab-pi-eth0-only.log'
scp "${O[@]}" -q $PI:/tmp/lab-pi-eth0-only.log "$LOG" && echo "log -> $LOG"
