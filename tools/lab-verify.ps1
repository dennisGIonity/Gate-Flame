# lab-verify.ps1 - read-back of Gate^Flame on the lab from the laptop. Output -> lab-verify.last.txt
$pi = '192.168.124.3'
& {
  "=== lab-verify $(Get-Date -Format s) ==="
  foreach ($n in 'ionity.today','google.com','doubleclick.net') {
    try { $r = Resolve-DnsName $n -Server $pi -Type A -DnsOnly -ErrorAction Stop | Where-Object IPAddress; "dns $n -> $(($r.IPAddress) -join ', ')" } catch { "dns $n -> $($_.Exception.Message)" }
  }
  foreach ($route in 'system/status','filtering/state','telemetry','clients') {
    try { $w = Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 "http://${pi}:8080/api/v1/$route"; "GET /$route -> $($w.StatusCode) $($w.Content.Substring(0,[Math]::Min(220,$w.Content.Length)))" }
    catch { $c = $_.Exception.Response.StatusCode.value__; "GET /$route -> $c" }
  }
  try { $k = Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 "http://${pi}:8080/device-kiosk/"; "kiosk -> $($k.StatusCode)" } catch { "kiosk -> $($_.Exception.Message)" }
  "household still resolves: " + ((Resolve-DnsName google.com -Server 192.168.0.1 -Type A -DnsOnly | Where-Object IPAddress | Select-Object -First 1).IPAddress)
  "Pi on household (.0.11) ping: " + (Test-Connection 192.168.0.11 -Count 1 -Quiet)
} *>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'lab-verify.last.txt')
