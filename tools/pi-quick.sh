#!/usr/bin/env bash
# pi-quick.sh - read-only post-deploy look: DNS on both listeners, automation log, Pi-hole recent queries.
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
ssh -o BatchMode=yes -o ConnectTimeout=6 -o HostKeyAlias=raspberrypi wabapi@192.168.124.3 '
date -Is; cat /opt/gateflame/RELEASE 2>/dev/null
for s in 127.0.0.1 192.168.124.3; do python3 - $s <<EOF
import socket,struct,sys
for n in ("doubleclick.net","ionity.today"):
    q=struct.pack(">HHHHHH",9,0x0100,1,0,0,0)+b"".join(bytes([len(p)])+p.encode() for p in n.split("."))+b"\0"+struct.pack(">HH",1,1)
    s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(4)
    try:
        s.sendto(q,(sys.argv[1],53)); d=s.recv(512); print(sys.argv[1], n, "rcode", d[3]&15, "an", d[7], d[-4:] if d[7] else b"")
    except Exception as e: print(sys.argv[1], n, "ERR", e)
EOF
done
echo "--- automation log ---"; tail -15 /tmp/gf-automation.log 2>&1
echo "--- pihole last 15 queries ---"
docker exec gateflame-pihole pihole-FTL sqlite3 /etc/pihole/pihole-FTL.db "select datetime(timestamp,\"unixepoch\",\"localtime\"),client,domain,status from queries order by id desc limit 15;" 2>&1
'
