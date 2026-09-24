# probe-pi-v6.ps1 — when the box has no IPv4 on our subnet, try it over the IPv6
# link-local address mDNS hands back for raspberrypi.local. Read-only.
$ErrorActionPreference = 'Continue'
$v6 = (Resolve-DnsName raspberrypi.local -Type AAAA -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
if (-not $v6) { $v6 = (Resolve-DnsName raspberrypi.local -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress }
Write-Output ("raspberrypi.local -> {0}" -f $v6)
$ifs = Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -ExpandProperty ifIndex
foreach ($i in $ifs) {
  foreach ($p in 8080, 22, 53, 8081) {
    $c = New-Object Net.Sockets.TcpClient
    try {
      $addr = [Net.IPAddress]::Parse("$v6%$i")
      $ar = $c.BeginConnect($addr, $p, $null, $null)
      $ok = $ar.AsyncWaitHandle.WaitOne(2000) -and $c.Connected
      Write-Output ("if{0} [{1}]:{2} open={3}" -f $i, $v6, $p, $ok)
      if ($ok -and $p -eq 8080) {
        try { $r = Invoke-WebRequest -Uri ("http://[{0}%{1}]:8080/api/v1/system/status" -f $v6, $i) -TimeoutSec 5 -UseBasicParsing
              Write-Output ("  status -> {0} {1}" -f $r.StatusCode, $r.Content) }
        catch { Write-Output ("  status -> {0}" -f $_.Exception.Message) }
      }
    } catch { Write-Output ("if{0} port {1} ERR {2}" -f $i, $p, $_.Exception.Message) }
    $c.Close()
  }
}
Write-Output '--- neighbours (v4) ---'
Get-NetNeighbor -AddressFamily IPv4 -State Reachable,Stale | Where-Object { $_.IPAddress -like '192.168.*' } | Format-Table IPAddress,LinkLayerAddress,State -AutoSize | Out-String
Write-Output '--- Pi MAC candidates (dc:a6:32 / e4:5f:01 / d8:3a:dd / 2c:cf:67 = Raspberry Pi OUIs) ---'
Get-NetNeighbor | Where-Object { $_.LinkLayerAddress -match '^(DC-A6-32|E4-5F-01|D8-3A-DD|2C-CF-67|B8-27-EB)' } | Format-Table IPAddress,LinkLayerAddress,State -AutoSize | Out-String
