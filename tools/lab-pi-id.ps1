# lab-pi-id.ps1 - identify which box answers where (read-only).
& {
  Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.LinkLayerAddress -match '^(88-A2-9E|2C-CF-67|D8-3A-DD|DC-A6-32|E4-5F-01|B8-27-EB)' } | Select-Object IPAddress, LinkLayerAddress, State, InterfaceAlias | Format-Table -AutoSize | Out-String
  foreach ($n in 'raspberrypi.local','gateflame.local','raspberrypi') { try { "$n -> " + ((Resolve-DnsName $n -ErrorAction Stop | Where-Object IPAddress | Select-Object -ExpandProperty IPAddress) -join ', ') } catch { "$n -> no answer" } }
  "--- ssh banner 192.168.0.11 ---"
  $c = New-Object Net.Sockets.TcpClient('192.168.0.11',22); $s=$c.GetStream(); Start-Sleep -Milliseconds 800; $b=New-Object byte[] 256; $n=$s.Read($b,0,256); [Text.Encoding]::ASCII.GetString($b,0,$n); $c.Close()
  "--- H3C 192.168.124.1 web ---"
  try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 http://192.168.124.1/; "HTTP $($r.StatusCode) title: " + ([regex]::Match($r.Content,'<title>(.*?)</title>').Groups[1].Value) } catch { $_.Exception.Message }
} *>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'lab-pi-id.last.txt')
