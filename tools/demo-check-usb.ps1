Get-PnpDevice | Where-Object { $_.FriendlyName -match 'android|adb|phone|mobile|MTP|composite' } | Select-Object FriendlyName, Status, Class | Format-Table -AutoSize
