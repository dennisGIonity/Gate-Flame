@echo off
rem git-bash.cmd <script.sh> [args] — run a script under Git-bash, the only shell on this
rem machine with a working ssh and SSH_AUTH_SOCK. Paths are /e/Gateflame/... style.
set "BASH=C:\Program Files\Git\bin\bash.exe"
"%BASH%" -l %*
