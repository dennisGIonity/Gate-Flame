$r = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/api/v1/pair/request' -Method POST -UseBasicParsing -TimeoutSec 8
Write-Output $r.Content
