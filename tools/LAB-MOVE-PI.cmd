@echo off
rem Gate^Flame - move the Pi fully onto the lab and start GateFlame there. Double-click.
rem You type YOUR Pi sudo password once. Log: tools\lab-move-pi.last.txt
"C:\Program Files\Git\bin\bash.exe" -l "%~dp0lab-move-pi.sh"
echo.
pause
