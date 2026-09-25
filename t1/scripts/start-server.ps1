# ========================================================================================
# Gate^Flame T1 - start the T1 server on this machine (the local Ionity server)
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2 | Policy 986 AED
#   Dashboard  http://127.0.0.1:8095/        (no token needed on this machine)
#   Devices    http://<this-ip>:8095/api/t1/v1/...   (device token, baked into firmware)
#   MCP        http://127.0.0.1:8095/mcp
# Separate from ESP32-MCP (:8099) and the Gate^Flame fleet console (:8091). Touches neither.
# ========================================================================================
$ErrorActionPreference = 'Stop'
$srv = Resolve-Path (Join-Path $PSScriptRoot '..\server')
Set-Location $srv
$env:NODE_ENV = ''
$py = Join-Path $srv '.venv\Scripts\python.exe'

if (-not (Test-Path $py)) {
  Write-Host '[t1] creating venv in t1\server\.venv ...'
  if (Get-Command py -ErrorAction SilentlyContinue) { & py -3 -m venv .venv } else { & python -m venv .venv }
  if (-not (Test-Path $py)) { throw 'could not create the venv - is Python 3.10+ installed?' }
}
Write-Host '[t1] installing requirements (quiet) ...'
& $py -m pip install -q --disable-pip-version-check -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
# Windows Smart App Control blocks zeroconf's compiled extension ("An Application Control
# policy has blocked this file", seen 2026-09-25). Its pure-Python build works the same.
& $py -c "import zeroconf" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host '[t1] zeroconf binary blocked by Application Control - installing the pure-Python build'
  $env:SKIP_CYTHON = '1'
  & $py -m pip install -q --disable-pip-version-check --force-reinstall --no-deps --no-binary zeroconf zeroconf
}

# Windows Firewall: boards on the LAN must reach :8095. Adding a rule needs admin, so
# only check and say exactly what to run - never elevate silently.
$rule = Get-NetFirewallRule -DisplayName 'GateFlame T1 server 8095' -ErrorAction SilentlyContinue
if (-not $rule) {
  Write-Host ''
  Write-Host '  [!] No firewall rule for TCP 8095 yet. T1 boards cannot report until it exists.' -ForegroundColor Yellow
  Write-Host '      Run ONCE in an ADMIN PowerShell:' -ForegroundColor Yellow
  Write-Host '      New-NetFirewallRule -DisplayName "GateFlame T1 server 8095" -Direction Inbound -Protocol TCP -LocalPort 8095 -Action Allow -Profile Private' -ForegroundColor Yellow
  Write-Host '      (mDNS discovery also needs UDP 5353 inbound on the Private profile - usually already allowed.)'
  Write-Host ''
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
       Where-Object { $_.IPAddress -like '192.168.124.*' } | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress }
Write-Host "[t1] dashboard : http://127.0.0.1:8095/"
Write-Host "[t1] boards    : http://${ip}:8095   (lab address preferred; mDNS _gft1._tcp advertised)"
Write-Host "[t1] first start builds all three filters from the live blocklists (1-3 min)."
& $py -m t1server serve
