#!/usr/bin/env bash
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
scp -q -o BatchMode=yes -o HostKeyAlias=raspberrypi wabapi@192.168.124.3:/tmp/gfstage/install.log /e/Gateflame/tools/stage-pi-release.last.txt
cat /e/Gateflame/tools/stage-pi-release.last.txt
