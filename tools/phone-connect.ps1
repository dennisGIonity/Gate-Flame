# Find and connect to Dennis's handset over wireless debugging.
#
# WHY THIS EXISTS
# Android's wireless-debug port rotates, and the adb server's mDNS cache goes
# stale independently of whether the phone is actually available. One empty
# `adb mdns services` therefore means nothing on its own - reading it as
# "wireless debugging is off" has already sent Dennis to Developer Options for
# no reason. Poll, then say what the evidence supports and nothing more.
#
# NOTE: `adb kill-server` will drop an ALREADY-WORKING connection that was
# established from an earlier mDNS hit. Only bounce the server when nothing is
# connected - hence the check below rather than an unconditional restart.
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

# emulator-5554 is BlueStacks (NATs, no LAN, no mDNS, Android 9 x86_64) even
# though it reports a Galaxy device profile. It is never the deploy target.
$real = (& $adb devices 2>&1) | Select-String "device$" | Where-Object { $_ -notmatch "emulator-" }
if ($real) {
    $t = ($real -split "\s+")[0]
    Write-Output "already connected: $t"
    exit 0
}

for ($i = 1; $i -le 6; $i++) {
    $hit = (& $adb mdns services 2>&1) | Select-String "_adb-tls-connect"
    if ($hit) {
        $t = ($hit -split "\s+")[-1]
        Write-Output "found on attempt ${i}: $t"
        & $adb connect $t 2>&1 | ForEach-Object { "  $_" }
        exit 0
    }
    Write-Output "attempt ${i}: nothing announced"
    Start-Sleep -Seconds 5
}

Write-Output ""
Write-Output "Nothing announced after 6 tries. Separating the two causes:"
# A phone on the LAN with a randomised (locally-administered) MAC shows in ARP
# whether or not adb can see it. Present in ARP but silent on mDNS = wireless
# debugging is genuinely off. Absent = the phone is off this network entirely.
arp -a 2>&1 | Select-String "192\.168\.0\." | ForEach-Object { "  $_" }
Write-Output ""
Write-Output "  In ARP but not on mDNS  -> wireless debugging is off; toggle it."
Write-Output "  Not in ARP at all       -> the phone is not on this Wi-Fi."
