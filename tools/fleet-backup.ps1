# ========================================================================================
# GATE^FLAME - BACK UP THE FLEET CONSOLE DATABASE (fleet\fleet.db)
# Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
# Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
# ========================================================================================
#
# WHY (launch scope C5)
# fleet.db is the customer trust store - the per-node tokens live there. Losing it 401s
# every box's own token at once (it happened on 2026-09-26: an empty console, 105 refused
# check-ins, a blank dashboard). Boxes on an agent with the BUG-30 fix then re-enrol by
# themselves with the shared enrolment token; boxes on older agents never fall back to
# it and stay refused until someone clears the token on the box itself; and until each
# box re-enrols, anyone holding the shared token could claim its node id. Support's
# forget-token (DELETE /api/v1/nodes/<id>/token) re-admits ONE box that lost its own
# token - it cannot rebuild a lost file. A backup can: every token that existed when it
# was taken still matches. History, admin records, the support log and the session key
# live in the same file.
#
# HOW
# SQLite's online backup API (Python stdlib sqlite3, Connection.backup): a consistent
# snapshot even while uvicorn is writing. A raw file copy is NOT - under WAL it can miss
# the last writes or tear a page. The copy is made a single self-contained file
# (journal_mode=DELETE), checked with PRAGMA integrity_check, and its row counts are
# printed as the read-back BEFORE it gets its final name. Only then are old backups
# pruned to the newest -Keep (default 30). A failed run renames nothing, prunes nothing.
#
#   tools\FLEET-BACKUP.cmd                                       (double-click)
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\fleet-backup.ps1
#   ... -Dest D:\other\folder -Keep 60                           (overrides)
#   Daily at 03:15: registered by tools\install-fleet-autostart.ps1.
#
# Writes ONLY to -Dest (default E:\Gateflame-backups\fleet\, beside the repo) and to its
# log tools\fleet-backup.last.txt (gitignored). Refuses a destination inside the repo:
# a copy of every box's token in the working tree is one `git add -A` from GitHub.
# Needs no secret and never reads fleet.env.ps1. Never starts or stops the fleet.
#
# RESTORE: stop the fleet; delete fleet\fleet.db-wal and fleet\fleet.db-shm if present
# (a stale WAL replayed onto a restored file corrupts it); copy the backup over
# fleet\fleet.db; start the fleet.
param(
    [string]$Db   = (Join-Path (Split-Path -Parent $PSScriptRoot) "fleet\fleet.db"),
    [string]$Dest = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "Gateflame-backups\fleet"),
    [ValidateRange(1, 3650)][int]$Keep = 30
)
# Continue, not Stop: in Windows PowerShell 5.1 a native command writing to stderr under
# Stop throws, even when redirected. Every failure below is checked explicitly.
$ErrorActionPreference = "Continue"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$log  = Join-Path $PSScriptRoot "fleet-backup.last.txt"
"FLEET-BACKUP $(Get-Date -Format s)" | Set-Content -LiteralPath $log -Encoding utf8
function Say([string]$m, [string]$c = "Gray") { Write-Host $m -ForegroundColor $c; Add-Content -LiteralPath $log -Value $m -Encoding utf8 }
function Stop-Backup([string]$m) { Say "ERROR: $m" Red; exit 1 }
function Get-FullPath([string]$p) {
    # .NET resolves a relative path against the PROCESS directory, which in PowerShell
    # is not necessarily $PWD - anchor it first, then normalise any ..
    if (-not [IO.Path]::IsPathRooted($p)) { $p = Join-Path (Get-Location).ProviderPath $p }
    return [IO.Path]::GetFullPath($p).TrimEnd('\')
}

$repoFull = Get-FullPath $repo
$destFull = Get-FullPath $Dest
$dbFull   = Get-FullPath $Db

# ------------------------------------------------------------------ refusals
if ($destFull -ieq $repoFull -or $destFull.StartsWith($repoFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
    Stop-Backup "refusing: destination $destFull is inside the repo ($repoFull). fleet.db holds every box's token; a copy in the working tree is one 'git add -A' from GitHub. Use a folder outside it (default: E:\Gateflame-backups\fleet)."
}
if (-not (Test-Path -LiteralPath $dbFull -PathType Leaf)) {
    Stop-Backup "no database at $dbFull - nothing to back up. (Has the fleet ever run from this folder?)"
}

function Find-Python {
    # Only the standard library is needed, so any Python 3 will do; prefer the fleet's own.
    $cands = @((Join-Path $repoFull "fleet\.venv\Scripts\python.exe"),
               "C:\Python314\python.exe", "C:\Python313\python.exe", "C:\Python312\python.exe")
    $onPath = Get-Command python -ErrorAction SilentlyContinue
    if ($onPath) { $cands += $onPath.Source }
    foreach ($c in $cands) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            & $c -c "import sqlite3" 2>$null
            if ($LASTEXITCODE -eq 0) { return $c }
        }
    }
    return $null
}
$py = Find-Python
if (-not $py) { Stop-Backup "no Python with sqlite3 found (looked in fleet\.venv, C:\Python314/313/312, PATH)." }

try { New-Item -ItemType Directory -Force -Path $destFull -ErrorAction Stop | Out-Null }
catch { Stop-Backup "cannot create ${destFull}: $($_.Exception.Message)" }

$stamp   = Get-Date -Format "yyyyMMdd-HHmm"
$final   = Join-Path $destFull "fleet-$stamp.db"
$partial = "$final.partial"

# ------------------------------------------------------------------ backup + read-back
# Fed to `python -` on stdin, so nothing in it passes through PowerShell's argument
# quoting; the three paths arrive as plain argv. Keep it ASCII ($OutputEncoding).
$code = @'
import os, sqlite3, sys
from pathlib import Path

src, partial, final = sys.argv[1], sys.argv[2], sys.argv[3]
if os.path.exists(partial):
    os.remove(partial)
# mode=rw opens the live file but can never CREATE one: a wrong path fails here
# instead of becoming an empty database that "backs up" as zero rows.
s = sqlite3.connect(Path(src).resolve().as_uri() + '?mode=rw', uri=True, timeout=30)
d = sqlite3.connect(partial)
try:
    s.backup(d)                              # online backup: consistent while uvicorn writes
    d.execute('PRAGMA journal_mode=DELETE')  # one self-contained file, no -wal/-shm beside it
finally:
    d.close()
    s.close()
# The read-back is taken from the COPY, opened read-only - not from the source.
c = sqlite3.connect(Path(partial).resolve().as_uri() + '?mode=ro', uri=True)
try:
    integrity = c.execute('PRAGMA integrity_check').fetchone()[0]
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    counts = [(t, c.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0])
              for t in ('nodes', 'tokens', 'samples', 'samples_hourly', 'node_admin', 'notes') if t in tables]
finally:
    c.close()
print('integrity_check=' + str(integrity))
for t, n in counts:
    print('rows.' + t + '=' + str(n))
missing = [t for t in ('nodes', 'tokens') if t not in tables]
if missing:
    print('not a fleet database: no table ' + ', '.join(missing))
    sys.exit(4)
if integrity != 'ok':
    sys.exit(3)
os.replace(partial, final)
print('saved=' + final)
'@

Say "Source : $dbFull"
Say "Backup : $final"
Say "Python : $py"
$out = $code | & $py - $dbFull $partial $final 2>&1
$rc = $LASTEXITCODE
Say "Read-back from the copy:" Cyan
foreach ($line in @($out)) { Say "  $line" }
if ($rc -ne 0) {
    Stop-Backup "backup did not complete (python exit $rc). Nothing was renamed or pruned; a $partial, if present, is kept for inspection."
}
if (-not (Test-Path -LiteralPath $final -PathType Leaf)) {
    Stop-Backup "python reported success but $final does not exist - not trusting that."
}

# ------------------------------------------------------------------ keep the newest $Keep
$all  = @(Get-ChildItem -LiteralPath $destFull -File | Where-Object { $_.Name -match '^fleet-\d{8}-\d{4}\.db$' } | Sort-Object Name -Descending)
$drop = @($all | Select-Object -Skip $Keep)
foreach ($f in $drop) {
    Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $f.FullName) { Say "  could not prune $($f.Name)" Yellow } else { Say "  pruned $($f.Name)" DarkGray }
}
Say ("OK: fleet-{0}.db saved ({1:N0} bytes); {2} backup(s) kept in {3} (limit {4})." -f `
    $stamp, (Get-Item -LiteralPath $final).Length, ($all.Count - $drop.Count), $destFull, $Keep) Green
Say "Log: $log" DarkGray
exit 0
