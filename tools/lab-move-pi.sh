#!/usr/bin/env bash
# Driver for lab-move-pi-remote.sh: scp it to the Pi, run with ONE sudo (Dennis types it), then read back from the laptop.
set -u
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
PI=192.168.124.3
O=(-o ConnectTimeout=6 -o HostKeyAlias=raspberrypi -o StrictHostKeyChecking=yes)
LOG=/e/Gateflame/tools/lab-move-pi.last.txt
if ! ssh-add -l >/dev/null 2>&1; then
  rm -f ~/.ssh/agent.sock; eval "$(ssh-agent -a ~/.ssh/agent.sock -s)" >/dev/null
  ssh-add ~/.ssh/id_ed25519 || exit 1
fi
scp "${O[@]}" -q /e/Gateflame/tools/lab-move-pi-remote.sh "wabapi@$PI:~/" || exit 1
ssh -t "${O[@]}" "wabapi@$PI" 'sudo bash ~/lab-move-pi-remote.sh "$SSH_CONNECTION" 2>&1 | tee ~/lab-move-pi.log'
scp "${O[@]}" -q "wabapi@$PI:~/lab-move-pi.log" "$LOG"
{
echo; echo "=== laptop read-back $(date -Is) ==="
for p in 22 53 8080 8081; do timeout 2 bash -c "</dev/tcp/$PI/$p" 2>/dev/null && echo "  $PI:$p OPEN" || echo "  $PI:$p closed"; done
echo "  status: $(curl -s -m 5 http://$PI:8080/api/v1/system/status | head -c 300)"
echo "  dns via Pi: $(nslookup -timeout=3 ionity.today $PI 2>&1 | grep -A2 -i 'name:' | tr '\n' ' ')"
echo "  household ping .0.11 (should fail): $(ping -n 1 -w 1000 192.168.0.11 | grep -c 'TTL=') replies"
echo "  household DNS still fine: $(nslookup -timeout=3 google.com 192.168.0.1 2>&1 | grep -c Address) address lines"
} | tee -a "$LOG"
