# Gate^Flame T1 server - survive a reboot (same reason as the fleet's BUG-06).
#
# T1 boards report to the T1 server on :8095. If this workstation restarts and the terminal
# is gone, every T1 box keeps filtering (it does not need the server) but stops reporting,
# stops getting filter updates, and its OTA rollout stalls. The task runs
# t1\scripts\start-server.ps1 hidden at boot and at logon and is restarted if it exits.
#
# Run once, from PowerShell (no elevation needed - it registers a task for YOU, run level Limited):
#     powershell -ExecutionPolicy Bypass -File tools\install-t1-autostart.ps1
#
# Local Task Scheduler state only. Nothing on the LAN changes. Remove with:
#     Unregister-ScheduledTask -TaskName 'GateFlameT1Server' -Confirm:$false
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$script   = Join-Path $repoRoot "t1\scripts\start-server.ps1"
$venvPy   = Join-Path $repoRoot "t1\server\.venv\Scripts\python.exe"
if (-not (Test-Path $script)) { Write-Host "ERROR: $script not found - run this from E:\Gateflame." -ForegroundColor Red; exit 1 }
if (-not (Test-Path $venvPy)) { Write-Host "ERROR: t1\server\.venv missing - run tools\T1-SERVER.cmd once first (it builds the venv and the filters)." -ForegroundColor Red; exit 1 }

$taskName = "GateFlameT1Server"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" `
    -WorkingDirectory (Join-Path $repoRoot "t1\server")
$triggers = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -AtLogOn))
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null

Write-Host ""
Write-Host "  Registered scheduled task '$taskName' (T1 server :8095 at boot and at logon)." -ForegroundColor Cyan
Write-Host "  NOT proven until you reboot and, from another LAN device, see:" -ForegroundColor Yellow
Write-Host "      curl http://<this-lab-IP>:8095/api/t1/v1/health    ->   {""ok"":true,""service"":""gateflame-t1"",...}" -ForegroundColor Yellow
Write-Host "  The firewall rule for TCP 8095 is separate (start-server.ps1 prints the one admin command)." -ForegroundColor Yellow
