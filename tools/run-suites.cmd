@echo off
rem run-suites.cmd — the whole automated gate, from the host, with NODE_ENV cleared
rem (CLAUDE.md: it is wrongly 'production' on this machine). Output -> tools\run-suites.last.txt
setlocal
set NODE_ENV=
cd /d E:\Gateflame
echo === tsc --noEmit === > tools\run-suites.last.txt
call npx tsc --noEmit >> tools\run-suites.last.txt 2>&1
echo tsc rc=%ERRORLEVEL% >> tools\run-suites.last.txt
echo === vitest run === >> tools\run-suites.last.txt
call npx vitest run --reporter=dot >> tools\run-suites.last.txt 2>&1
echo vitest rc=%ERRORLEVEL% >> tools\run-suites.last.txt
echo === ruff (node-agent) === >> tools\run-suites.last.txt
cd node-agent
call python -m ruff check . --statistics >> ..\tools\run-suites.last.txt 2>&1
echo ruff rc=%ERRORLEVEL% >> ..\tools\run-suites.last.txt
echo DONE >> ..\tools\run-suites.last.txt
