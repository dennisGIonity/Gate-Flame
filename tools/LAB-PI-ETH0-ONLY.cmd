@echo off
rem Gate^Flame - put the lab Pi back on eth0 only (household Wi-Fi autoconnect off, wlan0 down). Double-click.
rem You type YOUR Pi sudo password once. Refuses unless your ssh session arrives via 192.168.124.3.
rem Log: tools\lab-pi-eth0-only.last.txt
"C:\Program Files\Git\bin\bash.exe" -l "%~dp0lab-pi-eth0-only.sh"
echo.
pause
