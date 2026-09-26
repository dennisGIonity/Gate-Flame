# ========================================================================================
# GATE^FLAME - START THE IONITY OFFLINE SERVER (fleet dashboard + Ionity Local Drive)
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# 1. Gate^Flame fleet dashboard (fleet\app.py) on 0.0.0.0:8091, from fleet\.venv
#    (created on first run), secrets from fleet\fleet.env.ps1 (never printed).
# 2. Ionity Local Drive, whose /gateflame/ bridge fronts the fleet on :443 / :8080.
# 3. Prints every address, and the GATEFLAME_FEED_URL to put on boxes.
#
# Idempotent: anything already running is left alone and reported.
#   -Hidden   start both without visible windows (autostart)
#   -Watch    stay running and restart either one if it exits (autostart uses this)
#
# Needs no elevation. Firewall and autostart are separate, elevated steps
# (tools\install-fleet-autostart.ps1) that Dennis runs himself.
param(
    [switch]$Hidden,
    [switch]$Watch,
    [string]$LocalDriveExe = $(if ($env:IONITY_LOCAL_DRIVE_EXE) { $env:IONITY_LOCAL_DRIVE_EXE } else {
        "C:\Users\DGMic\ionity-local-drive\src\IonityLocalDrive\bin\Release\net10.0\win-x64\IonityLocalDrive.exe" }),
    [int]$FleetPort = 8091
)
# Continue, not Stop: in Windows PowerShell 5.1 a native command writing to
# stderr under Stop throws, even with 2>$null. Failures are checked explicitly.
$ErrorActionPreference = "Continue"
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$fleet = Join-Path $repo "fleet"
$log = Join-Path $PSScriptRoot "start-ionity-server.last.txt"
"START-IONITY-SERVER $(Get-Date -Format s)" | Set-Content $log -Encoding utf8
function Say([string]$m, [string]$c = "Gray") { Write-Host $m -ForegroundColor $c; Add-Content $log $m -Encoding utf8 }

# ------------------------------------------------------------------ secrets
$envFile = Join-Path $fleet "fleet.env.ps1"
if (-not (Test-Path $envFile)) {
    Say "ERROR: $envFile is missing. Copy fleet\fleet.env.ps1.example to it and fill it in." Red
    exit 1
}
. $envFile
foreach ($v in "GATEFLAME_FLEET_TOKEN", "GATEFLAME_FLEET_ADMIN_PASSWORD") {
    if (-not [Environment]::GetEnvironmentVariable($v)) { Say "ERROR: $v is empty in fleet.env.ps1 - the fleet refuses to start without it." Red; exit 1 }
}

# ------------------------------------------------------------------ venv
function Find-BasePython {
    foreach ($c in @("C:\Python314\python.exe", "C:\Python313\python.exe", "C:\Python312\python.exe")) { if (Test-Path $c) { return $c } }
    $p = Get-Command python -ErrorAction SilentlyContinue
    if ($p) { return $p.Source }
    return $null
}
function Test-FleetPython([string]$py) {
    if (-not $py -or -not (Test-Path $py)) { return $false }
    & $py -c "import fastapi, uvicorn, pydantic_core" 2>$null
    return ($LASTEXITCODE -eq 0)
}
$venvPy = Join-Path $fleet ".venv\Scripts\python.exe"
if (-not (Test-FleetPython $venvPy)) {
    $base = Find-BasePython
    if (-not $base) { Say "ERROR: no Python found (looked for C:\Python314, C:\Python313, C:\Python312, PATH)." Red; exit 1 }
    Say "Creating fleet\.venv from $base ..." Cyan
    & $base -m venv (Join-Path $fleet ".venv")
    & $venvPy -m pip install --disable-pip-version-check -q -r (Join-Path $fleet "requirements.txt") 2>&1 | ForEach-Object { Add-Content $log $_ }
}
$py = $venvPy
if (-not (Test-FleetPython $py)) {
    # Smart App Control blocks unsigned compiled extensions on this PC. If the
    # venv's copy is refused, the system interpreter's (already allowed) copy is
    # the honest fallback - said out loud, not silently.
    $base = Find-BasePython
    if (Test-FleetPython $base) { Say "WARNING: fleet\.venv cannot import its packages; using $base instead." Yellow; $py = $base }
    else { Say "ERROR: neither fleet\.venv nor $base can import fastapi/uvicorn. See $log." Red; exit 1 }
}

# ------------------------------------------------------------------ helpers
function Get-Listener([int]$port) {
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
}
function Wait-Http([string]$url, [int]$seconds = 25) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3; return [int]$r.StatusCode }
        catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } }
        Start-Sleep -Milliseconds 700
    }
    return 0
}
$win = if ($Hidden) { "Hidden" } else { "Minimized" }

function Start-Fleet {
    $l = Get-Listener $FleetPort
    if ($l) { Say "Fleet already listening on :$FleetPort (PID $($l.OwningProcess))." Green; return $l.OwningProcess }
    $p = Start-Process -FilePath $py -WorkingDirectory $fleet -WindowStyle Hidden -PassThru `
        -ArgumentList "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "$FleetPort", "--no-proxy-headers", "--no-server-header" `
        -RedirectStandardOutput (Join-Path $fleet "fleet.log") -RedirectStandardError (Join-Path $fleet "fleet.err.log")
    $code = Wait-Http "http://127.0.0.1:$FleetPort/healthz"
    if ($code -ne 200) { Say "ERROR: fleet did not answer /healthz (got $code). Last lines of fleet\fleet.err.log:" Red
        Get-Content (Join-Path $fleet "fleet.err.log") -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Say "   $_" Red }
        return $null }
    Say "Fleet started (PID $($p.Id)), /healthz 200." Green
    return $p.Id
}

function Start-LocalDrive {
    $running = Get-Process -Name IonityLocalDrive -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($running) { Say "Ionity Local Drive already running (PID $($running.Id))." Green; return $running.Id }
    if (-not (Test-Path $LocalDriveExe)) { Say "ERROR: Ionity Local Drive not found at $LocalDriveExe (set IONITY_LOCAL_DRIVE_EXE)." Red; return $null }
    $p = Start-Process -FilePath $LocalDriveExe -WorkingDirectory (Split-Path $LocalDriveExe) -WindowStyle $win -PassThru
    Start-Sleep -Seconds 4
    if ($p.HasExited) {
        # Seen 2026-09-26: Smart App Control refuses a freshly built, unsigned
        # IonityLocalDrive.dll ("An Application Control policy has blocked this
        # file"). Say which, rather than reporting a start that did not happen.
        $blocked = Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 50 -ErrorAction SilentlyContinue |
            Where-Object { $_.Id -eq 3077 -and $_.TimeCreated -gt (Get-Date).AddMinutes(-2) -and $_.Message -match 'IonityLocalDrive' }
        if ($blocked) { Say "ERROR: Windows Smart App Control blocked the Ionity Local Drive build (unsigned). The /gateflame bridge cannot run on this PC until the build is signed or SAC is turned off - Dennis's call. The fleet itself still runs on :$FleetPort." Red }
        else { Say "ERROR: Ionity Local Drive exited immediately (code $($p.ExitCode)). Run it by hand to see why: $LocalDriveExe" Red }
        return $null
    }
    Say "Ionity Local Drive started (PID $($p.Id))." Green
    return $p.Id
}

$fleetPid = Start-Fleet
$drivePid = Start-LocalDrive

# Which HTTP port did the Local Drive get? (80 is often held by Windows http.sys)
$httpPort = $null
foreach ($port in 80, 8080, 9080) {
    $c = Wait-Http "http://127.0.0.1:$port/gateflame/healthz" 12
    if ($c -eq 200) { $httpPort = $port; break }
}
$httpsOk = (Get-Listener 443) -ne $null

# ------------------------------------------------------------------ addresses
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -like '192.168.*' -and $_.IPAddress -notlike '192.168.137.*' -and $_.InterfaceAlias -notlike '*vEthernet*' } |
    Select-Object -ExpandProperty IPAddress)
$hp = if ($httpPort -eq 80) { "" } elseif ($httpPort) { ":$httpPort" } else { ":?" }

Say ""
Say "  Ionity offline server - Gate^Flame fleet" Cyan
Say "  ------------------------------------------------------------------"
Say "  Fleet PID          : $(if ($fleetPid) { $fleetPid } else { 'NOT RUNNING' })"
Say "  Local Drive PID    : $(if ($drivePid) { $drivePid } else { 'NOT RUNNING' })"
Say "  Dashboard (mDNS)   : https://ionity.local/gateflame/"
Say "  Dashboard (hosts)  : https://ionity.wifi.storage/gateflame/   (after hosts setup - Setup tab)"
foreach ($ip in $ips) { Say "  Dashboard (direct) : http://${ip}${hp}/gateflame/   |   http://${ip}:$FleetPort/" }
Say "  On this PC         : http://127.0.0.1:$FleetPort/"
if (-not $httpPort) { Say "  WARNING: the /gateflame bridge did not answer on :80/:8080/:9080 - is the Local Drive built with it?" Yellow }
if (-not $httpsOk) { Say "  NOTE: nothing listens on :443 - the Local Drive fell back to :8443 for HTTPS." Yellow }
Say ""
Say "  Put on each box (GATEFLAME_FEED_URL, with GATEFLAME_FEED_ENABLED=true):" Cyan
foreach ($ip in $ips) {
    Say "    http://${ip}:$FleetPort/api/v1/nodes            (direct; needs the :$FleetPort firewall rule for that subnet)"
    if ($httpPort) { Say "    http://${ip}${hp}/gateflame/api/v1/nodes   (via the Local Drive; uses its firewall rule)" }
}
Say "  ------------------------------------------------------------------"
Say "  Log: $log" DarkGray

if (-not $Watch) { exit $(if ($fleetPid -and $drivePid) { 0 } else { 1 }) }

# ------------------------------------------------------------------ watch
Say "Watching both every 30 s (Ctrl+C to stop watching; the services keep running)." DarkGray
while ($true) {
    Start-Sleep -Seconds 30
    if (-not (Get-Listener $FleetPort)) { Say "$(Get-Date -Format s) fleet not listening - restarting." Yellow; $fleetPid = Start-Fleet }
    if (-not (Get-Process -Name IonityLocalDrive -ErrorAction SilentlyContinue)) { Say "$(Get-Date -Format s) Local Drive exited - restarting." Yellow; $drivePid = Start-LocalDrive }
}
