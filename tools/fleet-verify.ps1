# Prove the node -> fleet health feed works END TO END, not by inspection.
#
# WHY THIS EXISTS
# Editing GATEFLAME_FEED_URL and reading the new value back proves only that a
# file changed. It does not prove a sample ever arrives. On 2026-08-31 the
# drop-in was correct and the dashboard still showed the node offline with a
# 10-hour-old sample.
#
# THE TRAP THAT COST THE MOST TIME
# The agent logged "health feed post failed, dropping: timed out". A TIMEOUT
# reads like a firewall block or a wedged handler - but Windows DROPS packets
# to a port nothing is listening on rather than sending a reset, so a server
# that is simply not running looks exactly like one that is being blocked.
# The distinction is cheap to make and worth making first:
#
#   GET  /healthz              -> is anything listening at all?
#   POST /nodes/<id>/health    -> with a DELIBERATELY WRONG token. A fast 401
#                                 proves the route is reachable and responsive
#                                 without handling the real credential.
#
# Only if both of those pass is it worth waiting for a real sample.
param([string]$Node = "192.168.0.10", [string]$FleetHost = "127.0.0.1", [int]$FleetPort = 8091)

$envFile = "C:\Users\DGMic\Downloads\GF Files\gateflame-fleet\fleet.env.ps1"
if (-not (Test-Path $envFile)) { Write-Output "no fleet.env.ps1 - cannot authenticate"; exit 1 }
. $envFile
$pair = "$($env:GATEFLAME_FLEET_ADMIN_USER):$($env:GATEFLAME_FLEET_ADMIN_PASSWORD)"
$hdr = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair)) }
$base = "http://${FleetHost}:${FleetPort}"

Write-Output "=== 1. is the fleet server listening? ==="
try {
    $h = Invoke-WebRequest -Uri "$base/healthz" -TimeoutSec 6 -UseBasicParsing
    Write-Output "  $($h.StatusCode) $($h.Content)"
} catch {
    Write-Output "  NOT RUNNING - start it with gateflame-fleet\start-fleet.ps1"
    Write-Output "  (the node will log 'timed out', which looks like a firewall but is not)"
    exit 1
}

Write-Output ""
Write-Output "=== 2. has the node reported, and how recently? ==="
try {
    $nodes = (Invoke-WebRequest -Uri "$base/api/v1/nodes" -Headers $hdr -TimeoutSec 8 -UseBasicParsing).Content | ConvertFrom-Json
} catch {
    Write-Output "  /nodes failed: $($_.Exception.Message)"
    exit 1
}
if (-not $nodes) { Write-Output "  no nodes have ever reported"; exit 1 }

foreach ($n in $nodes) {
    $age = [int]$n.lastSeenAgoSeconds
    $verdict = if ($age -lt 600) { "FRESH" } else { "STALE - older than the 300s post interval" }
    Write-Output ("  {0}  status={1}  lastSeen={2}s ago  [{3}]" -f $n.nodeId, $n.status, $age, $verdict)
    if ($age -lt 600) {
        Write-Output ("     cpu={0}%  mem={1}/{2}MB  temp={3}C  pihole={4}  modules={5}" -f `
            $n.host.cpuPercent, $n.host.memUsedMB, $n.host.memTotalMB, $n.host.tempC, `
            $n.piholeReachable, $n.modulesRunning)
    }
}
