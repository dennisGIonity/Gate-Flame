# Gate^Flame — build the Windows desktop console on wabakipi.
#
#   powershell -File tools\build-desktop.ps1            # portable .exe + NSIS installer
#   powershell -File tools\build-desktop.ps1 -Portable  # portable .exe only (fastest)
#
# Produces release\desktop\GateFlame-Desktop-<ver>-portable.exe and logs to
# release\logs\build-desktop-<stamp>.log. Success is asserted by the FILE
# EXISTING with a non-trivial size, not by electron-builder's exit code.
#
# macOS and Linux are built by .github/workflows/release-desktop.yml on real
# runners; this script does not pretend otherwise.
param([switch]$Portable)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
# Vite must see NODE_ENV empty (a value of 'development' makes it emit a dev
# bundle that verify-bundle rightly refuses). devDependencies are pulled in
# explicitly with --include=dev where npm install runs.
$env:NODE_ENV = ''
$logDir = Join-Path $root 'release\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("build-desktop-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Step($name, [scriptblock]$body) {
  "`n===== $name  ($(Get-Date -Format 'HH:mm:ss')) =====" | Tee-Object -FilePath $log -Append
  & $body 2>&1 | Tee-Object -FilePath $log -Append
  "----- $name exit=$LASTEXITCODE" | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { "STEP FAILED: $name" | Tee-Object -FilePath $log -Append; exit 1 }
}

Step 'web bundle (dist-mobile)' { npm run build:html-mobile }
if (-not (Test-Path 'dist-mobile\index.html')) { 'dist-mobile\index.html missing - refusing to package an empty shell' | Tee-Object -FilePath $log -Append; exit 1 }

Push-Location desktop
Step 'desktop deps' { npm install --include=dev --no-audit --no-fund }
if ($Portable) {
  Step 'electron-builder (portable)' { npx electron-builder --win portable }
} else {
  Step 'electron-builder (portable + nsis)' { npx electron-builder --win portable nsis }
}
Pop-Location

"`n===== OUTPUT =====" | Tee-Object -FilePath $log -Append
$exe = Get-ChildItem release\desktop\*.exe -ErrorAction SilentlyContinue
if (-not $exe) { 'NO EXE PRODUCED' | Tee-Object -FilePath $log -Append; exit 1 }
$exe | ForEach-Object { "{0}  {1:N0} bytes  sha256 {2}" -f $_.Name, $_.Length, (Get-FileHash $_.FullName -Algorithm SHA256).Hash } | Tee-Object -FilePath $log -Append
$small = $exe | Where-Object { $_.Length -lt 40MB }
if ($small) { 'An exe is under 40 MB - an Electron app that small did not embed its runtime' | Tee-Object -FilePath $log -Append; exit 1 }
'DESKTOP BUILD OK' | Tee-Object -FilePath $log -Append
exit 0
