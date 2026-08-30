try {
  $r = Invoke-WebRequest -Uri 'http://localhost:8090/api/v1/system/status' -UseBasicParsing -TimeoutSec 5
  Write-Output ("STATUS " + $r.StatusCode)
  Write-Output $r.Content
} catch {
  Write-Output ("ERROR: " + $_.Exception.Message)
}
