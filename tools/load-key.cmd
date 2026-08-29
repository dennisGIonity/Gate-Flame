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
%BASH% -c "eval \"$(ssh-agent -a ~/.ssh/agent.sock -s)\" >/dev/null 2>&1 || eval \"$(ssh-agent -s)\" >/dev/null 2>&1; ssh-add ~/.ssh/id_ed25519 && echo && echo '  KEY LOADED OK' && ssh-add -l"
echo.
echo  ------------------------------------------------------------
echo   Stays loaded until Windows restarts. Then run this again.
echo.
pause
