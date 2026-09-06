<#
    prove-it.ps1 - does Gate^Flame actually protect this network, right now?

    Asks the only two questions that matter, the way a customer's laptop would:
    by resolving real domains and looking at the answer. It reads no dashboard
    and trusts nothing the product says about itself.

      Q1  Does the BOX block?          (ask the box directly)
      Q2  Does THIS MACHINE get it?    (ask whatever DNS this machine really uses)

    Q1 can pass while Q2 fails. That is the state this repo shipped in on
    2026-09-06: a working filter that nothing on the LAN was pointed at.

    THREE ANSWER STATES, never two. v1 of this script called a failed lookup
    "not filtered", which is a lie of exactly the kind it exists to catch:
    "no answer" is not "allowed through". A dead resolver and an open one look
    nothing alike and must never print the same verdict.

    It also names the adapter its DNS came from. On 2026-09-06 a USB-tethered
    phone (metric 25) silently outranked Wi-Fi (metric 30), took the default
    route, and pointed DNS at a gateway that answered nothing - which had
    nothing to do with Gate^Flame but looked, in v1's output, exactly like it.

    Exit codes
      0  protected
      1  box blocks, this machine does not get it   (the cutover is missing)
      2  box itself is not blocking
      3  box unreachable
      4  this machine's DNS path is broken - verdict impossible

    Usage
      powershell -ExecutionPolicy Bypass -File tools\prove-it.ps1
      ... -Box 192.168.0.10        test a different box
      ... -Via 192.168.0.1         force which resolver counts as "the household"
#>
[CmdletBinding()]
param(
  [string]$Box = '192.168.0.10',
  [string]$Via,
  [string[]]$ShouldBlock   = @('doubleclick.net','ads.google.com','pornhub.com','xhamster.com'),
  [string[]]$ShouldResolve = @('ionity.today','github.com')
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
$BLOCKED_ANSWERS = @('0.0.0.0','127.0.0.1','::','::1')

# ---- three states, never two -------------------------------------------------
function Resolve-Via {
  param([string]$Name, [string]$Server)
  try {
    $rec = Resolve-DnsName -Name $Name -Server $Server -Type A -DnsOnly -QuickTimeout -EA Stop |
           Where-Object { $_.QueryType -eq 'A' } | Select-Object -First 1
    if (-not $rec) { return @{ state = 'BLOCKED'; ip = '(NXDOMAIN / no A record)' } }
    if ($BLOCKED_ANSWERS -contains $rec.IPAddress) { return @{ state = 'BLOCKED'; ip = $rec.IPAddress } }
    return @{ state = 'ALLOWED'; ip = $rec.IPAddress }
  } catch {
    return @{ state = 'NOANSWER'; ip = 'no answer from resolver' }
  }
}

function Line { param($s) Write-Host $s }
function Pass { param($s) Write-Host ("  PASS  " + $s) -ForegroundColor Green }
function Fail { param($s) Write-Host ("  FAIL  " + $s) -ForegroundColor Red }
function Warn { param($s) Write-Host ("  WARN  " + $s) -ForegroundColor Yellow }

Line ""
Line "=================================================================="
Line " Gate^Flame - PROVE IT.  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Line "=================================================================="

# ---- which resolver does this machine ACTUALLY use? --------------------------
# The adapter carrying the default route wins, not the first one enumerated.
$defRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -EA SilentlyContinue |
            Sort-Object InterfaceMetric, RouteMetric | Select-Object -First 1
$viaAlias = $defRoute.InterfaceAlias
$viaDesc  = (Get-NetAdapter -InterfaceIndex $defRoute.ifIndex -EA SilentlyContinue).InterfaceDescription

if ($Via) {
  $myDns = $Via; $viaAlias = "(forced by -Via)"; $viaDesc = ''
} else {
  $myDns = (Get-DnsClientServerAddress -InterfaceIndex $defRoute.ifIndex -AddressFamily IPv4 -EA SilentlyContinue).ServerAddresses |
           Select-Object -First 1
}

Line ""
Line " Box under test    : $Box"
Line " This machine uses : $myDns"
Line "   via adapter     : $viaAlias  $viaDesc"

# ---- is that adapter something that hijacked the route? ----------------------
if ($viaDesc -match 'RNDIS|Remote NDIS|Mobile USB|Tether|Hyper-V|VirtualBox|VMware|TAP-Windows|WireGuard|OpenVPN') {
  Warn "the default route is on a virtual/tethered adapter, not your LAN."
  Warn "a plugged-in phone or a VPN can outrank Wi-Fi on interface metric and"
  Warn "take over DNS. Unplug it, or raise its metric, then re-run."
}

# ---- 0. box reachable? -------------------------------------------------------
Line ""
Line "------------------------------------------------------------------"
Line " 0. Is the box even there?"
Line "------------------------------------------------------------------"
if (Test-NetConnection -ComputerName $Box -Port 8080 -InformationLevel Quiet -WarningAction SilentlyContinue) {
  Pass "agent answering on $Box`:8080"
} else { Fail "no answer on $Box`:8080 - cannot test further"; Line ""; exit 3 }

# ---- 0b. is this machine's resolver alive at all? ----------------------------
Line ""
Line "------------------------------------------------------------------"
Line " 0b. Is this machine's own resolver alive?"
Line "------------------------------------------------------------------"
$canary = Resolve-Via 'github.com' $myDns
if ($canary.state -eq 'NOANSWER') {
  Fail "$myDns did not answer for github.com either."
  Line ""
  Line "  Your DNS path is broken, so nothing can be concluded about filtering."
  Line "  This is NOT a Gate^Flame verdict - the box was not even consulted."
  Line ""
  Line "  Most common cause: a tethered phone or VPN adapter outranking your"
  Line "  LAN on interface metric. Check with:"
  Line "     Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort InterfaceMetric"
  Line "  Fix by unplugging it, or:"
  Line "     Set-NetIPInterface -InterfaceAlias '$viaAlias' -InterfaceMetric 9999"
  Line ""
  Line "  To test the LAN path regardless:  .\prove-it.ps1 -Via 192.168.0.1"
  Line "=================================================================="; Line ""
  exit 4
}
Pass "$myDns answers ($($canary.ip) for github.com)"

# ---- 1. does the box block? --------------------------------------------------
Line ""
Line "------------------------------------------------------------------"
Line " 1. Does THE BOX block?   (asking $Box directly)"
Line "------------------------------------------------------------------"
$boxBlocked = 0
foreach ($d in $ShouldBlock) {
  $r = Resolve-Via $d $Box
  switch ($r.state) {
    'BLOCKED'  { Pass ("{0,-22} -> {1}" -f $d, $r.ip); $boxBlocked++ }
    'ALLOWED'  { Fail ("{0,-22} -> {1}   (expected 0.0.0.0)" -f $d, $r.ip) }
    'NOANSWER' { Warn ("{0,-22} -> {1}   (box did not answer - not the same as allowed)" -f $d, $r.ip) }
  }
}
foreach ($d in $ShouldResolve) {
  $r = Resolve-Via $d $Box
  switch ($r.state) {
    'BLOCKED'  { Fail ("{0,-22} -> {1}   OVER-BLOCKING - this should resolve" -f $d, $r.ip) }
    'ALLOWED'  { Pass ("{0,-22} -> {1}   (correctly allowed)" -f $d, $r.ip) }
    'NOANSWER' { Warn ("{0,-22} -> {1}" -f $d, $r.ip) }
  }
}
$boxWorks = ($boxBlocked -eq $ShouldBlock.Count)

# ---- 2. does this machine get it? --------------------------------------------
Line ""
Line "------------------------------------------------------------------"
Line " 2. Does THIS MACHINE get it?   (asking $myDns - the real path)"
Line "------------------------------------------------------------------"
$homeBlocked = 0; $homeNoAnswer = 0
foreach ($d in $ShouldBlock) {
  $r = Resolve-Via $d $myDns
  switch ($r.state) {
    'BLOCKED'  { Pass ("{0,-22} -> {1}" -f $d, $r.ip); $homeBlocked++ }
    'ALLOWED'  { Fail ("{0,-22} -> {1}   REACHABLE - not filtered" -f $d, $r.ip) }
    'NOANSWER' { Warn ("{0,-22} -> {1}   (resolver silent - NOT proof of anything)" -f $d, $r.ip); $homeNoAnswer++ }
  }
}
$homeWorks = ($homeBlocked -eq $ShouldBlock.Count)

# ---- verdict -----------------------------------------------------------------
Line ""
Line "=================================================================="
if ($homeNoAnswer -gt 0 -and $homeBlocked -eq 0) {
  Write-Host " VERDICT: INCONCLUSIVE - your resolver stopped answering mid-test." -ForegroundColor Yellow
  Line " Fix the DNS path first, then re-run. See section 0b."
  Line "=================================================================="; Line ""; exit 4
}
if ($boxWorks -and $homeWorks) {
  Write-Host " VERDICT: PROTECTED. The box blocks, and this machine gets it." -ForegroundColor Green
  Line "=================================================================="; Line ""; exit 0
}
if ($boxWorks -and -not $homeWorks) {
  Write-Host " VERDICT: THE PRODUCT IS DOING NOTHING FOR THIS NETWORK." -ForegroundColor Red
  Line ""
  Line " The filter works. Nothing is asking it."
  Line ""
  Line " $boxBlocked/$($ShouldBlock.Count) blocked when asked at $Box"
  Line " $homeBlocked/$($ShouldBlock.Count) blocked on the path this machine uses ($myDns)"
  Line ""
  Line " This is the ADR-001 cutover, and it is a ROUTER change, not a box"
  Line " change: set the router's UPSTREAM / WAN DNS to $Box."
  Line " Do NOT change the DHCP-handed DNS - ADR-001 rejected that, because a"
  Line " power cut then becomes a whole-house outage with no recovery."
  Line ""
  Line " Until then every dashboard number is honest and useless:"
  Line " 0% of 0 lookups is 0%."
  Line "=================================================================="; Line ""; exit 1
}
Write-Host " VERDICT: THE BOX ITSELF IS NOT BLOCKING." -ForegroundColor Red
Line ""
Line " Only $boxBlocked/$($ShouldBlock.Count) test domains were refused when asked directly."
Line " Check, in this order:"
Line "   1. protection paused?   GET $Box`:8080/api/v1/filtering"
Line "   2. gravity empty?       'gravity rebuild failed' on the console means"
Line "                           the blocklists did not regenerate."
Line "   3. Pi-hole up at all?   docker ps on the box"
Line "=================================================================="; Line ""
exit 2
