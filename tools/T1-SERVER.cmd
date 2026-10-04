@echo off
title Gate^^Flame T1 server :8095
cd /d E:\.claude\Ionity\Gateflame
powershell -NoProfile -ExecutionPolicy Bypass -File t1\scripts\start-server.ps1
pause
