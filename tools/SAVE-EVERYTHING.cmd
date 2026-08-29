@echo off
cd /d E:\Gateflame
title Gate^^Flame - save everything
echo.
echo  ============================================================
echo   GATE^FLAME - SAVE EVERYTHING TO GITHUB
echo  ============================================================
echo.
echo   Some commits on this machine exist NOWHERE ELSE.
echo   This pushes all of them to GitHub.
echo.
echo   It does NOT delete anything. It never force-pushes.
echo.
echo   You may be asked for your SSH passphrase.
echo   Nothing appears on screen while you type it. That is normal.
echo.
echo  ------------------------------------------------------------
echo.
pause
"C:\Program Files\Git\bin\bash.exe" /e/Gateflame/tools/save-everything.sh
echo.
echo  ------------------------------------------------------------
echo   Read the summary above before closing.
echo.
pause
