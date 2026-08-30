try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/v1/system/status' -UseBasicParsing -TimeoutSec 8
  Write-Output ("OK " + $r.StatusCode + " " + $r.Content)
} catch {
  Write-Output ("FAIL: " + $_.Exception.Message)
}
