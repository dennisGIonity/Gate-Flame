# probe-estate.ps1 — read-only reachability sweep of the live Gate^Flame estate.
# Prints one line per endpoint: status code + first 200 bytes. Never writes anything.
# Usage: powershell -NoProfile -File E:\Gateflame\tools\probe-estate.ps1
$ErrorActionPreference = 'Continue'
$urls = @(
  'http://192.168.0.10:8080/api/v1/system/status',
  'http://192.168.0.10:8080/api/v1/system/kiosk',
  'http://192.168.0.10:8080/api/v1/system/feed',
  'http://192.168.0.10:8080/api/v1/filtering',
  'http://192.168.0.10:8080/api/v1/vpn/regions',
  'http://192.168.0.10:8080/api/v1/clients',
  'http://192.168.0.10:8080/device-kiosk/',
  'http://192.168.0.13:8080/api/v1/system/status',
  'http://192.168.0.10:8081/admin/',
  'http://192.168.0.3:8091/healthz',
  'http://192.168.0.4:8091/healthz',
  'http://192.168.0.6:8091/healthz',
  'http://192.168.0.7:8091/healthz',
  'http://127.0.0.1:8091/healthz'
)
foreach ($u in $urls) {
  try {
    $r = Invoke-WebRequest -Uri $u -TimeoutSec 4 -UseBasicParsing
    $body = [string]$r.Content
    if ($body.Length -gt 200) { $body = $body.Substring(0,200) }
    Write-Output ("{0} -> {1} {2}" -f $u, $r.StatusCode, ($body -replace "`r|`n"," "))
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code) { Write-Output ("{0} -> {1}" -f $u, $code) }
    else { Write-Output ("{0} -> ERR {1}" -f $u, $_.Exception.Message) }
  }
}
Write-Output '--- DNS via the box (192.168.0.10) ---'
foreach ($n in 'doubleclick.net','ionity.today') {
  try { $a = Resolve-DnsName $n -Server 192.168.0.10 -Type A -ErrorAction Stop | Select-Object -First 1
        Write-Output ("{0} -> {1}" -f $n, $a.IPAddress) }
  catch { Write-Output ("{0} -> ERR {1}" -f $n, $_.Exception.Message) }
}
Write-Output '--- git identity in E:\Gateflame ---'
git -C E:\Gateflame config user.name
git -C E:\Gateflame config user.email
Write-Output '--- ssh agent ---'
& 'C:\Program Files\Git\usr\bin\ssh-add.exe' -l 2>&1
