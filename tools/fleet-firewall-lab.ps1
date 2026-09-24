# fleet-firewall-lab.ps1 - run elevated. Allows the fleet console (TCP 8091) from the LAB subnet only.
$name = 'GateFlame Fleet 8091 (lab only)'
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort 8091 -RemoteAddress 192.168.124.0/24 -Action Allow -Profile Any | Out-Null
Get-NetFirewallRule -DisplayName $name | Get-NetFirewallAddressFilter | Format-List | Out-File (Join-Path $PSScriptRoot 'fleet-firewall-lab.last.txt')
