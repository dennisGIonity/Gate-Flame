# Gate^Flame — build the DEBUG Android APK on wabakipi.
#
#   powershell -File tools\build-apk-debug.ps1
#
# Why not `npm run build:apk-debug`: that script chains `chmod +x gradlew &&
# ./gradlew`, which fails on Windows at the chmod. This does the same steps
# with gradlew.bat, bumps VERSION_CODE first (android/version.properties is
# the single source of truth and must rise on every build that leaves this
# machine), and asserts the APK exists with a real size before saying so.
#
# A RELEASE build is deliberately not here. Signing is blocked until the
# keystore check in docs/reports/manual-tasks-2026-08-31.html item 01 passes
# - a key that cannot be opened is the same as no key.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$env:NODE_ENV = ''
$logDir = Join-Path $root 'release\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("build-apk-debug-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Step($name, [scriptblock]$body) {
  "`n===== $name  ($(Get-Date -Format 'HH:mm:ss')) =====" | Tee-Object -FilePath $log -Append
  & $body 2>&1 | Tee-Object -FilePath $log -Append
  "----- $name exit=$LASTEXITCODE" | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { "STEP FAILED: $name" | Tee-Object -FilePath $log -Append; exit 1 }
}

Step 'version:bump' { npm run version:bump }
Step 'web bundle (dist-mobile)' { npm run build:html-mobile }
Step 'cap sync android' { npx cap sync android }
Push-Location android
Step 'gradlew assembleDebug' { .\gradlew.bat assembleDebug --no-daemon -q }
Pop-Location

$src = 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $src)) { "NO APK at $src" | Tee-Object -FilePath $log -Append; exit 1 }
New-Item -ItemType Directory -Force -Path release | Out-Null
Copy-Item $src release\GateFlame-Mobile-debug.apk -Force
$apk = Get-Item release\GateFlame-Mobile-debug.apk
"`n===== OUTPUT =====" | Tee-Object -FilePath $log -Append
Get-Content android\version.properties | Select-String '^VERSION_' | Tee-Object -FilePath $log -Append
"{0}  {1:N0} bytes  sha256 {2}" -f $apk.Name, $apk.Length, (Get-FileHash $apk.FullName -Algorithm SHA256).Hash | Tee-Object -FilePath $log -Append
if ($apk.Length -lt 2MB) { 'APK under 2 MB - the webDir was probably empty' | Tee-Object -FilePath $log -Append; exit 1 }
'APK DEBUG BUILD OK' | Tee-Object -FilePath $log -Append
exit 0
