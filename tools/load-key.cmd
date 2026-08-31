@echo off
cd /d E:\Gateflame
title Gate^^Flame - load SSH key
echo.
echo  ============================================================
echo   GATE^FLAME - LOAD YOUR SSH KEY
echo  ============================================================
echo.
echo   Starts Git's SSH agent and loads your key into it.
echo   Needed once per Windows restart, for GitHub and for the Pi.
echo.
echo   Nothing appears on screen while you type the passphrase.
echo   That is normal. Type it and press Enter.
echo.
echo  ------------------------------------------------------------
echo.
set BASH="C:\Program Files\Git\bin\bash.exe"
if not exist %BASH% (
  echo  ERROR: Git for Windows bash not found.
  echo  Windows' own OpenSSH is broken on this machine - only Git's copy works.
  pause
  exit /b 1
)

REM ----------------------------------------------------------------------
REM WHY THIS IS NOT A ONE-LINER ANY MORE
REM
REM When the agent dies (reboot, crash), the SOCKET FILE it created is left
REM behind at ~/.ssh/agent.sock. `ssh-agent -a <path>` then refuses to start,
REM because something already occupies that path. The old version of this
REM script fell through to a bare `ssh-agent -s`, which puts its socket at a
REM RANDOM temp path known only inside that one bash process - so the key was
REM genuinely loaded, into an agent that nothing afterwards could find.
REM
REM The screen said KEY LOADED OK. Every push still failed with
REM "Permission denied (publickey)". That is this project's oldest mistake -
REM claiming success without reading back - committed by the very script
REM meant to make the setup reliable.
REM
REM So: probe the socket, clear it ONLY if it is dead, then verify against
REM GitHub itself before saying anything worked.
REM ----------------------------------------------------------------------
%BASH% -lc "bash tools/load-key.sh"

echo.
echo  ------------------------------------------------------------
echo   Stays loaded until Windows restarts. Then run this again.
echo.
pause
