#!/bin/bash
set -e
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
PI=wabapi@192.168.0.10

echo "=== staging the rebuilt kiosk bundle ==="
ssh $PI 'rm -rf ~/kiosk-staging && mkdir -p ~/kiosk-staging'
scp -q -r /e/Gateflame/dist-kiosk/. $PI:~/kiosk-staging/

echo "=== verifying the staged bundle carries the Shield panel ==="
ssh $PI 'grep -l "Not set up on this box yet" ~/kiosk-staging/assets/kiosk.*.js >/dev/null && echo "  Shield present" || { echo "  SHIELD MISSING - refusing"; exit 1; }'

echo "=== installing (kiosk only; the agent is already current) ==="
ssh $PI 'sudo bash -c "
set -e
STAMP=\$(date +%Y%m%d-%H%M%S)
cp -a /opt/gateflame/kiosk /opt/gateflame/kiosk.backup-\$STAMP
rm -rf /opt/gateflame/kiosk/*
cp -a ~wabapi/kiosk-staging/. /opt/gateflame/kiosk/
chown -R root:root /opt/gateflame/kiosk
chmod -R a+rX /opt/gateflame/kiosk
grep -q \"Not set up on this box yet\" /opt/gateflame/kiosk/assets/kiosk.*.js || {
  rm -rf /opt/gateflame/kiosk/*
  cp -a /opt/gateflame/kiosk.backup-\$STAMP/. /opt/gateflame/kiosk/
  echo \"  read-back FAILED - rolled back\"; exit 1; }
echo \"  installed and confirmed by re-read; backup at /opt/gateflame/kiosk.backup-\$STAMP\"
systemctl restart gateflame-kiosk.service
sleep 2
echo \"  kiosk: \$(systemctl is-active gateflame-kiosk.service)\"
"'
