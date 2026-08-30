$body = @{ region = 'JP'; enabled = $true; provider = 'vpngate' } | ConvertTo-Json
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/api/v1/vpn/devices/02:00:00:00:00:01' `
    -Method PUT -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 10
  Write-Output ("STATUS " + $r.StatusCode)
  Write-Output $r.Content
} catch {
  Write-Output ("ERROR: " + $_.Exception.Message)
  if ($_.Exception.Response) {
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    Write-Output $reader.ReadToEnd()
  }
}
