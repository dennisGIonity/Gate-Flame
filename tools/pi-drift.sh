#!/usr/bin/env bash
# pi-drift.sh - read-only: what is deployed on the Pi vs what is in E:\Gateflame (md5 per file).
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
C=/e/Gateflame; PI=wabapi@192.168.124.3
O=(-o BatchMode=yes -o ConnectTimeout=6 -o HostKeyAlias=raspberrypi)
out=$C/tools/pi-drift.last.txt
{
echo "=== pi-drift $(date -Is) repo $(git -C $C rev-parse --short HEAD) ==="
ssh "${O[@]}" $PI '
echo "--- /usr/local/bin gateflame* ---"; ls -la /usr/local/bin | grep -i gateflame
echo "--- /opt/gateflame ---"; ls -la /opt/gateflame; ls /opt/gateflame/node-agent
echo "--- units ---"; ls /etc/systemd/system | grep -i gateflame; ls /etc/systemd/system/gateflame-node-agent.service.d 2>/dev/null
echo "--- md5 agent package ---"; cd /opt/gateflame/node-agent && find gateflame -name "*.py" -exec md5sum {} + | sort -k2
echo "--- md5 scripts ---"; md5sum /usr/local/bin/gateflame-* 2>/dev/null
md5sum /home/wabapi/node-agent/dns-stack/docker-compose.yml /home/wabapi/node-agent/dns-stack/docker-compose.bypass.yml /home/wabapi/node-agent/*.sh 2>/dev/null
echo "--- kiosk index ---"; grep -o "assets/[A-Za-z0-9._-]*\.js" /opt/gateflame/kiosk/index.html | head -3
echo "--- pip ---"; /opt/gateflame/node-agent/venv/bin/pip freeze 2>/dev/null | head -40
echo "--- python ---"; /opt/gateflame/node-agent/venv/bin/python -V
' > /tmp/pi-md5.txt 2>&1
cat /tmp/pi-md5.txt | grep -v '^[0-9a-f]\{32\}  gateflame/'
echo "--- agent package drift (repo vs pi) ---"
(cd $C/node-agent && find gateflame -name '*.py' -not -path '*__pycache__*' -exec md5sum {} + | sort -k2) > /tmp/repo-md5.txt
grep '^[0-9a-f]\{32\}  gateflame/' /tmp/pi-md5.txt | sort -k2 > /tmp/pi-pkg.txt
join -1 2 -2 2 -a1 -a2 -e MISSING -o 0,1.1,2.1 /tmp/repo-md5.txt /tmp/pi-pkg.txt | awk '$2!=$3{print "  DIFF", $1, ($2=="MISSING"?"(only on pi)":($3=="MISSING"?"(not on pi)":""))}'
echo "--- script drift ---"
for f in dns-watchdog.sh gateflame-netcheck.sh gateflame-env-set.sh gateflame-memcheck.sh gateflame-ra-advertiser.sh; do echo "  repo $(md5sum < $C/node-agent/$f | cut -c1-32) $f"; done
for f in docker-compose.yml docker-compose.bypass.yml; do echo "  repo $(md5sum < $C/node-agent/dns-stack/$f | cut -c1-32) dns-stack/$f"; done
echo "--- repo kiosk ---"; grep -o 'assets/[A-Za-z0-9._-]*\.js' $C/dist-kiosk/index.html | head -3
} > "$out" 2>&1
cat "$out"
