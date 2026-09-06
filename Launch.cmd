@echo off
setlocal DisableDelayedExpansion

:: ============================================================================
:: Gate^Flame Android Launch & Test Suite
:: Ionity Global (Pty) Ltd
:: ============================================================================

echo.
echo  [#] Initializing Gate^^Flame Launch Sequence...
echo.

:: Step 0: Virtual Drive Setup (Bypassing Caret Path Issues)
set "VDRIVE=X:"
echo  [0/4] Mapping project to %VDRIVE%...
subst %VDRIVE% /D >nul 2>&1
subst %VDRIVE% .
if errorlevel 1 (
    echo  [!] Error: Failed to map virtual drive.
    pause
    exit /b 1
)

:: Switch to virtual drive
%VDRIVE%
cd \

setlocal EnabledelayedExpansion

:: Step 1: Locate ADB
set "ADB=C:\Users\DGMic\AppData\Local\Android\Sdk\platform-tools\adb.exe"
if not exist "!ADB!" (
    echo  [!] Error: ADB not found at !ADB!
    goto cleanup_fail
)

:: Step 2: Check for Connected Devices
echo  [1/4] Checking for Android devices...
"!ADB!" devices | findstr /V "List" | findstr "device" >nul
if errorlevel 1 (
    echo  [!] Error: No device or emulator found.
    echo      Please connect a device or start an emulator first.
    goto cleanup_fail
)

:: Step 3: Check for APK
set "APK_PATH=android\app\build\outputs\apk\debug\app-debug.apk"
if not exist "!APK_PATH!" (
    echo  [!] Error: APK not found. Please run 'Assemble.cmd' first.
    goto cleanup_fail
)

:: Step 4: Install and Launch
echo  [2/4] Installing APK: !APK_PATH!...
"!ADB!" install -r "!APK_PATH!"
if errorlevel 1 (
    echo  [!] Error: Installation failed.
    goto cleanup_fail
)

echo  [3/4] Launching com.ionity.gateflame.app...
"!ADB!" shell am start -n com.ionity.gateflame.app/.MainActivity
if errorlevel 1 (
    echo  [!] Error: Failed to start activity.
    goto cleanup_fail
)

echo  [4/4] App launched! Starting real-time log filter...
echo  ----------------------------------------------------------------------------
echo  FILTERING FOR: Plugins, MessageQueue (Dead Thread Fix), and Errors
echo  Press Ctrl+C to stop logging and exit.
echo  ----------------------------------------------------------------------------
echo.

:: Show logs for Capacitor Plugins, the MessageQueue fix, and any runtime crashes
"!ADB!" logcat *:S Plugin:V MessageQueue:V System.out:I AndroidRuntime:E Capacitor:V Capacitor/Console:V

:cleanup_success
c:
subst %VDRIVE% /D
exit /b 0

:cleanup_fail
c:
subst %VDRIVE% /D
pause
exit /b 1
