@echo off
rem Gate^Flame - back up the fleet console database (fleet\fleet.db). Double-click.
rem Safe while the fleet runs (SQLite online backup). Writes only to E:\Gateflame-backups\fleet\, keeps 30.
rem fleet.db is the customer trust store: the per-node tokens live there. See fleet-backup.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fleet-backup.ps1" %*
echo.
pause
