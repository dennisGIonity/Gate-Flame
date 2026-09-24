# find-box.ps1 — locate a Gate^Flame node / fleet server on the CURRENT subnet.
# Read-only. Sweeps every routable /24 this machine sits on for :8080 (agent),
# :8091 (fleet), :8081 (Pi-hole admin), :53 (DNS), :22 (ssh), then asks any :8080 hit
# for /system/status. Windows PowerShell 5.1 compatible (no ThreadJob).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File E:\Gateflame\tools\find-box.ps1
$subnets = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixLength -le 24 } |
  ForEach-Object { ($_.IPAddress -split '\.')[0..2] -join '.' } | Sort-Object -Unique
Write-Output ("Subnets: " + ($subnets -join ', '))
$ports = 8080, 8091, 8081, 53, 22
$hits = @()
foreach ($s in $subnets) {
  $pending = @()
  foreach ($i in 1..254) {
    foreach ($p in $ports) {
      $c = New-Object Net.Sockets.TcpClient
      $ar = $c.BeginConnect("$s.$i", $p, $null, $null)
      $pending += [pscustomobject]@{ ip="$s.$i"; port=$p; client=$c; ar=$ar }
    }
  }
  Start-Sleep -Milliseconds 1500
  foreach ($x in $pending) {
    if ($x.ar.IsCompleted -and $x.client.Connected) { $hits += "$($x.ip):$($x.port)" }
    try { $x.client.Close() } catch {}
  }
}
Write-Output '--- open ports ---'
$hits | Sort-Object | ForEach-Object { Write-Output $_ }
Write-Output '--- identify ---'
foreach ($h in ($hits | Where-Object { $_ -like '*:8080' })) {
  $ip = ($h -split ':')[0]
  try { $r = Invoke-WebRequest -Uri "http://$ip`:8080/api/v1/system/status" -TimeoutSec 4 -UseBasicParsing
        Write-Output ("agent {0} -> {1} {2}" -f $ip, $r.StatusCode, $r.Content) }
  catch { Write-Output ("agent {0} -> {1}" -f $ip, $_.Exception.Message) }
}
foreach ($h in ($hits | Where-Object { $_ -like '*:8091' })) {
  $ip = ($h -split ':')[0]
  try { $r = Invoke-WebRequest -Uri "http://$ip`:8091/healthz" -TimeoutSec 4 -UseBasicParsing
        Write-Output ("fleet {0} -> {1} {2}" -f $ip, $r.StatusCode, $r.Content) }
  catch { Write-Output ("fleet {0} -> {1}" -f $ip, $_.Exception.Message) }
}
Write-Output '--- mDNS / hostname ---'
foreach ($n in 'raspberrypi.local','raspberrypi','gateflame.local') {
  try { $a = Resolve-DnsName $n -ErrorAction Stop | Select-Object -First 1; Write-Output ("{0} -> {1}" -f $n, $a.IPAddress) }
  catch { Write-Output ("{0} -> no answer" -f $n) }
}
