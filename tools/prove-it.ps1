<#
    prove-it.ps1 - does Gate^Flame actually protect this network, right now?

    This asks the only two questions that matter, and it asks them the way a
    customer's laptop would - by resolving real domains and looking at the
    answer. It does not read a dashboard, does not call the agent API, and
    does not trust anything the product says about itself.

      Q1  Does the BOX block?          (ask 192.168.0.10 directly)
      Q2  Does the HOUSEHOLD get it?   (ask whatever DNS this machine uses)

    Q1 can pass while Q2 fails. That is exactly the state this repo shipped
    in on 2026-09-06: a working filter that nothing on the LAN was pointed at.
    A green test suite said nothing about it, because no test ever resolved a
    domain.

    Exit codes:  0 = protected   1 = box works but household unprotected
                 2 = box not blocking   3 = box unreachable

    Usage:  powershell -ExecutionPolicy Bypass -File tools\prove-it.ps1
            powershell ... -File tools\prove-it.ps1 -Box 192.168.0.10
#>
[CmdletBinding()]
param(
  [string]$Box = '192.168.0.10',
  [string[]]$ShouldBlock = @('doubleclick.net','ads.google.com','pornhub.com','xhamster.com'),
  [string[]]$ShouldResolve = @('ionity.today','github.com')
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
$BLOCKED_ANSWERS = @('0.0.0.0','127.0.0.1','::','::1')

function Resolve-Via {
  param([string]$Name, [string]$Server)
  try {
    $r = Resolve-DnsName -Name $Name -Server $Server -Type A -DnsOnly -QuickTimeout -EA Stop |
         Where-Object { $_.QueryType -eq 'A' } | Select-Object -First 1
    if (-not $r) { return @{ ok = $true; ip = '(no A record)'; blocked = $true } }
    return @{ ok = $true; ip = $r.IPAddress; blocked = ($BLOCKED_ANSWERS -contains $r.IPAddress) }
  } catch {
    return @{ ok = $false; ip = 'LOOKUP FAILED'; blocked = $false }
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

# ---------- what DNS does this machine actually use? ----------
$myDns = (Get-DnsClientServerAddress -AddressFamily IPv4 |
          Where-Object { $_.ServerAddresses -and $_.InterfaceAlias -notmatch 'Loopback' } |
          Select-Object -First 1).ServerAddresses
$myDnsStr = ($myDns -join ', ')
Line ""
Line " This machine resolves via : $myDnsStr"
Line " The box under test        : $Box"

# ---------- reachability ----------
$reach = Test-NetConnection -ComputerName $Box -Port 8080 -InformationLevel Quiet -WarningAction SilentlyContinue
Line ""
Line "------------------------------------------------------------------"
Line " 0. Is the box even there?"
Line "------------------------------------------------------------------"
if ($reach) { Pass "agent answering on $Box`:8080" }
else { Fail "no answer on $Box`:8080 - cannot test further"; exit 3 }

# ---------- Q1: does the box block? ----------
Line ""
Line "------------------------------------------------------------------"
Line " 1. Does THE BOX block?   (asking $Box directly)"
Line "------------------------------------------------------------------"
$boxBlocked = 0
foreach ($d in $ShouldBlock) {
  $r = Resolve-Via $d $Box
  if ($r.blocked) { Pass ("{0,-22} -> {1}" -f $d, $r.ip); $boxBlocked++ }
  else            { Fail ("{0,-22} -> {1}   (expected 0.0.0.0)" -f $d, $r.ip) }
}
foreach ($d in $ShouldResolve) {
  $r = Resolve-Via $d $Box
  if ($r.blocked) { Fail ("{0,-22} -> {1}   OVER-BLOCKING - this should resolve" -f $d, $r.ip) }
  else            { Pass ("{0,-22} -> {1}   (correctly allowed)" -f $d, $r.ip) }
}
$boxWorks = ($boxBlocked -eq $ShouldBlock.Count)

# ---------- Q2: does the household get it? ----------
Line ""
Line "------------------------------------------------------------------"
Line " 2. Does THE HOUSEHOLD get it?   (asking $myDnsStr - the real path)"
Line "------------------------------------------------------------------"
$homeBlocked = 0
foreach ($d in $ShouldBlock) {
  $r = Resolve-Via $d $myDns[0]
  if ($r.blocked) { Pass ("{0,-22} -> {1}" -f $d, $r.ip); $homeBlocked++ }
  else            { Fail ("{0,-22} -> {1}   REACHABLE - not filtered" -f $d, $r.ip) }
}
$homeWorks = ($homeBlocked -eq $ShouldBlock.Count)

# ---------- verdict ----------
Line ""
Line "=================================================================="
if ($boxWorks -and $homeWorks) {
  Write-Host " VERDICT: PROTECTED. The box blocks, and this machine gets it." -ForegroundColor Green
  Line "=================================================================="; Line ""
  exit 0
}
elseif ($boxWorks -and -not $homeWorks) {
  Write-Host " VERDICT: THE PRODUCT IS DOING NOTHING FOR THIS NETWORK." -ForegroundColor Red
  Line ""
  Line " The filter works. Nothing is asking it."
  Line ""
  Line " $boxBlocked/$($ShouldBlock.Count) domains blocked when asked at $Box,"
  Line " $homeBlocked/$($ShouldBlock.Count) blocked on the path this machine actually uses ($myDnsStr)."
  Line ""
  Line " This is the ADR-001 cutover, and it is a ROUTER change, not a box"
  Line " change: set the router's UPSTREAM / WAN DNS to $Box."
  Line " Do NOT change the DHCP-handed DNS - ADR-001 rejected that, because a"
  Line " power cut then becomes a whole-house outage with no recovery."
  Line ""
  Line " Until that is done, every dashboard number is honest and useless:"
  Line " 0% of 0 lookups is 0%."
  Line "=================================================================="; Line ""
  exit 1
}
else {
  Write-Host " VERDICT: THE BOX ITSELF IS NOT BLOCKING." -ForegroundColor Red
  Line ""
  Line " Only $boxBlocked/$($ShouldBlock.Count) test domains were refused when asked directly."
  Line " Check, in this order:"
  Line "   1. protection paused?      GET  $Box`:8080/api/v1/filtering"
  Line "   2. gravity list empty?     'gravity rebuild failed' on the console means"
  Line "                              the blocklists did not regenerate."
  Line "   3. is Pi-hole up at all?   docker ps on the box"
  Line "=================================================================="; Line ""
  exit 2
}
