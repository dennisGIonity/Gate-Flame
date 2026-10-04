@echo off
rem Gate^Flame - back up the T1 server: signing key, tokens (admin + enrolment), device database.
rem Double-click. Writes a zip to t1\server\backups\ (git-ignored). Keep a copy OFF this PC.
rem LOSE THE SIGNING KEY = every T1 board in the field refuses every update and must be re-flashed by hand.
cd /d E:\.claude\Ionity\Gateflame
t1\server\.venv\Scripts\python.exe -m t1server backup
echo.
echo   Copy that zip somewhere that is not this computer.
pause
