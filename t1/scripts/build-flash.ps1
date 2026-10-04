# ========================================================================================
# Gate^Flame T1 - build and flash one ESP32-S3 T1 node, PROVISION it, then PROVE it reported in.
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2 | Policy 986 AED
#
#   tools\T1-BUILD-FLASH.cmd                      (prompts for what it needs)
#   powershell -File t1\scripts\build-flash.ps1 -Port COM8 -Ssid LabNet -Level low
#   ... -NoUpload                                  compile only
#   ... -ProvisionOnly                             skip build+flash: just (re)write settings over serial
#
# ONE IMAGE: nothing secret is compiled in. The image carries only the public signing key
# (pubkey.h, generated). The Wi-Fi network, server address and the one-time ENROLMENT token
# are written to the board's NVS over serial AFTER flashing (protocol gf-t1-prov/1), and the
# board trades the enrolment token for a token of its own on first contact. The Wi-Fi password
# is asked for HERE, on this machine, and is sent to the board only - never logged.
# Uses the T1 server's venv for the enrolment token and public key, so run tools\T1-SERVER.cmd
# once first. Does not touch E:\.claude\Ionity\.ESP32-MCP in any way.
# ========================================================================================
param(
  [string]$Port = '',
  [string]$Ssid = '',
  [string]$Server = '',
  [ValidateSet('low', 'medium', 'high')][string]$Level = 'low',
  [ValidateSet('opi', 'enabled', 'disabled')][string]$Psram = 'opi',
  [string]$StaticIp = '',
  [switch]$UsbCdc,
  [switch]$NoUpload,
  [switch]$ProvisionOnly
)
$ErrorActionPreference = 'Stop'
$t1 = Resolve-Path (Join-Path $PSScriptRoot '..')
$sketch = Join-Path $t1 'firmware\GF_T1_Node'
$py = Join-Path $t1 'server\.venv\Scripts\python.exe'
$log = Join-Path $PSScriptRoot 'build-flash.last.txt'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c; Add-Content -Path $log -Value $m }
Set-Content -Path $log -Value "=== T1 build-flash $(Get-Date -Format s) ==="

# 1. toolchain
$acli = (Get-Command arduino-cli -ErrorAction SilentlyContinue).Source
if (-not $acli) { $acli = 'E:\Program Files (x86)\ArduinoIDE\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe' }
if (-not (Test-Path $acli)) { throw "arduino-cli not found (looked on PATH and at $acli)" }
if (-not (Test-Path $py)) { throw 'T1 server venv missing - run tools\T1-SERVER.cmd once first' }

$fqbn = "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=$Psram,PartitionScheme=app3M_fat9M_16MB"
# -UsbCdc for boards wired through the S3's native USB port; leave it off for boards with a
# CH340/CP210x USB-UART chip.
if ($UsbCdc) { $fqbn += ',USBMode=hwcdc,CDCOnBoot=cdc' }
$build = Join-Path $t1 'firmware\.build'
$flashed = Get-Date

if (-not $ProvisionOnly) {
  $core = & $acli core list 2>&1 | Select-String '^esp32:esp32\s'
  if (-not $core) { Say '[t1] installing esp32 core ...'; & $acli core update-index; & $acli core install esp32:esp32 }
  Say "[t1] core: $($core -replace '\s+', ' ')"

  # 2. generated header: the public key only
  Push-Location (Join-Path $t1 'server')
  & $py -m t1server pubkey-header | Set-Content -Encoding ascii (Join-Path $sketch 'pubkey.h')
  Pop-Location
  # An old secrets.h would silently become the board's defaults: refuse to build with one.
  if (Test-Path (Join-Path $sketch 'secrets.h')) { throw 'firmware\GF_T1_Node\secrets.h exists - delete it (settings are provisioned now, not compiled in)' }

  # 3. compile
  Say "[t1] compiling $fqbn"
  $out = & $acli compile --fqbn $fqbn --build-path $build --warnings default $sketch 2>&1
  $out | Select-Object -Last 8 | ForEach-Object { Say "    $_" }
  if ($LASTEXITCODE -ne 0) { throw 'compile FAILED - see above' }
  if ($NoUpload) { Say '[t1] compile OK (not uploaded)' 'Green'; exit 0 }
}

# 4. upload
if (-not $Port) {
  $ports = & $acli board list --format json | ConvertFrom-Json
  $cands = @($ports.detected_ports | Where-Object { $_.port.protocol -eq 'serial' } | ForEach-Object { $_.port.address })
  if ($cands.Count -eq 1) { $Port = $cands[0] }
  else { $Port = Read-Host "Serial port of the ESP32-S3 (found: $($cands -join ', '))" }
}
if (-not $ProvisionOnly) {
  Say "[t1] uploading to $Port (hold BOOT and tap RST if it will not connect)"
  & $acli upload --fqbn $fqbn --input-dir $build -p $Port $sketch 2>&1 | Select-Object -Last 5 | ForEach-Object { Say "    $_" }
  if ($LASTEXITCODE -ne 0) { throw 'upload FAILED' }
  Start-Sleep 4
}

# 5. provision over serial (gf-t1-prov/1): one JSON object per line, replies prefixed "GF-T1-PROV "
if (-not $Server) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.124.*' } | Select-Object -First 1).IPAddress
  if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress }
  $Server = "http://${ip}:8095"
}
if (-not $Ssid) { $Ssid = Read-Host 'Wi-Fi SSID the T1 box joins (the lab H3C for testing; 2.4 GHz only)' }
$sec = Read-Host "Wi-Fi password for '$Ssid' (typed here, sent to the board only; blank = open network)" -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
Push-Location (Join-Path $t1 'server'); $enrol = (& $py -m t1server enrol-token).Trim(); Pop-Location

function JsonStr($s) { ($s | ConvertTo-Json -Compress) }
$sp = New-Object System.IO.Ports.SerialPort $Port, 115200, 'None', 8, 'One'
$sp.NewLine = "`n"; $sp.ReadTimeout = 30000; $sp.DtrEnable = $false; $sp.RtsEnable = $false
$sp.Open()
function Send($obj, $timeoutMs = 30000) {
  $sp.DiscardInBuffer()
  $sp.WriteLine($obj)
  $sp.ReadTimeout = $timeoutMs
  while ($true) {
    $line = $sp.ReadLine()
    if ($line.StartsWith('GF-T1-PROV ')) { return ($line.Substring(11) | ConvertFrom-Json) }
  }
}
try {
  $h = Send '{"op":"hello"}' 20000
  Say "[t1] board $($h.id)  fw $($h.fw)  PSRAM $($h.psram)  hotspot '$($h.ap_ssid)'"
  if (-not $h.psram) { throw 'this board reports NO PSRAM: T1 needs an ESP32-S3 N16R8 (8 MB PSRAM)' }
  $set = "{`"op`":`"set`",`"ssid`":$(JsonStr $Ssid),`"pass`":$(JsonStr $pass),`"server`":$(JsonStr $Server),`"enrol`":$(JsonStr $enrol),`"level`":$(JsonStr $Level)"
  if ($StaticIp) {
    $gw = ($StaticIp -replace '\.\d+$', '.1')
    $set += ",`"sip`":$(JsonStr $StaticIp),`"sgw`":$(JsonStr $gw),`"ssn`":`"255.255.255.0`""
  }
  $set += '}'
  $r = Send $set
  $pass = $null
  if (-not $r.ok) { throw "board refused the settings: $($r.error) $($r.detail)" }
  Say "[t1] settings written: $($r.changed -join ', ')"
  Say '[t1] testing: Wi-Fi, server, enrolment, authentication, signature ...'
  $t = Send '{"op":"test"}' 90000
  if ($t.ok) {
    Say "[t1] TEST PASSED ($($t.stages -join ' > ')) - joined at $($t.ip), rssi $($t.rssi), server $($t.server)" 'Green'
  } else {
    Say "[t1] TEST FAILED at stage '$($t.stage)': $($t.reason) $($t.hint)" 'Red'
    Send '{"op":"reboot"}' 5000 | Out-Null
    exit 1
  }
  Send '{"op":"reboot"}' 5000 | Out-Null
} finally { $sp.Close() }

# 6. read-back: the flash only counts once the board reports to the server
Say '[t1] waiting up to 120 s for the board to report in ...'
$deadline = (Get-Date).AddSeconds(120); $seen = $null
$since = [DateTimeOffset]::new($flashed).ToUnixTimeSeconds()
while ((Get-Date) -lt $deadline -and -not $seen) {
  Start-Sleep 5
  try { $seen = (Invoke-RestMethod http://127.0.0.1:8095/api/t1/v1/devices -TimeoutSec 5) | Where-Object { $_.id -eq $h.id -and $_.last_seen -ge $since } | Select-Object -First 1 } catch {}
}
if ($seen) {
  Say "[t1] REPORTED: $($seen.id) at $($seen.ip) - $($seen.status_label), level $($seen.level), fw $($seen.fw)" 'Green'
  Say "[t1] next: point the router's UPSTREAM DNS at $($seen.ip) (not the DHCP DNS - ADR-001), then watch http://127.0.0.1:8095/"
} else {
  Say '[t1] the board has NOT reported in 120 s. Open the serial monitor to see why:' 'Red'
  Say "     & '$acli' monitor -p $Port -c baudrate=115200" 'Red'
  exit 1
}
