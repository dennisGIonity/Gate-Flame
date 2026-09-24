# lab-sweep.ps1 - who is on the lab subnet (ping 1-254 + ARP, OUI hints). Output -> lab-sweep.last.txt
& {
  "=== lab-sweep $(Get-Date -Format s) ==="
  $jobs = 1..254 | ForEach-Object { $ip = "192.168.124.$_"; [pscustomobject]@{ ip=$ip; t=(New-Object Net.NetworkInformation.Ping).SendPingAsync($ip, 700) } }
  $up = foreach ($j in $jobs) { try { if ($j.t.Result.Status -eq 'Success') { $j.ip } } catch {} }
  Start-Sleep 1
  $oui = @{ '88-A2-9E'='Raspberry Pi'; '2C-CF-67'='Raspberry Pi'; 'D8-3A-DD'='Raspberry Pi'; '00-08-DC'='WIZnet (W5500 Ethernet)';
            '28-CD-C1'='Raspberry Pi (Pico W)'; '34-CA-81'='H3C'; '40-C2-BA'='laptop'; 'EC-DA-3B'='Espressif'; '24-58-7C'='Espressif'; '98-A3-16'='Espressif'; 'FC-01-2C'='Espressif' }
  $n = Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.124.*' -and $_.LinkLayerAddress -notmatch '^(00-00-00|FF-FF)' }
  foreach ($x in ($n | Sort-Object { [int]($_.IPAddress.Split('.')[3]) } -Unique)) {
    $v = $oui[$x.LinkLayerAddress.Substring(0,8)]
    "{0,-16} {1}  {2,-26} ping={3}" -f $x.IPAddress, $x.LinkLayerAddress, $v, ($up -contains $x.IPAddress)
  }
  "up (ping): $($up -join ', ')"
} *>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'lab-sweep.last.txt')
