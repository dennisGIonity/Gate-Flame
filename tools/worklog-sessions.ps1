# Read-only: summarise Claude desktop session transcripts (*.jsonl) by day.
# Output: tools\worklog-sessions.last.csv (per session per day) and
#         tools\worklog-days.last.csv (merged active minutes per day, idle gap > $Gap min not counted)
param([string]$Since = '2026-08-25', [string]$Until = '2026-09-28', [int]$Gap = 20)
$roots = @("$env:APPDATA\Claude\local-agent-mode-sessions",
           "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions")
$s = [datetime]$Since; $u = ([datetime]$Until).AddDays(1)
$rx = '"timestamp"\s*:\s*"([^"]+)"'
$all = New-Object System.Collections.Generic.List[object]
$rows = @()
$files = Get-ChildItem $roots -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue |
         Where-Object { $_.LastWriteTime -ge $s -and $_.FullName -notmatch '\\subagents\\' }
foreach ($f in $files) {
  $sess = if ($f.FullName -match 'local-agent-mode-sessions\\[^\\]+\\[^\\]+\\([^\\]+)') { $Matches[1] } else { $f.Directory.Name }
  $first = $null
  $ts = New-Object System.Collections.Generic.List[datetime]
  foreach ($line in [System.IO.File]::ReadLines($f.FullName)) {
    if ($line -match $rx) {
      $t = ([datetimeoffset]::Parse($Matches[1])).ToOffset([timespan]::FromHours(2)).DateTime
      if ($t -ge $s -and $t -lt $u) { $ts.Add($t) }
    }
    if (-not $first -and $line -match '"type"\s*:\s*"user"' -and $line -match '"content"\s*:\s*"((?:[^"\\]|\\.){10,160})') { $first = $Matches[1] }
  }
  foreach ($t in $ts) { $all.Add($t) }
  $ts | Group-Object { $_.ToString('yyyy-MM-dd') } | ForEach-Object {
    $g = $_.Group | Sort-Object
    $rows += [pscustomobject]@{ date=$_.Name; session=$sess; start=$g[0].ToString('HH:mm'); end=$g[-1].ToString('HH:mm');
      events=$g.Count; file=$f.Name; firstPrompt=$first }
  }
}
$rows | Sort-Object date,start | Export-Csv "E:\.claude\Ionity\Gateflame\tools\worklog-sessions.last.csv" -NoTypeInformation -Encoding UTF8
$days = $all | Sort-Object | Group-Object { $_.ToString('yyyy-MM-dd') } | ForEach-Object {
  $g = $_.Group | Sort-Object; $min = 0.0
  for ($i=1; $i -lt $g.Count; $i++) { $d = ($g[$i]-$g[$i-1]).TotalMinutes; if ($d -le $Gap) { $min += $d } }
  [pscustomobject]@{ date=$_.Name; first=$g[0].ToString('HH:mm'); last=$g[-1].ToString('HH:mm'); activeHours=[math]::Round($min/60,1); events=$g.Count }
}
$days | Export-Csv "E:\.claude\Ionity\Gateflame\tools\worklog-days.last.csv" -NoTypeInformation -Encoding UTF8
$days | Format-Table -AutoSize | Out-String -Width 200
