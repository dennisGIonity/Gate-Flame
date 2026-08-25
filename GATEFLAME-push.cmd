@echo off
setlocal
REM ===========================================================================
REM  Gate^Flame - push main and the work branch to GitHub
REM
REM  (c) 2018-2026 Antwerp Designs ^| Ionity (Pty) Ltd - Policy 986 AED
REM
REM  Checks the SSH identity FIRST and says plainly what is wrong, because the
REM  useful failure here is not "push failed" - it is *why*. Two sessions were
REM  lost to diagnosing a rejected key as a missing ssh-agent.
REM
REM  The key at %USERPROFILE%\.ssh\id_ed25519 is UNENCRYPTED, so no agent is
REM  involved: ssh reads the file directly. If GitHub refuses it, the key is
REM  not on the account and nothing on this machine can fix that.
REM ===========================================================================

set SSH=C:\Program Files\Git\usr\bin\ssh.exe
set GIT_TERMINAL_PROMPT=0

echo.
echo == Checking the GitHub SSH identity ==
"%SSH%" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | findstr /C:"successfully authenticated" >nul
if errorlevel 1 goto :nokey

echo    OK - GitHub recognises this key.
echo.
echo == Pushing ==
cd /d "%~dp0"
git push origin main
if errorlevel 1 goto :pushfail
git push origin fix/mobile-dns-drops
if errorlevel 1 goto :pushfail

echo.
echo == Done ==
git status -sb
goto :end

:nokey
echo.
echo    REFUSED. GitHub will not accept this key.
echo.
echo    This is NOT an ssh-agent problem. The key has no passphrase, so ssh
echo    reads it straight off disk - there is no agent in the path at all.
echo    It is offered and rejected, which means one thing only:
echo.
echo        the public key is not registered on the GitHub account.
echo.
echo    FIX - takes about thirty seconds, once, forever:
echo      1. Open  https://github.com/settings/ssh/new
echo      2. Title: wabakipi
echo      3. Paste the line printed below into the Key box
echo      4. Add SSH key, then run this script again
echo.
echo    ---- paste this ----
type "%USERPROFILE%\.ssh\id_ed25519.pub"
echo    --------------------
echo.
echo    Alternative, if you would rather not touch keys: push over HTTPS and
echo    let the Git Credential Manager pop a browser sign-in.
echo.
echo        git push https://github.com/dennisGIonity/Gate-Flame.git main
echo.
echo    That works immediately but cannot be run unattended, which is why the
echo    key is the better answer.
goto :end

:pushfail
echo.
echo    The push itself failed - see the message above. If it mentions
echo    "fetch first", someone else has pushed; run  git pull --rebase  and
echo    try again. Do NOT force-push this repository.

:end
echo.
pause
endlocal
