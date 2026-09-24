#!/usr/bin/env bash
# 1) preserve the one commit that exists only in C:\Users\DGMic\TempGateFlameBuild as a pushed archive branch (no force)
# 2) read-only lab uplink check from the Pi
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
C=/e/Gateflame; cd $C
out=$C/tools/preserve-and-labcheck.last.txt
{
B=archive/temp-build-scratch-2026-08-13
git fetch -q /c/Users/DGMic/TempGateFlameBuild "$B:$B" && echo "fetched $B -> $(git rev-parse --short $B)"
git push origin "$B" 2>&1 | tail -2
git ls-remote origin "refs/heads/$B"
echo "--- Pi uplink ---"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o HostKeyAlias=raspberrypi wabapi@192.168.124.3 '
date -Is; timedatectl | grep synchron
ping -c2 -W2 1.1.1.1 | tail -1
python3 - <<EOF
import socket,struct,random
def q(server,name):
    s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(3)
    tid=random.randint(0,65535)
    pkt=struct.pack(">HHHHHH",tid,0x0100,1,0,0,0)+b"".join(bytes([len(p)])+p.encode() for p in name.split("."))+b"\0"+struct.pack(">HH",1,1)
    try:
        s.sendto(pkt,(server,53)); d=s.recv(512); return "rcode=%d answers=%d"%(d[3]&15, struct.unpack(">H",d[6:8])[0])
    except Exception as e: return "ERR %s"%e
for srv in ["127.0.0.1","192.168.124.1","1.1.1.1"]:
    print("dns", srv, q(srv,"google.com"))
EOF'
} > "$out" 2>&1
cat "$out"
