#!/usr/bin/env bash
# lab-pi-dualhome.sh - read-only: why is the Pi back on household Wi-Fi, which address does the
# DNS stack bind, what did the watchdog do, and does the lab give the Pi internet. No sudo.
# Output -> tools/lab-pi-dualhome.last.txt
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
out=/e/Gateflame/tools/lab-pi-dualhome.last.txt
{
echo "=== lab-pi-dualhome $(date -Is) ==="
ssh -o BatchMode=yes -o ConnectTimeout=6 -o HostKeyAlias=raspberrypi -o StrictHostKeyChecking=yes wabapi@192.168.124.3 '
echo "--- clock / uptime ---"; date -Is; uptime -s; timedatectl 2>&1 | grep -E "synchron|NTP service"
echo "--- release on box ---"; cat /opt/gateflame/RELEASE 2>/dev/null || echo "(no /opt/gateflame/RELEASE)"
echo "--- agent version drop-in (names only) ---"; ls /etc/systemd/system/gateflame-node-agent.service.d/ 2>&1; grep -hs GATEFLAME_VERSION /etc/systemd/system/gateflame-node-agent.service.d/*.conf
echo "--- wlan0 autoconnect history (NetworkManager) ---"; journalctl -u NetworkManager --no-pager -o short-iso 2>/dev/null | grep -iE "autoconnect|Afrihost|activated|connection .wired" | tail -12
echo "--- when did wlan0 come back ---"; nmcli -t -f NAME,TIMESTAMP-REAL,AUTOCONNECT con show 2>&1 | head -6
echo "--- dns-stack .env (mtime only; values are root 0600) ---"; stat -c "%y %n" /home/wabapi/node-agent/dns-stack/.env* 2>&1; stat -c "%y %n" /opt/gateflame/dns-stack/.env* 2>&1
echo "--- which dns-stack is live ---"; docker inspect -f "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}" gateflame-pihole 2>&1
echo "--- watchdog journal, last 2h ---"; journalctl -u gateflame-dns-watchdog --no-pager -o short-iso --since "-2h" 2>&1 | tail -40
echo "--- watchdog state files ---"; ls -la /var/lib/gateflame/ 2>&1 | head -20
echo "--- bypass flag? ---"; ls -la /var/lib/gateflame/bypass 2>&1
echo "--- internet via each path ---"
ping -c1 -W2 -I eth0 1.1.1.1 2>&1 | tail -1
ping -c1 -W2 -I wlan0 1.1.1.1 2>&1 | tail -1
echo "--- resolver the Pi itself uses ---"; grep -v "^#" /etc/resolv.conf
echo "--- H3C resolves? ---"; timeout 4 dig +short +time=2 @192.168.124.1 google.com 2>&1 | head -2
echo "--- unbound direct ---"; timeout 6 dig +short +time=3 @127.0.0.1 google.com 2>&1 | head -2; timeout 6 dig +short +time=3 @127.0.0.1 doubleclick.net 2>&1 | head -2
echo "--- unbound log tail ---"; docker logs --tail 8 gateflame-unbound 2>&1
echo "--- agent feed state (unauthenticated LAN route) ---"; curl -s -m 4 http://127.0.0.1:8080/api/v1/system/feed; echo
echo "--- agent filtering (loopback = kiosk scope) ---"; curl -s -m 6 http://127.0.0.1:8080/api/v1/filtering | head -c 600; echo
echo "--- jobs.env / feed url (token redacted) ---"; grep -hs "FEED_URL" /etc/gateflame/*.env /etc/systemd/system/gateflame-node-agent.service.d/*.conf 2>/dev/null | sed "s/TOKEN=.*/TOKEN=<redacted>/" | sort -u
'
echo "ssh exit=$?"
} > "$out" 2>&1
cat "$out"
