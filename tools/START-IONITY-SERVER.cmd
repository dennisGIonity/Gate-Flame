@echo off
rem Gate^Flame - start the Ionity offline server (fleet dashboard + Ionity Local Drive).
rem Double-click, or run from a terminal. No elevation needed. See START-IONITY-SERVER.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-IONITY-SERVER.ps1" %*
echo.
pause
