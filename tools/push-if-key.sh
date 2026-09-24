#!/usr/bin/env bash
# push-if-key.sh — push HEAD only if the ssh-agent already holds a key, so it can
# never hang on a passphrase prompt. Never forces. Output -> tools/push-if-key.last.txt
cd /e/Gateflame || exit 1
exec > tools/push-if-key.last.txt 2>&1
if ! ssh-add -l >/dev/null 2>&1; then
  echo "NOT PUSHED: no key in ssh-agent. Run tools\\load-key.cmd, then re-run this."
  exit 2
fi
git push origin HEAD && echo "PUSHED" && git status -sb | head -1
