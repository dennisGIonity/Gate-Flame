try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/api/v1/vpn/regions' -UseBasicParsing -TimeoutSec 5
  Write-Output $r.Content
} catch {
  Write-Output ("REGIONS ERROR: " + $_.Exception.Message)
}
Write-Output '---CONTINENTS---'
try {
  $r2 = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/api/v1/vpn/continents' -UseBasicParsing -TimeoutSec 8
  Write-Output $r2.Content
} catch {
  Write-Output ("CONTINENTS ERROR: " + $_.Exception.Message)
}
