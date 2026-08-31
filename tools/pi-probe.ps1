# Ask the live node what it actually has, from any LAN machine, with no SSH.
#
# WHY THIS EXISTS
# The VPN Shield UI was built, shipped and manually reviewed while every
# /vpn/* route on the real box returned 404 - the backend had never been
# deployed there. Nobody caught it because the UI failed *quietly*: an empty
# list looks the same whether the feature is missing or merely has nothing to
# show. This probe makes that distinction cheap and unambiguous:
#
#   404      -> the route was never installed on this box
#   401/403  -> the route is installed and refusing an unauthenticated caller
#   200      -> open route (only /system/* is)
#
# Run it before believing any claim that a feature is "deployed".
param([string]$Node = "192.168.0.10", [int]$Port = 8080)

$base = "http://${Node}:${Port}/api/v1"

function Probe($path) {
    try {
        $r = Invoke-WebRequest -Uri "$base$path" -Method GET -TimeoutSec 6 -UseBasicParsing -ErrorAction Stop
        $body = $r.Content.Substring(0, [Math]::Min(160, $r.Content.Length))
        return "$($r.StatusCode)  $body"
    } catch {
        $resp = $_.Exception.Response
        if ($resp) { return "$([int]$resp.StatusCode)  (installed, auth required)" }
        return "unreachable: $($_.Exception.Message)"
    }
}

Write-Output "=== node $Node ==="
foreach ($p in @(
    '/system/status',
    '/vpn/regions', '/vpn/continents', '/vpn/devices',
    '/clients', '/filtering', '/telemetry/summary'
)) {
    Write-Output ("{0,-22} {1}" -f $p, (Probe $p))
}

# The kiosk is served as a static bundle with content-hashed filenames, so the
# hashes ARE the version. Compare them against dist-kiosk/ after a build to see
# whether the box is running current code - a far more reliable answer than
# anyone's memory of the last deploy.
Write-Output ""
Write-Output "=== kiosk bundle the box is serving ==="
try {
    $k = Invoke-WebRequest -Uri "http://${Node}:${Port}/device-kiosk" -TimeoutSec 6 -UseBasicParsing
    Write-Output "  HTTP $($k.StatusCode), $($k.Content.Length) bytes"
    [regex]::Matches($k.Content, 'assets/([A-Za-z0-9.\-]+\.(?:js|css))') |
        ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique |
        ForEach-Object { "  $_" }
} catch {
    Write-Output "  $($_.Exception.Message)"
}

$local = Join-Path $PSScriptRoot "..\dist-kiosk\assets"
if (Test-Path $local) {
    Write-Output ""
    Write-Output "=== freshly built locally (dist-kiosk/assets) ==="
    Get-ChildItem $local -File | ForEach-Object { "  $($_.Name)" }
    Write-Output ""
    Write-Output "  Names differing between the two lists = the box is STALE."
}
