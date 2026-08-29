@echo off
cd /d E:\Gateflame
title Gate^^Flame - apply fixes to the Pi
echo.
echo  ============================================================
echo   GATE^FLAME - APPLY THE NETWORK FIXES TO THE PI
echo  ============================================================
echo.
echo   Connects to the Pi and runs the fix script that is already
echo   staged there at /home/wabapi/apply-gateflame-fixes.sh
echo.
echo   It installs the fixed DNS watchdog to /usr/local/bin, records
echo   the LAN address, recreates the stack, and triggers the IPv6
echo   self-heal. That is what stops the phones dropping.
echo.
echo   You will be asked for the PI's password (user wabapi).
echo   Nothing appears while you type it. That is normal.
echo.
echo   DNS will pause for about 10 seconds partway through.
echo.
echo  ------------------------------------------------------------
echo.
pause
"C:\Program Files\Git\bin\bash.exe" -c "source /e/Gateflame/tools/_env.sh; gf_agent || { echo 'SSH key not loaded - run tools\\load-key.cmd first'; exit 1; }; ssh -t wabapi@192.168.0.10 'sudo bash /home/wabapi/apply-gateflame-fixes.sh'"
echo.
echo  ------------------------------------------------------------
echo   Scroll up and read the NETWORK CHECK section.
echo.
pause
