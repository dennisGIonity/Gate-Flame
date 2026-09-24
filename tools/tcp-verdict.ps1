# tcp-verdict.ps1 <ip> — read-only. For each port says REFUSED (host up, nothing
# listening), TIMEOUT (dropped/filtered/asymmetric route) or OPEN. These need
# opposite actions and curl's "could not connect" hides which one you have.
param([string]$ip = '192.168.124.17')
foreach ($p in 22, 53, 8080, 8081, 80, 443) {
  $c = New-Object Net.Sockets.TcpClient
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $ar = $c.BeginConnect($ip, $p, $null, $null)
    $done = $ar.AsyncWaitHandle.WaitOne(6000)
    if (-not $done) { $verdict = 'TIMEOUT' }
    else { try { $c.EndConnect($ar); $verdict = 'OPEN' } catch { $verdict = 'REFUSED: ' + $_.Exception.InnerException.SocketErrorCode } }
  } catch { $verdict = 'ERR ' + $_.Exception.Message }
  $sw.Stop()
  Write-Output ("{0}:{1,-5} {2,-8} {3}ms" -f $ip, $p, $verdict, $sw.ElapsedMilliseconds)
  $c.Close()
}
Write-Output '--- UDP 53 ---'
try {
  $u = New-Object Net.Sockets.UdpClient
  $u.Client.ReceiveTimeout = 3000
  $u.Connect($ip, 53)
  # minimal A query for ionity.today
  $q = [byte[]](0x12,0x34,0x01,0x00,0,1,0,0,0,0,0,0, 6)+[Text.Encoding]::ASCII.GetBytes('ionity')+[byte[]](5)+[Text.Encoding]::ASCII.GetBytes('today')+[byte[]](0,0,1,0,1)
  [void]$u.Send($q, $q.Length)
  $ep = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0)
  $resp = $u.Receive([ref]$ep)
  Write-Output ("udp53 answered {0} bytes, rcode={1}" -f $resp.Length, ($resp[3] -band 0x0f))
} catch { Write-Output ("udp53 -> {0}" -f $_.Exception.Message) }
