# Gate^Flame — smoke test. Runs the whole check suite on wabakipi and writes
# one log so a long run can be read back later instead of blocking a shell.
#
#   powershell -File tools\smoke.ps1              # tsc + vitest + pytest
#   powershell -File tools\smoke.ps1 -Build       # + kiosk/mobile bundles
#
# Log: release\logs\smoke-<timestamp>.log  (release/ is gitignored)
# Exit code is non-zero if any stage failed. Every stage prints its own
# exit code, so a green summary line cannot be produced by an echo.
param([switch]$Build)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$env:NODE_ENV = ''            # wabakipi has NODE_ENV=production globally; that strips devDeps
$logDir = Join-Path $root 'release\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $logDir "smoke-$stamp.log"
$failed = @()

function Stage($name, [scriptblock]$body) {
  "`n===== $name  ($(Get-Date -Format 'HH:mm:ss')) =====" | Tee-Object -FilePath $log -Append
  & $body 2>&1 | Tee-Object -FilePath $log -Append
  $code = $LASTEXITCODE
  "----- $name exit=$code" | Tee-Object -FilePath $log -Append
  if ($code -ne 0) { $script:failed += $name }
}

Stage 'tsc'    { npx tsc --noEmit }
Stage 'vitest' { npx vitest run --reporter=dot }
Stage 'pytest' { Push-Location node-agent; python -m pytest -q -p no:cacheprovider; Pop-Location }
Stage 'pytest-feed' { Push-Location feed-receiver; python -m pytest -q -p no:cacheprovider; Pop-Location }
if ($Build) {
  Stage 'build:html-kiosk'  { npm run build:html-kiosk }
  Stage 'build:html-mobile' { npm run build:html-mobile }
}

"`n===== SUMMARY =====" | Tee-Object -FilePath $log -Append
if ($failed.Count -eq 0) { "ALL STAGES PASSED" | Tee-Object -FilePath $log -Append; exit 0 }
"FAILED: $($failed -join ', ')" | Tee-Object -FilePath $log -Append
exit 1
