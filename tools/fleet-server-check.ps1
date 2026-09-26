# Gate^Flame - read-only HTTP check of the Ionity offline server (fleet + /gateflame bridge).
# Prints status codes only; credentials are read from fleet\fleet.env.ps1 and never printed.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\fleet-server-check.ps1
param([int]$FleetPort = 8091)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "..\fleet\fleet.env.ps1")
$pair = "$($env:GATEFLAME_FLEET_ADMIN_USER):$($env:GATEFLAME_FLEET_ADMIN_PASSWORD)"
$basic = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair)) }
Add-Type -AssemblyName System.Net.Http
# Windows PowerShell 5.1 does not offer TLS 1.2 by default; the Local Drive requires it.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$h = New-Object System.Net.Http.HttpClientHandler
$h.AllowAutoRedirect = $false
$h.ServerCertificateCustomValidationCallback = { $true }   # the Ionity CA may not be trusted by this shell
$cl = New-Object System.Net.Http.HttpClient($h)
$cl.Timeout = [TimeSpan]::FromSeconds(6)
function Probe([string]$label, [string]$url, [hashtable]$hdr = @{}) {
    $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $url)
    foreach ($k in $hdr.Keys) { [void]$req.Headers.TryAddWithoutValidation($k, $hdr[$k]) }
    try {
        $r = $cl.SendAsync($req).GetAwaiter().GetResult()
        $ct = if ($r.Content.Headers.ContentType) { $r.Content.Headers.ContentType.MediaType } else { "" }
        $loc = if ($r.Headers.Location) { " -> $($r.Headers.Location)" } else { "" }
        "{0,-44} {1} {2}{3}" -f $label, [int]$r.StatusCode, $ct, $loc
    } catch { "{0,-44} UNREACHABLE ({1})" -f $label, $_.Exception.InnerException.Message }
}
$f = "http://127.0.0.1:$FleetPort"
Probe "fleet /healthz" "$f/healthz"
Probe "fleet / (no session)" "$f/"
Probe "fleet /login" "$f/login"
Probe "fleet /api/v1/nodes (no auth)" "$f/api/v1/nodes"
Probe "fleet /api/v1/nodes (Basic)" "$f/api/v1/nodes" $basic
Probe "fleet / with X-Forwarded-Prefix (loopback)" "$f/" @{ "X-Forwarded-Prefix" = "/gateflame" }
foreach ($b in "http://127.0.0.1:8080", "http://127.0.0.1", "https://127.0.0.1", "https://127.0.0.1:8443") {
    Probe "bridge $b/gateflame/healthz" "$b/gateflame/healthz"
    Probe "bridge $b/gateflame/login" "$b/gateflame/login"
    Probe "bridge $b/gateflame/api/v1/nodes (no auth)" "$b/gateflame/api/v1/nodes"
}
try {
    $n = (Invoke-WebRequest "$f/api/v1/nodes" -Headers $basic -UseBasicParsing -TimeoutSec 6).Content | ConvertFrom-Json
    "boxes known to the fleet: $(@($n).Count)"
    foreach ($x in @($n)) { "  {0} status={1} lastSeen={2}s agent={3}" -f $x.nodeId, $x.status, $x.lastSeenAgoSeconds, $x.agentVersion }
} catch { "could not list boxes: $($_.Exception.Message)" }
