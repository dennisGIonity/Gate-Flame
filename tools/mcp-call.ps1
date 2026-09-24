# mcp-call.ps1 <tool> '<json-args>' - call the ESP32-MCP fleet MCP server (JSON-RPC over HTTP, same tools as the stdio server).
param([Parameter(Mandatory)][string]$Tool, [string]$ArgsJson = '{}')
$body = @{ jsonrpc = '2.0'; id = 1; method = 'tools/call'; params = @{ name = $Tool; arguments = ($ArgsJson | ConvertFrom-Json) } } | ConvertTo-Json -Depth 10
$r = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8099/api/v1/mcp/rpc' -ContentType 'application/json' -Body $body -TimeoutSec 20
if ($r.error) { "MCP error: $($r.error | ConvertTo-Json -Depth 6)" }
else { ($r.result.content | ForEach-Object { $_.text }) -join "`n" }
