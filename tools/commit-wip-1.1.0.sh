#!/usr/bin/env bash
# Checkpoint commit of the 1.1.0 work in progress (node-agent WS1 + fleet WS2),
# so an interrupted session cannot lose it. Local commit only - no push.
set -euo pipefail
cd /e/Gateflame
git config user.name
git add docs/BUILD-1.1.0-PLAN.md node-agent fleet tools/install-pi-release.sh tools/package-release.sh \
        tools/install-fleet-autostart.ps1 tools/START-IONITY-SERVER.cmd tools/START-IONITY-SERVER.ps1 \
        tools/fleet-server-check.ps1 tools/commit-wip-1.1.0.sh
git status --short | grep -E '^(A|M|D) ' | head -80
git diff --cached --name-only | grep -Ei 'fleet\.db|fleet\.env\.ps1$|\.env$' && { echo "REFUSING: secret/db file staged"; exit 1; }
git commit -q -m "1.1.0 WIP checkpoint: node-agent lifespan, Pi-hole session+TTL cache, gravity completion by list date, pause-expiry re-apply, DNS + system history routes, portable installers, release read-back fixes; fleet login/prefix/Docker/Caddy, Ionity server start scripts"
git log --oneline -1
