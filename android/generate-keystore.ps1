#Requires -Version 5.1
# ========================================================================================
# GATE^FLAME - ANDROID RELEASE KEYSTORE GENERATOR (WINDOWS / POWERSHELL TWIN)
# Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
# Document ID: DOC-2026-08-014-KEYGEN | Version: 1.0 | Updated: 2026-08-14 SAST
# Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
# Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
# Classification: CONFIDENTIAL - creates unrecoverable key material | Building Tomorrow, Today.
# ========================================================================================
#
# +----------------------------------------------------------------------------------+
# |  NEVER RUN THIS IN A CLOUD SESSION, A CONTAINER, A CI RUNNER, OR ANY MACHINE     |
# |  YOU DO NOT PHYSICALLY CONTROL.                                                  |
# |                                                                                  |
# |  A signing key created in an ephemeral container and passed back through a chat  |
# |  transcript is ALREADY DISCLOSED - treat it as public the moment it exists       |
# |  there. There is no "just this once": the key cannot be rotated. Android will    |
# |  not install an update signed by a different key than the one already on a       |
# |  device, so a lost or leaked key means every customer in the field must          |
# |  uninstall and re-pair their node. This is the one artifact in the whole         |
# |  project with no recovery path.                                                  |
# |                                                                                  |
# |  Run it on wabakipi, interactively, once.                                        |
# +----------------------------------------------------------------------------------+
#
# This is the exact twin of android/generate-keystore.sh, for the Windows
# workstation (wabakipi). Same guards, same key parameters, same output.
#
# Usage (from the repository root, in an ordinary non-elevated PowerShell):
#
#     powershell -ExecutionPolicy Bypass -File android\generate-keystore.ps1
#
#   Optional:
#     -Keystore <path>        default %USERPROFILE%\.gateflame-signing\gateflame-release.jks
#     -Alias <name>           default gateflame
#     -StoreType JKS|PKCS12   default JKS (two passphrases; PKCS12 allows only one)
#
# Passwords are NEVER accepted as parameters. Argv lands in PSReadLine history and
# in the process list; that is a disclosure, not a shortcut.
#
# Companion documents:
#   android/KEYSTORE.md            full runbook (backup, CI, handling rules)
#   android/app/build.gradle       how the keystore is consumed at build time
#   android/generate-keystore.sh   bash twin
# ========================================================================================

# Write-Host is deliberate throughout: this is a one-shot interactive operator
# script whose output is for a human at a console, has to be coloured, and must
# never leak into the pipeline (a captured passphrase prompt would be a defect).
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'Interactive console script; output is for a human, not the pipeline.')]
[CmdletBinding()]
param(
    [string] $Keystore,
    [string] $Alias = 'gateflame',
    [ValidateSet('JKS', 'PKCS12')]
    [string] $StoreType = 'JKS',
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Rest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Native stdin encoding. Passphrases are restricted to printable ASCII below,
# precisely because this pipe (and Java .properties, which is ISO-8859-1) will
# quietly mangle anything else.
$OutputEncoding = [System.Text.Encoding]::ASCII

# -- Presentation -----------------------------------------------------------------------
function Write-Rule { Write-Host '------------------------------------------------------------------------' }
function Write-Ok   { param([string]$m) Write-Host "OK  $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "!   $m" -ForegroundColor Yellow }
function Write-Info { param([string]$m) Write-Host $m -ForegroundColor Cyan }
function Write-Fatal   { param([string]$m) Write-Host "X   $m" -ForegroundColor Red; exit 1 }

# -- Constants - the real Ionity identity, per android/KEYSTORE.md and docs/LINKS.md ----
$DName        = 'CN=Gate^Flame, OU=AEDI, O=Ionity (Pty) Ltd, L=Centurion, ST=Gauteng, C=ZA'
$ValidityDays = 10950      # 30 years - must outlive the product; see note below
$KeySize      = 4096
$KeyAlg       = 'RSA'
$SigAlg       = 'SHA256withRSA'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path     # ...\android
$PropsFile = Join-Path $ScriptDir 'keystore.properties'
if ([string]::IsNullOrWhiteSpace($Keystore)) {
    $Keystore = Join-Path $env:USERPROFILE '.gateflame-signing\gateflame-release.jks'
}

# -- Guard 0: no password may arrive as an argument -------------------------------------
if ($Rest -and $Rest.Count -gt 0) {
    if ($Rest -match 'pass') {
        Write-Fatal @"
Refusing: '$($Rest -join ' ')' looks like a password argument.
    Passwords are prompted for, never passed on the command line - parameters land
    in PSReadLine history (%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine) and
    in the process list.
"@
    }
    Write-Fatal "Unknown argument(s): $($Rest -join ' ')"
}

Write-Rule
Write-Host 'Gate^Flame - Android release keystore generation' -ForegroundColor White
Write-Rule
Write-Host 'This creates key material that CANNOT be regenerated, rotated, or recovered.'
Write-Host 'Read android\KEYSTORE.md first if you have not.'
Write-Host ''

# -- Guard 1: never in a container, a CI runner, or a cloud session ---------------------
$containerReasons = New-Object System.Collections.Generic.List[string]
foreach ($v in 'CI', 'GITHUB_ACTIONS', 'CODESPACES', 'GITLAB_CI', 'TF_BUILD',
                'JENKINS_URL', 'KUBERNETES_SERVICE_HOST', 'CODEBUILD_BUILD_ID') {
    $val = [Environment]::GetEnvironmentVariable($v)
    if (-not [string]::IsNullOrEmpty($val)) { $containerReasons.Add("`$env:$v is set") }
}
foreach ($p in '/.dockerenv', '/run/.containerenv', 'C:\.dockerenv') {
    if (Test-Path -LiteralPath $p -ErrorAction SilentlyContinue) { $containerReasons.Add("$p exists (container)") }
}
# Windows containers surface as this ContainerAdministrator/ContainerUser pair.
if ($env:USERNAME -in @('ContainerAdministrator', 'ContainerUser')) {
    $containerReasons.Add("running as $env:USERNAME (Windows container)")
}

if ($containerReasons.Count -gt 0) {
    Write-Host 'X   REFUSING TO GENERATE A SIGNING KEY HERE.' -ForegroundColor Red
    foreach ($r in $containerReasons) { Write-Host "      - $r" -ForegroundColor Red }
    Write-Host @'

  This looks like a container, a CI runner, or a cloud session.

  A release key created here is disclosed the moment it exists: the filesystem is
  ephemeral and shared, the passphrases you type may be captured, and anything that
  has to be copied out of here travels through a transcript, a log, or an artifact
  store. The key cannot be rotated afterwards - an APK signed with a different key
  can never update one already installed in the field.

  Run this on wabakipi itself, interactively, once:

      powershell -ExecutionPolicy Bypass -File android\generate-keystore.ps1

  CI never needs this script: it consumes GATEFLAME_KEYSTORE_PATH /
  GATEFLAME_KEYSTORE_PASSWORD / GATEFLAME_KEY_ALIAS / GATEFLAME_KEY_PASSWORD.
  See android\KEYSTORE.md step 5.
'@
    exit 1
}
Write-Ok 'Not a container/CI environment.'

# -- Guard 2: must be interactive, so passphrases can be prompted for ------------------
if (-not [Environment]::UserInteractive) {
    Write-Fatal @'
This session is not interactive.
    Passphrases must be typed at a prompt. This script will not read them from a
    pipe, a file, or an environment variable - those all leave copies behind.
'@
}
Write-Ok 'Interactive session.'

# -- Guard 3: keytool must be resolvable -----------------------------------------------
function Resolve-Keytool {
    $cmd = Get-Command keytool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # Each root is checked for emptiness first: Join-Path throws on a null Path,
    # and JAVA_HOME is frequently unset on a machine that only has Android Studio.
    $roots = @(
        @{ Base = $env:JAVA_HOME;      Tail = 'bin\keytool.exe' },
        @{ Base = $env:LOCALAPPDATA;   Tail = 'Programs\Android Studio\jbr\bin\keytool.exe' },
        @{ Base = ${env:ProgramFiles}; Tail = 'Android\Android Studio\jbr\bin\keytool.exe' },
        @{ Base = ${env:ProgramFiles}; Tail = 'Java\jdk-17\bin\keytool.exe' },
        @{ Base = ${env:ProgramW6432}; Tail = 'Android\Android Studio\jbr\bin\keytool.exe' }
    )
    foreach ($r in $roots) {
        if ([string]::IsNullOrWhiteSpace($r.Base)) { continue }
        $candidate = Join-Path $r.Base $r.Tail
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Get-MatchLine {
    # Safe single-line extraction: Select-String returns nothing when there is no
    # match, and .ToString() on that would throw under $ErrorActionPreference=Stop.
    param([string[]] $Lines, [string] $Pattern)
    if (-not $Lines) { return '' }
    $hit = $Lines | Select-String -Pattern $Pattern | Select-Object -First 1
    if ($null -eq $hit) { return '' }
    return $hit.ToString().Trim()
}

function Protect-FileAcl {
    # icacls is a native command: it does not throw on failure, it sets an exit
    # code. Checking $LASTEXITCODE is the only way to know whether it worked.
    param([string] $Path)
    & icacls $Path /inheritance:r /grant:r "$($env:USERNAME):(F)" 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}
$keytool = Resolve-Keytool
if (-not $keytool) {
    Write-Fatal @'
keytool.exe not found.
    Install a JDK (17 LTS is fine), or use the one Android Studio ships:
      %LOCALAPPDATA%\Programs\Android Studio\jbr\bin\keytool.exe
    Then re-run, or set JAVA_HOME.
'@
}
Write-Info "keytool: $keytool"

# -- Guard 4: never overwrite an existing keystore -------------------------------------
if (Test-Path -LiteralPath $Keystore) {
    Write-Fatal @"
A keystore already exists at:
      $Keystore

    REFUSING to touch it. Overwriting it would destroy the only copy of the key
    that signs every Gate^Flame APK already installed in the field - and there is
    no way to get it back.

    To inspect it instead:
      & '$keytool' -list -v -keystore '$Keystore' -alias '$Alias'

    If you are certain you want a NEW key (new applicationId, new app, every
    customer reinstalls), move the old file aside yourself, deliberately.
"@
}

$keystoreDir = Split-Path -Parent $Keystore
if (-not (Test-Path -LiteralPath $keystoreDir)) {
    New-Item -ItemType Directory -Path $keystoreDir -Force | Out-Null
    Write-Ok "Created $keystoreDir"
}

$repoRoot = Split-Path -Parent $ScriptDir
if ($keystoreDir.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Warn @"
That path is INSIDE the repository working tree.
    .gitignore covers *.jks, but a keystore git can never see is safer.
    Recommended: $env:USERPROFILE\.gateflame-signing\
"@
}

Write-Host ''
Write-Info 'About to generate:'
Write-Host "  keystore   : $Keystore"
Write-Host "  store type : $StoreType"
Write-Host "  alias      : $Alias"
Write-Host "  algorithm  : $KeyAlg $KeySize, $SigAlg"
Write-Host "  validity   : $ValidityDays days (~30 years)"
Write-Host "  dname      : $DName"
Write-Host ''
Write-Host 'Why 30 years: an expired key cannot sign an update, and Android will not'
Write-Host 'accept an APK re-signed with a replacement key. The key must outlive the'
Write-Host 'product, not the release cycle. Google Play additionally requires validity'
Write-Host 'past 2033.'
Write-Host ''
$proceed = Read-Host 'Proceed? [y/N]'
if ($proceed -notmatch '^(y|Y|yes|YES)$') { Write-Host 'Aborted. Nothing was written.'; exit 1 }

# -- Passphrase prompts ----------------------------------------------------------------
function ConvertFrom-SecureStringPlain {
    param([System.Security.SecureString] $Secure)
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try   { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Read-Passphrase {
    param([string] $Prompt, [int] $Min = 16)
    while ($true) {
        $s1 = Read-Host -Prompt $Prompt -AsSecureString
        $s2 = Read-Host -Prompt '  confirm' -AsSecureString
        $p1 = ConvertFrom-SecureStringPlain $s1
        $p2 = ConvertFrom-SecureStringPlain $s2
        $s1.Dispose(); $s2.Dispose()

        if ($p1 -cne $p2)      { Write-Warn 'They do not match. Again.'; continue }
        if ($p1.Length -lt $Min) {
            Write-Warn "Too short ($($p1.Length) chars, minimum $Min). This key has to hold for 30 years."
            continue
        }
        if ($p1.Contains('\')) {
            Write-Warn 'Backslashes are not usable here: Gradle reads keystore.properties as a Java properties file, where \ is an escape character.'
            continue
        }
        if ($p1 -ne $p1.Trim()) {
            Write-Warn 'Leading/trailing spaces are silently stripped by the properties reader.'
            continue
        }
        if ($p1 -match '[^\x20-\x7E]') {
            Write-Warn 'Non-ASCII characters. Gradle loads keystore.properties as ISO-8859-1, so these may not survive the round trip. Use printable ASCII.'
            continue
        }
        return $p1
    }
}

$storePw = $null
$keyPw   = $null
try {
    Write-Host ''
    Write-Rule
    Write-Host 'Passphrases' -ForegroundColor White
    Write-Rule
    Write-Host 'Generate them in your password manager NOW and paste them in - do not invent'
    Write-Host 'them here and promise to save them afterwards. Nothing is echoed.'
    Write-Host ''

    if ($StoreType -eq 'PKCS12') {
        Write-Host 'PKCS12 keystores cannot hold a key password different from the store'
        Write-Host 'password - one passphrase is used for both, and keystore.properties will'
        Write-Host 'carry the same value in storePassword and keyPassword.'
        Write-Host ''
        $storePw = Read-Passphrase 'Keystore passphrase (min 16 chars)'
        $keyPw   = $storePw
    }
    else {
        Write-Host 'JKS: use TWO different, long, randomly generated passphrases.'
        Write-Host ''
        $storePw = Read-Passphrase 'Store passphrase (min 16 chars)'
        $keyPw   = Read-Passphrase 'Key passphrase   (min 16 chars)'
        if ($storePw -ceq $keyPw) {
            Write-Warn 'Store and key passphrases are identical. Allowed, but one leak then loses both.'
            $c = Read-Host 'Continue anyway? [y/N]'
            if ($c -notmatch '^(y|Y|yes|YES)$') { Write-Fatal 'Aborted. Nothing was written.' }
        }
    }

    # -- Generate ----------------------------------------------------------------------
    # Passphrases go in on stdin, in the order keytool asks for them. They are NOT
    # passed as -storepass/-keypass: keytool's command line is visible in the process
    # list (Task Manager, Get-CimInstance Win32_Process) for as long as it runs.
    Write-Host ''
    Write-Info 'Generating (RSA 4096 takes a few seconds)...'

    $stdinLines = if ($StoreType -eq 'PKCS12') { @($storePw, $storePw) }
                  else { @($storePw, $storePw, $keyPw, $keyPw) }

    $genOut = $stdinLines | & $keytool -genkeypair -v `
        -keystore   $Keystore `
        -storetype  $StoreType `
        -alias      $Alias `
        -keyalg     $KeyAlg `
        -keysize    $KeySize `
        -sigalg     $SigAlg `
        -validity   $ValidityDays `
        -dname      $DName 2>&1
    $genExit = $LASTEXITCODE

    # The "JKS uses a proprietary format" note from keytool is expected and harmless:
    # Gradle and apksigner both read JKS. Convert later with -importkeystore if you
    # want PKCS12 - that re-wraps the same key, it does not create a new one.
    $genOut | ForEach-Object { Write-Host "    $_" }

    if ($genExit -ne 0) {
        if (Test-Path -LiteralPath $Keystore) { Remove-Item -LiteralPath $Keystore -Force }
        Write-Fatal "keytool failed (exit $genExit). Nothing usable was left behind."
    }
    if (-not (Test-Path -LiteralPath $Keystore) -or (Get-Item -LiteralPath $Keystore).Length -eq 0) {
        Write-Fatal "keytool reported success but $Keystore is empty."
    }

    # Lock the file down to this user only - no inherited group/Everyone access.
    if (Protect-FileAcl -Path $Keystore) {
        Write-Ok "Keystore written, ACL restricted to $($env:USERNAME): $Keystore"
    }
    else {
        Write-Warn "Keystore written, but could not restrict its ACL. Check it manually: icacls '$Keystore'"
    }

    # -- Verify it reads back and the private key unlocks ------------------------------
    Write-Host ''
    Write-Info 'Verifying the keystore reads back with the passphrase you typed...'
    $listOut = @($storePw) | & $keytool -list -v -keystore $Keystore -storetype $StoreType -alias $Alias 2>&1
    if ($LASTEXITCODE -ne 0) {
        $listOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Fatal 'Could not read the keystore back. Do not ship anything signed with it.'
    }

    $listLines = @($listOut | ForEach-Object { [string]$_ })
    $fpr       = Get-MatchLine -Lines $listLines -Pattern 'SHA-?256:'
    $validLine = Get-MatchLine -Lines $listLines -Pattern 'Valid from:'
    $keyLine   = Get-MatchLine -Lines $listLines -Pattern 'Subject Public Key Algorithm:'
    $sigLine   = Get-MatchLine -Lines $listLines -Pattern 'Signature algorithm name:'
    $entryLine = Get-MatchLine -Lines $listLines -Pattern 'Entry type:'

    if ($entryLine -like '*PrivateKeyEntry*') {
        Write-Ok 'Entry type is PrivateKeyEntry - signable.'
    }
    elseif ($entryLine) {
        Write-Fatal "Entry is '$entryLine', not a PrivateKeyEntry. This keystore cannot sign an APK."
    }
    else {
        Write-Warn 'Could not read the entry type from keytool output.'
    }

    # Prove the private key is usable, not merely that the file parses: -certreq has
    # to unlock the key itself. Closest read-only equivalent of signing.
    @($storePw, $keyPw) | & $keytool -certreq -keystore $Keystore -storetype $StoreType -alias $Alias 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok 'Private key unlocks with the key passphrase - this keystore can sign.'
    }
    else {
        Write-Warn 'Could not exercise the private key with -certreq. Verify before the first release build.'
    }

    Write-Host ''
    Write-Rule
    Write-Host 'Certificate' -ForegroundColor White
    Write-Rule
    if ($keyLine)   { Write-Host "  $keyLine" }
    if ($sigLine)   { Write-Host "  $sigLine" }
    if ($validLine) { Write-Host "  $validLine" }
    if ($fpr)       { Write-Host "  $fpr" -ForegroundColor White }
    else {
        Write-Warn 'Could not parse the SHA-256 fingerprint. Full keytool output:'
        $listOut | ForEach-Object { Write-Host "    $_" }
    }
    Write-Host ''
    Write-Host 'RECORD THAT FINGERPRINT NOW, somewhere durable and outside this machine.'
    Write-Host 'Every future release must show the same one:'
    Write-Host '    npm run build:apk            # prints the signing fingerprint'
    Write-Host '    node scripts\apk-fingerprint.mjs release\GateFlame-Mobile.apk'
    Write-Host 'If it ever differs, stop - you have signed with the wrong key, and shipping'
    Write-Host 'it strands every device already paired in the field.'

    # -- keystore.properties ----------------------------------------------------------
    Write-Host ''
    Write-Rule
    Write-Host 'android\keystore.properties' -ForegroundColor White
    Write-Rule

    # Gradle resolves storeFile relative to the android/ directory
    # (rootProject.file(...) in android/app/build.gradle). Forward slashes: the
    # value is read by java.util.Properties, where '\' is an escape character, so a
    # Windows path with backslashes would be silently corrupted.
    $storeFileValue = $Keystore -replace '\\', '/'

    if (Test-Path -LiteralPath $PropsFile) {
        Write-Warn "$PropsFile already exists - NOT overwriting it."
        Write-Host '  It may hold the credentials for a different (possibly the real) keystore.'
        Write-Host '  Update it yourself; the values for this keystore are:'
        Write-Host "    storeFile=$storeFileValue"
        Write-Host "    keyAlias=$Alias"
        Write-Host '    storePassword=<the store passphrase you just typed>'
        Write-Host '    keyPassword=<the key passphrase you just typed>'
    }
    else {
        $writeProps = Read-Host "Write $PropsFile now, with the passphrases you just typed? [y/N]"
        if ($writeProps -match '^(y|Y|yes|YES)$') {
            $lines = @(
                '# Gate^Flame Android release signing - LOCAL ONLY, NEVER COMMIT.',
                "# Generated by android\generate-keystore.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K').",
                '#',
                '# Read by android/app/build.gradle. storeFile is resolved relative to the',
                '# android/ directory; an absolute path with forward slashes is used here',
                '# because java.util.Properties treats \ as an escape character.',
                '#',
                '# This file contains plaintext passphrases. Its ACL is restricted and it is',
                '# gitignored. CI does NOT read it - CI uses GATEFLAME_KEYSTORE_PATH /',
                '# GATEFLAME_KEYSTORE_PASSWORD / GATEFLAME_KEY_ALIAS / GATEFLAME_KEY_PASSWORD.',
                '# See android/KEYSTORE.md.',
                "storeFile=$storeFileValue",
                "storePassword=$storePw",
                "keyAlias=$Alias",
                "keyPassword=$keyPw"
            )
            # ISO-8859-1, no BOM - exactly what java.util.Properties.load() expects.
            [System.IO.File]::WriteAllLines($PropsFile, $lines, [System.Text.Encoding]::GetEncoding('ISO-8859-1'))
            if (Protect-FileAcl -Path $PropsFile) {
                Write-Ok "Wrote $PropsFile (ACL restricted to $($env:USERNAME))."
            }
            else {
                Write-Warn "Wrote $PropsFile, but could not restrict its ACL. Check: icacls '$PropsFile'"
            }
        }
        else {
            Write-Host 'Skipped. Create it by hand when you are ready - template:'
            Write-Host ''
            Write-Host "    storeFile=$storeFileValue"
            Write-Host '    storePassword=<store passphrase>'
            Write-Host "    keyAlias=$Alias"
            Write-Host '    keyPassword=<key passphrase>'
            Write-Host ''
            Write-Host 'Gradle refuses to build an unsigned release without that file (or the'
            Write-Host 'GATEFLAME_KEYSTORE_* environment variables), so this is not optional'
            Write-Host 'before shipping.'
        }
    }
}
finally {
    # Passphrases have done their job. Drop them from this session's memory and
    # from the variable table, so a later transcript or Get-Variable cannot show them.
    $storePw = $null
    $keyPw   = $null
    Remove-Variable -Name storePw, keyPw -ErrorAction SilentlyContinue
    [System.GC]::Collect()
}

# -- Confirm the gitignore actually covers it -------------------------------------------
Write-Host ''
Write-Info 'Checking that git can never track the credentials...'
if (Get-Command git -ErrorAction SilentlyContinue) {
    $ignoreRule = & git -C $ScriptDir check-ignore -v -- $PropsFile 2>$null
    if ($LASTEXITCODE -eq 0 -and $ignoreRule) {
        Write-Ok "keystore.properties is ignored by: $ignoreRule"
    }
    else {
        Write-Host 'X   keystore.properties is NOT gitignored.' -ForegroundColor Red
        Write-Host '      Add these lines to .gitignore BEFORE your next commit:' -ForegroundColor Red
        Write-Host '          keystore.properties'
        Write-Host '          android/keystore.properties'
        Write-Host '          *.jks'
        Write-Host '          *.keystore'
    }
    $status = & git -C $ScriptDir status --short 2>$null
    if ($status -match 'keystore') {
        Write-Host 'X   git status mentions a keystore path. Do not commit. Fix .gitignore first.' -ForegroundColor Red
    }
}
else {
    Write-Warn 'git not on PATH - could not verify the ignore rules. Before your next commit run: git check-ignore -v android/keystore.properties'
}

# -- Backup checklist ------------------------------------------------------------------
Write-Host ''
Write-Rule
Write-Host 'BACK IT UP BEFORE THE FIRST SIGNED BUILD - 3 copies, 2 media, 1 off-site' -ForegroundColor White
Write-Rule
Write-Host @"

Do this NOW. The window where losing this key is cheap closes the moment the
first signed APK reaches a customer.

  [ ] Copy 1 - working copy, encrypted volume on this machine
                 $Keystore
  [ ] Copy 2 - offline encrypted USB, stored in a safe
                 NOT in the same building as copy 1
  [ ] Copy 3 - company password manager as a file attachment, or a sealed
                 envelope holding a printed base64 dump
                 (survives loss of both machines)

  [ ] Both passphrases stored in the password manager - SEPARATELY from the
        keystore file. A backup containing the file and both passwords together is
        a single point of compromise, not a single point of recovery.
  [ ] SHA-256 fingerprint recorded off-machine (printed above).
  [ ] Restore rehearsed once: copy the backup to a scratch path and run
        keytool -list -v -keystore <copy> -alias $Alias
        An untested backup is a hope, not a backup.
"@
Write-Host @"
UNRECOVERABLE IF LOST OR LEAKED - there is no reset and no support ticket:
  * The private key in $(Split-Path -Leaf $Keystore). It cannot be regenerated by anyone, ever.
  * The ability to ship ANY update to every Gate^Flame node already in the field.
    Android refuses an update signed by a different key, with no override.
  * The app identity today.ionity.gateflame on Google Play. Recovery means a new
    applicationId - a new app - and every customer uninstalling, reinstalling and
    re-pairing their node. Plan the comms, not the fix.
  * Every pairing on every customer handset, because reinstalling wipes it.
"@ -ForegroundColor Yellow
Write-Host @'
Never paste this keystore, its base64, or either passphrase into a chat window, an
AI session, a ticket, or an email. Anything pasted into a transcript is disclosed.
See android\KEYSTORE.md, "Handling rules".

Next: android\KEYSTORE.md step 4 - npm run build:apk, then compare the printed
fingerprint against the one above.
'@

exit 0

# ========================================================================================
# (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
# Governance: Policy 986 AED | Building Tomorrow, Today. | Anything is Possible with God.
# ========================================================================================
