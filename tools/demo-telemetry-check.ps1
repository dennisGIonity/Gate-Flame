try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/api/v1/telemetry/summary' -UseBasicParsing -TimeoutSec 8
  Write-Output ("OK " + $r.StatusCode)
  Write-Output $r.Content
} catch {
  Write-Output ("FAIL: " + $_.Exception.Message)
}
