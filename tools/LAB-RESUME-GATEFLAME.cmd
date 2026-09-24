@echo off
rem Gate^Flame - bring GateFlame back up on the Ionity lab (H3C). Double-click.
rem You type YOUR ssh passphrase and YOUR Pi sudo password. Refuses if the Pi is not on 192.168.124.x.
"C:\Program Files\Git\bin\bash.exe" -l "%~dp0lab-resume-gateflame.sh"
echo.
pause
