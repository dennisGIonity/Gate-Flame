#!/usr/bin/env bash
# lab-pi-uplink.sh - read-only: does the lab (H3C) give the Pi internet? why does unbound SERVFAIL?
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
out=/e/Gateflame/tools/lab-pi-uplink.last.txt
ssh -o BatchMode=yes -o ConnectTimeout=5 -o HostKeyAlias=raspberrypi wabapi@192.168.124.3 '
date -Is
ip -4 route
echo "--- ping 1.1.1.1 / 8.8.8.8 ---"; ping -c2 -W2 1.1.1.1 | tail -2; ping -c2 -W2 8.8.8.8 | tail -2
echo "--- raw UDP 53 to 1.1.1.1 (bypasses unbound) ---"; timeout 4 dig +short +time=2 @1.1.1.1 google.com 2>&1 || timeout 4 nslookup google.com 1.1.1.1 2>&1 | tail -3
echo "--- via H3C resolver ---"; timeout 4 dig +short +time=2 @192.168.124.1 google.com 2>&1
echo "--- unbound direct + cd (no dnssec) ---"; timeout 6 dig +short +time=3 -p 53 @127.0.0.1 google.com 2>&1; timeout 6 dig +cd +short +time=3 @127.0.0.1 google.com 2>&1
echo "--- unbound log ---"; docker logs --tail 15 gateflame-unbound 2>&1
echo "--- https reachability ---"; curl -sI -m 5 https://1.1.1.1 | head -1
'> "$out" 2>&1
cat "$out"
