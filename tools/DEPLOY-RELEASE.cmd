@echo off
rem Gate^Flame - deploy the current repo to the lab Pi (192.168.124.3). Double-click.
rem You type YOUR Pi sudo password once. Log: tools\stage-pi-release.last.txt
"C:\Program Files\Git\bin\bash.exe" -l "%~dp0stage-pi-release.sh"
echo.
pause
