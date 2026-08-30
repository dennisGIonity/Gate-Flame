Get-PnpDevice | Where-Object { $_.Class -eq 'USB' -or $_.Status -ne 'OK' } | Select-Object FriendlyName, Status, Class, InstanceId | Format-Table -AutoSize -Wrap
