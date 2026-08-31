# Build-to-phone in one step, with the two checks that have each caught a
# silent failure here before.
#
# 1. COPY FIRST, ALWAYS. An earlier version installed straight from release/
#    without refreshing it, so it reinstalled the previous build and reported
#    success. The APK on the phone was a build behind and nothing said so.
# 2. COMPARE SIZES after the copy, so a half-written file cannot be installed.
#
# Assumes the APK is already built:
#   npm run build:html-mobile && npx cap sync android
#   cd android && .\gradlew.bat assembleDebug
# (`npm run build:apk-debug` chains those but contains a `chmod` that fails on
# Windows - harmless, but it stops the chain before Gradle runs.)
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
$dst = Join-Path $root "release\GateFlame-Mobile-debug.apk"

if (-not (Test-Path $src)) { Write-Output "no debug APK built yet: $src"; exit 1 }
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Copy-Item $src $dst -Force

$b = Get-Item $src
$r = Get-Item $dst
Write-Output ("built : " + $b.LastWriteTime + "  " + $b.Length + " bytes")
Write-Output ("staged: " + $r.LastWriteTime + "  " + $r.Length + " bytes")
if ($b.Length -ne $r.Length) { Write-Output "COPY MISMATCH - aborting"; exit 1 }

& (Join-Path $PSScriptRoot "phone-connect.ps1")

$target = ((& $adb devices 2>&1) | Select-String "device$" |
    Where-Object { $_ -notmatch "emulator-" } | Select-Object -First 1) -split "\s+" | Select-Object -First 1
if (-not $target) { Write-Output ""; Write-Output "no handset connected - not installing"; exit 1 }

Write-Output ""
& $adb -s $target install -r $dst 2>&1
Write-Output ""
& $adb -s $target shell dumpsys package today.ionity.gateflame.debug 2>&1 |
    Select-String -Pattern "lastUpdateTime|versionName"
