# Gate^Flame Fleet Dashboard - survive a reboot (BUG-06).
#
# docs/FUNCTION-STATUS-AND-BUGS.md, BUG-06: "Fleet server does not survive a
# reboot. Started by hand from start-fleet.ps1. If the workstation restarts or
# the terminal closes, every box keeps posting into nothing."
#
# This registers fleet\start-fleet.ps1 as a Windows Scheduled Task: hidden (no
# terminal to accidentally close), triggered at boot AND at logon, and
# restarted automatically up to 999 times if the process ever exits. It does
# not touch fleet.env.ps1 or the address problem (BUG-07, see the note this
# script prints at the end) - it only stops "someone closed a window" from
# being the failure mode.
#
# Run once, from an elevated PowerShell, on the machine that should host the
# dashboard:
#     powershell -ExecutionPolicy Bypass -File tools\install-fleet-autostart.ps1
#
# This changes local Task Scheduler state only - nothing on the LAN, nothing
# any other device sees, in line with CLAUDE.md's "never do" list.

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$fleetDir = Join-Path $repoRoot "fleet"
$script   = Join-Path $fleetDir "start-fleet.ps1"
$envFile  = Join-Path $fleetDir "fleet.env.ps1"

if (-not (Test-Path $script)) {
    Write-Host "ERROR: $script not found - run this from the repo (E:\Gateflame), not a copy." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: $envFile is missing." -ForegroundColor Red
    Write-Host "       start-fleet.ps1 refuses to start without it - a scheduled task with no" -ForegroundColor Red
    Write-Host "       secrets file just fails silently on every single boot. Generate it first" -ForegroundColor Red
    Write-Host "       (gf-scratch\fleet-init-secrets.ps1), then re-run this script." -ForegroundColor Red
    exit 1
}

$taskName = "GateFlameFleetDashboard"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" `
    -WorkingDirectory $fleetDir

# Two triggers on purpose: AtStartup brings it back with nobody signed in yet
# (a power-cut reboot); AtLogOn covers the case Task Scheduler runs the
# startup trigger before Dennis's profile is loaded.
$trigger1 = New-ScheduledTaskTrigger -AtStartup
$trigger2 = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger1, $trigger2 `
    -Settings $settings -Principal $principal -Force | Out-Null

Write-Host ""
Write-Host "  Registered scheduled task '$taskName'." -ForegroundColor Cyan
Write-Host "  Runs fleet\start-fleet.ps1 hidden, at boot and at logon; restarts it up to 999" -ForegroundColor Cyan
Write-Host "  times (1-minute backoff) if the process ever exits." -ForegroundColor Cyan
Write-Host ""
Write-Host "  NOT proven yet - only staged. This closes BUG-06 once, and only once, you:" -ForegroundColor Yellow
Write-Host "    1. Reboot this machine." -ForegroundColor Yellow
Write-Host "    2. Wait ~30s, then from another LAN device:  curl http://<this-IP>:8091/healthz" -ForegroundColor Yellow
Write-Host "    3. See it answer with nobody having opened a terminal." -ForegroundColor Yellow
Write-Host ""
Write-Host "  BUG-07 (the address keeps moving - .7 -> .6 -> .3) is NOT fixed by this script." -ForegroundColor Yellow
Write-Host "  That needs one of, both outside what a repo script can do safely unattended:" -ForegroundColor Yellow
Write-Host "    - a DHCP reservation for this machine on the TP-Link EX511 (a couple of" -ForegroundColor Yellow
Write-Host "      minutes in the router's own admin UI - your call, your router)." -ForegroundColor Yellow
Write-Host "    - or moving the dashboard off this workstation onto something with a fixed" -ForegroundColor Yellow
Write-Host "      address - fleet\deploy\gateflame-fleet.service is already written for that." -ForegroundColor Yellow
Write-Host ""
Write-Host "  To remove:  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor DarkGray
