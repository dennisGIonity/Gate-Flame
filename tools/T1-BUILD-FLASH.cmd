@echo off
title Gate^^Flame T1 - build and flash an ESP32-S3
cd /d E:\Gateflame
echo.
echo   Builds the T1 firmware and flashes ONE ESP32-S3 (N16R8) plugged in by USB.
echo   Start tools\T1-SERVER.cmd first - the board must report to it before this says OK.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File t1\scripts\build-flash.ps1 %*
pause
