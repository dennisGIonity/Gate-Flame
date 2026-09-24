#!/usr/bin/env bash
# precheck-release.sh - read-only: will the release install need pip (internet)? bash -n on the installers.
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
C=/e/Gateflame
{
for f in $C/tools/install-pi-release.sh $C/tools/stage-pi-release.sh; do bash -n $f && echo "syntax ok $(basename $f)"; done
echo "repo reqs md5  $(tr -d '\r' < $C/node-agent/requirements.txt | md5sum)"
ssh -o BatchMode=yes -o HostKeyAlias=raspberrypi wabapi@192.168.124.3 'echo "pi   reqs md5  $(tr -d "\r" < /opt/gateflame/node-agent/requirements.txt | md5sum)"; cat /opt/gateflame/node-agent/requirements.txt; cat /etc/systemd/system/gateflame-node-agent.service.d/50-feed.conf 2>&1 | sed "s/TOKEN=.*/TOKEN=<redacted>/"'
echo "--- repo reqs ---"; cat $C/node-agent/requirements.txt
file $C/node-agent/requirements.txt
} 2>&1 | tee $C/tools/precheck-release.last.txt
