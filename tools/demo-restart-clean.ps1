foreach ($port in 8090, 3000) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    Write-Output ("Killing PID " + $c.OwningProcess + " on port " + $port)
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 2
Write-Output '--- after cleanup ---'
Get-NetTCPConnection -LocalPort 8090,3000 -State Listen -ErrorAction SilentlyContinue | Format-Table -AutoSize
