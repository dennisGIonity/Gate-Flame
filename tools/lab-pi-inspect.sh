#!/usr/bin/env bash
# lab-pi-inspect.sh - read-only: open-webui wiring, agent env location, clock, agent failure reason.
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
out=/e/Gateflame/tools/lab-pi-inspect.last.txt
ssh -o BatchMode=yes -o ConnectTimeout=5 -o HostKeyAlias=raspberrypi wabapi@192.168.124.3 '
echo "--- open-webui (no env values) ---"
docker inspect -f "net={{.HostConfig.NetworkMode}} ports={{json .HostConfig.PortBindings}} mounts={{range .Mounts}}{{.Type}}:{{.Name}}{{.Source}}->{{.Destination}} {{end}}" open-webui
docker inspect -f "{{range .Config.Env}}{{println .}}{{end}}" open-webui | cut -d= -f1 | tr "\n" " "; echo
docker inspect -f "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}" open-webui
echo "--- agent unit ---"
systemctl cat gateflame-node-agent.service 2>&1 | grep -E "^(ExecStart|Environment|EnvironmentFile|WorkingDirectory)"
journalctl -u gateflame-node-agent -n 12 --no-pager 2>&1 | tail -12
echo "--- watchdog ---"; journalctl -u gateflame-dns-watchdog -n 8 --no-pager 2>&1 | tail -8
echo "--- pihole why not running ---"; docker logs --tail 5 gateflame-pihole 2>&1; docker inspect -f "{{.State.Error}}" gateflame-pihole
echo "--- clock ---"; date -Is; timedatectl 2>&1 | grep -E "synchron|NTP"
echo "--- resolv ---"; cat /etc/resolv.conf | grep -v "^#"
echo "--- feed url refs ---"; grep -rs "FEED_URL" /etc/gateflame /etc/default 2>/dev/null | sed "s/TOKEN=.*/TOKEN=<redacted>/"; ls -la /etc/gateflame 2>&1 | head
' > "$out" 2>&1
cat "$out"
