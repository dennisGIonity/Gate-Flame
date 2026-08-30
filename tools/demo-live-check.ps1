Write-Output '--- PORT 8090 (node-agent) ---'
Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue | Format-Table -AutoSize
Write-Output '--- PORT 3000 (vite) ---'
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Format-Table -AutoSize

Write-Output '--- curl 8090 status ---'
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/api/v1/system/status' -UseBasicParsing -TimeoutSec 5
  Write-Output ("OK " + $r.StatusCode + " " + $r.Content)
} catch {
  Write-Output ("FAIL: " + $_.Exception.Message)
}

Write-Output '--- curl 3000 ---'
try {
  $r2 = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 5
  Write-Output ("OK " + $r2.StatusCode)
} catch {
  Write-Output ("FAIL: " + $_.Exception.Message)
}
