# Gate^Flame T1 - compile the firmware with PLACEHOLDER secrets (no upload, no prompts).
# Proves the sketch builds against the installed esp32 core. Output -> compile-check.last.txt
param([ValidateSet('opi', 'enabled', 'disabled')][string]$Psram = 'opi')
$t1 = Resolve-Path (Join-Path $PSScriptRoot '..')
$sketch = Join-Path $t1 'firmware\GF_T1_Node'
$py = Join-Path $t1 'server\.venv\Scripts\python.exe'
$acli = (Get-Command arduino-cli -ErrorAction SilentlyContinue).Source
if (-not $acli) { $acli = 'E:\Program Files (x86)\ArduinoIDE\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe' }
& {
  "=== T1 compile-check $(Get-Date -Format s) ==="
  Push-Location (Join-Path $t1 'server'); & $py -m t1server pubkey-header | Set-Content -Encoding ascii (Join-Path $sketch 'pubkey.h'); Pop-Location
  $secrets = Join-Path $sketch 'secrets.h'; $temp = -not (Test-Path $secrets)
  if ($temp) { Copy-Item (Join-Path $sketch 'secrets.h.example') $secrets }
  $fqbn = "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=$Psram,PartitionScheme=app3M_fat9M_16MB"
  & $acli core list 2>&1 | Select-String 'esp32'
  "fqbn: $fqbn"
  & $acli compile --fqbn $fqbn --build-path (Join-Path $t1 'firmware\.build') --warnings default $sketch 2>&1 | Select-Object -Last 25
  "rc=$LASTEXITCODE"
  if ($temp) { Remove-Item $secrets -Force }
} *>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'compile-check.last.txt')
