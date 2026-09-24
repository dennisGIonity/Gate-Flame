#!/usr/bin/env bash
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
ssh -o BatchMode=yes -o HostKeyAlias=raspberrypi wabapi@192.168.124.3 'ls -la /tmp/gfstage 2>&1 | head; echo ---; tail -40 /tmp/gfstage/install.log 2>&1; cat /opt/gateflame/RELEASE 2>&1'
