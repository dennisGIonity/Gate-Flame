@echo off
setlocal DisableDelayedExpansion

:: ============================================================================
:: Gate^Flame Android Assembly Script (Virtual Drive Mode)
:: Ionity Global (Pty) Ltd
:: ============================================================================

echo.
echo  [#] Starting Gate^^Flame Android Assembly Suite...
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

:: Step 1: Environment Check (JAVA_HOME)
if "%JAVA_HOME%"=="" (
    echo  [1/4] JAVA_HOME not set. Attempting to locate JDK...
    for /d %%i in ("E:\Program Files (x86)\AndroidStudio\jbr", "C:\Program Files\Android\Android Studio\jbr") do (
        if exist "%%~i\bin\java.exe" (
            set "JAVA_HOME=%%~i"
            set "PATH=!JAVA_HOME!\bin;!PATH!"
            echo  [+] Found JDK at: !JAVA_HOME!
        )
    )
    if "!JAVA_HOME!"=="" (
        echo  [!] Error: Could not locate JDK.
        goto cleanup_fail
    )
)

:: Ensure we are in the root of X:
cd /d %VDRIVE%\

:: Step 2: Android Locations Fix
echo  [2/4] Setting up Android home environment...
if not exist ".android_home" mkdir .android_home
if not exist ".gradle_home" mkdir .gradle_home

if not exist "node_modules\" (
    echo  [!] Error: node_modules not found.
    goto cleanup_fail
)

:: Step 3: Web Build & Sync
echo  [3/4] Compiling Web Assets & Syncing...
node "node_modules\vite\bin\vite.js" build
if !errorlevel! neq 0 (
    echo  [!] Error: Web build failed.
    goto cleanup_fail
)

node "node_modules\@capacitor\cli\bin\capacitor" sync android
if !errorlevel! neq 0 (
    echo  [!] Error: Capacitor sync failed.
    goto cleanup_fail
)

:: Step 4: Gradle APK Build
echo  [4/4] Assembling Debug APK via Gradle...
cd android
:: Use the wrapper JAR directly with system properties to force locations to the virtual drive
"!JAVA_HOME!\bin\java.exe" "-Dgradle.user.home=%VDRIVE%\.gradle_home" "-Dandroid.user.home=%VDRIVE%\.android_home" -jar "gradle\wrapper\gradle-wrapper.jar" assembleDebug
set GRADLE_STATUS=!errorlevel!
cd ..

if !GRADLE_STATUS! neq 0 (
    echo  [!] Error: Android compilation failed.
    goto cleanup_fail
)

echo.
echo  ============================================================================
echo   SUCCESS: Gate^^Flame APK Assembled!
echo  ============================================================================
echo   Location: %VDRIVE%\android\app\build\outputs\apk\debug\app-debug.apk
echo  ============================================================================
echo.

:cleanup_success
c:
subst %VDRIVE% /D
pause
exit /b 0

:cleanup_fail
c:
subst %VDRIVE% /D
pause
exit /b 1
