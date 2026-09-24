#!/usr/bin/env bash
# lab-pi-status.sh - read-only look at the Pi on the lab (no sudo, no prompts).
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
out=/e/Gateflame/tools/lab-pi-status.last.txt
{
echo "=== $(date -Is) ==="
ssh-add -l 2>&1 | head -2
ssh -o BatchMode=yes -o ConnectTimeout=5 -o HostKeyAlias=raspberrypi -o StrictHostKeyChecking=yes wabapi@192.168.124.3 '
echo "--- ip ---"; ip -4 -o addr show | awk "{print \$2, \$4}"; ip -4 route | head -5
echo "--- nmcli ---"; nmcli -t -f NAME,DEVICE,TYPE,AUTOCONNECT con show 2>&1
echo "--- pause state ---"; ls -la /var/lib/ionity-lab/ 2>&1; cat /var/lib/ionity-lab/gateflame-paused.state 2>&1
echo "--- units ---"; for u in $(systemctl list-unit-files "gateflame*" --no-legend | awk "{print \$1}"); do echo "$u $(systemctl is-enabled $u) $(systemctl is-active $u)"; done
echo "--- containers ---"; docker ps -a --format "{{.Names}} | {{.Status}} | {{.Ports}}"
echo "--- :8080 / :53 listeners ---"; ss -ltnu | grep -E ":(8080|53|8081|3000) "
echo "--- env LAN IP ---"; ls -la /home/wabapi/node-agent/dns-stack/ 2>&1 | head; grep -h "^GATEFLAME_LAN_IP" /home/wabapi/node-agent/dns-stack/.env 2>&1
echo "--- open-webui origin ---"; systemctl list-units --no-legend "*webui*" "*open*" 2>/dev/null; docker inspect -f "{{.Name}} {{.HostConfig.RestartPolicy.Name}} {{.Config.Image}}" $(docker ps -aq) 2>/dev/null
echo "--- pihole dhcp ---"; docker exec gateflame-pihole pihole-FTL --config dhcp.active 2>&1 | head -2
'
echo "ssh exit=$?"
} > "$out" 2>&1
cat "$out"
