# Gate^Flame - clear the C: drive copies that E:\Gateflame has superseded.
# Written 2026-09-20 after the reconcile in docs/C-DRIVE-RECONCILE-2026-09-20.md.
#
# Everything goes to the RECYCLE BIN, not a hard delete. Recoverable.
# Run with -WhatIf first. Nothing runs unless you pass -Confirm.
#
#   powershell -File tools\_clear-c-drive-copies.ps1 -WhatIf
#   powershell -File tools\_clear-c-drive-copies.ps1 -Confirm
#
# NEVER TOUCHED, by design:
#   C:\Users\DGMic\.gateflame-signing          the release keystore
#   C:\Users\DGMic\OneDrive\GateFlame-Signing  its off-machine copy
#   C:\Users\DGMic\Downloads\GF Files          invoices, quotes, PoC docs, brand package
#
# STAGE 2 items are held back on purpose. See the notes beside them.

param([switch]$WhatIf, [switch]$Confirm)

Add-Type -AssemblyName Microsoft.VisualBasic

$stage1 = @(
  'C:\Users\DGMic\GateFlame-Repo',
  'C:\Users\DGMic\gf-scratch',
  'C:\Users\DGMic\TempGateFlameBuild'
)

$stage1Files = @(
  'C:\Users\DGMic\GateFlame-Backup-2026-08-13\TempGateFlameBuild.zip',
  'C:\Users\DGMic\GateFlame-Backup-2026-08-13\TempGateFlameBuild-full.zip',
  'C:\Users\DGMic\gateflame-fleet-secrets.txt'
)

# Held back:
#   E-App-SAFETY-2026-08-16.bundle -> only after docs/archive/lost-backend is PUSHED
#   TempGateFlameBuild\.env.local  -> only after GEMINI_API_KEY is REVOKED at Google
$stage2 = @(
  'C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\E-App-SAFETY-2026-08-16.bundle'
)

function Recycle($path) {
  if (-not (Test-Path $path)) { Write-Host "  skip (absent): $path"; return }
  $size = (Get-ChildItem $path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if (-not $size) { $size = (Get-Item $path).Length }
  $label = "{0,8:N1} MB  {1}" -f ($size / 1MB), $path
  if ($WhatIf -or -not $Confirm) { Write-Host "  WOULD RECYCLE  $label"; return }
  if (Test-Path $path -PathType Container) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
  } else {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
  }
  Write-Host "  RECYCLED       $label"
}

Write-Host ''
Write-Host 'STAGE 1 - superseded, verified contained in E:\Gateflame'
foreach ($p in $stage1 + $stage1Files) { Recycle $p }

Write-Host ''
Write-Host 'STAGE 2 - held back until the two preconditions are met'
foreach ($p in $stage2) {
  if (-not (Test-Path $p)) { Write-Host "  skip (absent): $p"; continue }
  Write-Host ("  HELD  {0,8:N1} MB  {1}" -f ((Get-Item $p).Length / 1MB), $p)
  Write-Host '        release only after: git push origin fix/mobile-dns-drops'
}
Write-Host ''
Write-Host 'NOT IN SCOPE (keep): .gateflame-signing, OneDrive\GateFlame-Signing, Downloads\GF Files'
Write-Host 'STILL OPEN: revoke GEMINI_API_KEY at https://aistudio.google.com/apikey,'
Write-Host '            then delete C:\Users\DGMic\TempGateFlameBuild\.env.local'
Write-Host ''
if ($WhatIf -or -not $Confirm) { Write-Host 'Dry run. Re-run with -Confirm to act.' }
