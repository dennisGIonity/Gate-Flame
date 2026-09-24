#!/usr/bin/env bash
# pi-reach.sh [host] — from Git-bash: is the key loaded, does sshd answer, and which
# MAC sits behind raspberrypi.local. Read-only; never changes anything on the box.
host="${1:-raspberrypi.local}"
echo "--- ssh-agent ---"; ssh-add -l 2>&1
echo "--- ssh $host ---"
ssh -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "wabapi@$host" \
  'hostname; hostname -I; systemctl is-active gateflame-node-agent.service; docker ps --format "{{.Names}} {{.Status}}"' 2>&1
echo "--- v6 neighbours matching the mDNS answer ---"
netsh interface ipv6 show neighbors 2>/dev/null | grep -i 8f32 || echo "(none)"
