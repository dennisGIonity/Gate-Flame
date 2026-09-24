#!/usr/bin/env bash
# gf-querylog.sh [minutes] [client-filter] - what Gate^Flame (Pi-hole FTL) actually logged. Read-only.
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
MIN="${1:-30}"; CLIENT="${2:-}"
ssh -o BatchMode=yes -o ConnectTimeout=6 -o HostKeyAlias=raspberrypi wabapi@192.168.124.3 "MIN=$MIN CLIENT='$CLIENT' bash -s" <<'REMOTE'
cat > /tmp/gfq.sql <<SQL
.headers on
.mode column
SELECT datetime(timestamp,'unixepoch','localtime') AS at, client, domain,
  CASE status WHEN 1 THEN 'BLOCKED(gravity)' WHEN 4 THEN 'BLOCKED(regex)' WHEN 5 THEN 'BLOCKED(exact)'
              WHEN 9 THEN 'BLOCKED(gravity-cname)' WHEN 2 THEN 'forwarded' WHEN 3 THEN 'cache'
              WHEN 14 THEN 'already-forwarded' WHEN 17 THEN 'cache-stale' ELSE 'status'||status END AS verdict
FROM queries
WHERE timestamp > strftime('%s','now') - ${MIN}*60 ${CLIENT:+AND client LIKE '%${CLIENT}%'}
ORDER BY id DESC LIMIT 60;
SELECT client, count(*) AS queries, sum(status IN (1,4,5,9,10,11)) AS blocked
FROM queries WHERE timestamp > strftime('%s','now') - ${MIN}*60 GROUP BY client ORDER BY queries DESC;
SQL
docker cp /tmp/gfq.sql gateflame-pihole:/tmp/gfq.sql >/dev/null
docker exec gateflame-pihole pihole-FTL sqlite3 /etc/pihole/pihole-FTL.db ".read /tmp/gfq.sql"
REMOTE
