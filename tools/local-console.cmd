@echo off
rem local-console.cmd — run the REAL node agent on this workstation with the freshly
rem built kiosk bundle mounted, so the console can be exercised in a browser when the
rem Pi is out of reach. No Pi-hole here, so the agent must show its honest
rem `unconfigured` / gap states - that is the point. State goes to %TEMP%, not the repo.
rem   local-console.cmd build   -> rebuild dist-kiosk + dist-mobile (needs NODE_ENV cleared)
rem   local-console.cmd run     -> start uvicorn on 127.0.0.1:8080 (foreground)
setlocal
set NODE_ENV=
cd /d E:\Gateflame
if "%1"=="build" (
  call npm run build:html-kiosk > tools\local-console.build.txt 2>&1
  call npm run build:html-mobile >> tools\local-console.build.txt 2>&1
  echo build rc=%ERRORLEVEL% >> tools\local-console.build.txt
  goto :eof
)
if "%1"=="run" (
  set GATEFLAME_DB_PATH=%TEMP%\gateflame-local-state.db
  set GATEFLAME_DATA_ROOT=%TEMP%\gateflame-local-dump
  set GATEFLAME_KIOSK_DIR=E:\Gateflame\dist-kiosk
  set GATEFLAME_FEED_ENABLED=false
  set GATEFLAME_HOST=127.0.0.1
  set GATEFLAME_PORT=8080
  cd node-agent
  .venv\Scripts\python.exe -m uvicorn gateflame.main:app --host 127.0.0.1 --port 8080 > ..\tools\local-console.run.txt 2>&1
  goto :eof
)
echo usage: local-console.cmd build ^| run
