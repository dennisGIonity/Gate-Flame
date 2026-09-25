@echo off
cd /d E:\Gateflame
title Gate^^Flame - push the 2026-09-25 consolidation
echo.
echo  ============================================================
echo   GATE^FLAME - PUSH TODAY'S CONSOLIDATION TO GITHUB
echo  ============================================================
echo.
echo   1. Loads your SSH key (type the passphrase - nothing shows, that is normal)
echo   2. Pushes fix/mobile-dns-drops and main. Never forces, deletes nothing.
echo   3. Reads GitHub back and prints SAME for each branch.
echo.
pause
"C:\Program Files\Git\bin\bash.exe" -lc "bash tools/load-key.sh && bash tools/commit-consolidation-2026-09-25.sh"
echo.
echo  ------------------------------------------------------------
echo   Both lines should say SAME. Close when read.
echo.
pause
