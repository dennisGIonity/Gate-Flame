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

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -like '192.168.*' -and $_.InterfaceAlias -notlike '*vEthernet*' } |
       Select-Object -First 1).IPAddress

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

python -m uvicorn app:app --host 0.0.0.0 --port $port
