# lab-probe.ps1 - read-only snapshot of the Ionity lab (H3C 192.168.124.0/24).
# Never touches the household TP-Link. Output -> tools\lab-probe.last.txt
$out = Join-Path $PSScriptRoot 'lab-probe.last.txt'
& {
  "=== lab-probe $(Get-Date -Format s) ==="
  "--- adapters (IPv4) ---"
  Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } |
    Select-Object InterfaceAlias, IPAddress, PrefixLength | Format-Table -AutoSize | Out-String
  "--- default routes ---"
  Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object InterfaceAlias, NextHop, RouteMetric, InterfaceMetric | Format-Table -AutoSize | Out-String
  "--- DNS servers per adapter ---"
  Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object ServerAddresses | Select-Object InterfaceAlias, ServerAddresses | Format-Table -AutoSize | Out-String
  "--- lab sweep 192.168.124.1-60 (ping) ---"
  $jobs = 1..60 | ForEach-Object { $ip = "192.168.124.$_"; [pscustomobject]@{ ip=$ip; t=(New-Object Net.NetworkInformation.Ping).SendPingAsync($ip, 600) } }
  foreach ($j in $jobs) { try { $r = $j.t.Result; if ($r.Status -eq 'Success') { "UP  $($j.ip)  $($r.RoundtripTime)ms" } } catch {} }
  "--- neighbours on 124 ---"
  Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.124.*' -and $_.State -ne 'Unreachable' } |
    Select-Object IPAddress, LinkLayerAddress, State | Format-Table -AutoSize | Out-String
  "--- TCP verdicts on Pi candidates ---"
  $pi = Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.LinkLayerAddress -match '^88-A2-9E' } | Select-Object -ExpandProperty IPAddress -Unique
  if (-not $pi) { $pi = @('192.168.124.17','192.168.124.18') }
  foreach ($ip in $pi) {
    foreach ($port in 22,53,8080,8081) {
      $c = New-Object Net.Sockets.TcpClient
      try { $a = $c.BeginConnect($ip, $port, $null, $null); if ($a.AsyncWaitHandle.WaitOne(1500)) { try { $c.EndConnect($a); $v='OPEN' } catch { $v='REFUSED' } } else { $v='TIMEOUT' } } finally { $c.Close() }
      "$ip :$port  $v"
    }
  }
  "--- /system/status ---"
  foreach ($ip in $pi) { try { "$ip -> " + (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "http://${ip}:8080/api/v1/system/status").Content } catch { "$ip -> $($_.Exception.Message)" } }
  "--- ssh agent (git-bash) ---"
  & 'C:\Program Files\Git\bin\bash.exe' -lc 'ssh-add -l 2>&1 | head -3'
} *>&1 | Tee-Object -FilePath $out
