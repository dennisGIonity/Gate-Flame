# wifi-scan.ps1 - which SSIDs/channels the laptop can see (read-only). Output -> wifi-scan.last.txt
& {
  "=== wifi-scan $(Get-Date -Format s) ==="
  (& "$env:SystemRoot\System32\netsh.exe" wlan show networks mode=bssid) | Where-Object { $_ -match 'SSID|Channel|Signal|Radio|Band' } | ForEach-Object { $_.Trim() }
} *>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'wifi-scan.last.txt')
