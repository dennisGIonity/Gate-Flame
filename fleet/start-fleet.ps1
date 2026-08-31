# Gate^Flame Fleet - start the dashboard on this machine.
#
# Binds 0.0.0.0 so the Pi (and any future box) can post health to it over the
# LAN. Secrets come from fleet.env.ps1, which is generated once and never
# committed. Refuses to start without them, by design.
#
# Just double-click this file, or:  powershell -NoProfile -File start-fleet.ps1

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$envFile = Join-Path $dir "fleet.env.ps1"
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: $envFile is missing - the server will refuse to start." -ForegroundColor Red
    Write-Host "Regenerate it with gf-scratch\fleet-init-secrets.ps1" -ForegroundColor Red
    exit 1
}
. $envFile

# WHICH ADDRESS DO NODES POST TO?
#
# This machine has more than one 192.168 address:
#
#   192.168.0.3      WiFi        <- the household LAN, where the boxes are
#   192.168.137.1    Ethernet    <- Windows Internet Connection Sharing
#
# The old "-First 1" happened to pick the right one, but the order is not
# guaranteed. Printing 192.168.137.1 would have told Dennis to configure nodes
# with an address they cannot reach - and the node's log for that is
# "health feed post failed, dropping: timed out", which reads like a firewall
# and cost an hour to chase once already.
#
# So: prefer an address on the same /24 as the nodes, and if the guess is
# ambiguous, SAY SO rather than printing one confident wrong answer.
$candidates = @(Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -like '192.168.*' -and
        $_.InterfaceAlias -notlike '*vEthernet*' -and
        $_.IPAddress -notlike '192.168.137.*'   # ICS, never the household LAN
    })

$nodeSubnet = '192.168.0.'
$preferred = $candidates | Where-Object { $_.IPAddress -like "$nodeSubnet*" } | Select-Object -First 1
$ip = if ($preferred) { $preferred.IPAddress } else { ($candidates | Select-Object -First 1).IPAddress }

if (-not $ip) {
    Write-Host "  WARNING: no LAN address found - nodes will not be able to reach this server." -ForegroundColor Yellow
    $ip = "127.0.0.1"
} elseif ($candidates.Count -gt 1 -and -not $preferred) {
    Write-Host "  WARNING: several LAN addresses and none on $nodeSubnet* - verify the URL below." -ForegroundColor Yellow
    $candidates | ForEach-Object { Write-Host ("           {0}  {1}" -f $_.IPAddress, $_.InterfaceAlias) -ForegroundColor Yellow }
}

# 8091, not 8090: a local dev copy of the node-agent already holds 8090 on this
# machine (`uvicorn gateflame.main:app --port 8090`, loopback-only). Picking a
# free port beats killing something that was already running.
$port = 8091

Write-Host ""
Write-Host "  Gate^Flame Fleet Dashboard" -ForegroundColor Cyan
Write-Host "  ------------------------------------------------"
Write-Host "  On this machine : http://127.0.0.1:$port/"
Write-Host "  From the LAN    : http://${ip}:$port/"
Write-Host "  Login           : $env:GATEFLAME_FLEET_ADMIN_USER / (see fleet.env.ps1)"
Write-Host "  Nodes post to   : http://${ip}:$port/api/v1/nodes/<nodeId>/health"
Write-Host "  ------------------------------------------------"
Write-Host "  Ctrl+C to stop."
Write-Host ""
Write-Host "  Keep this window open - closing it stops the dashboard, and the" -ForegroundColor DarkGray
Write-Host "  nodes then log 'timed out', which looks like a firewall problem." -ForegroundColor DarkGray
Write-Host ""

python -m uvicorn app:app --host 0.0.0.0 --port $port
