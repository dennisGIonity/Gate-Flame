@echo off
rem pi-reach.cmd [host] — runs tools\pi-reach.sh under Git-bash (the only ssh that works
rem on this machine, and the only shell with SSH_AUTH_SOCK). Output -> tools\pi-reach.last.txt
set "BASH=C:\Program Files\Git\bin\bash.exe"
"%BASH%" -l /e/Gateflame/tools/pi-reach.sh %1 > E:\Gateflame\tools\pi-reach.last.txt 2>&1
type E:\Gateflame\tools\pi-reach.last.txt
