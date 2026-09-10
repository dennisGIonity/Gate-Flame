# Screenshot the main window of a process by title substring, to a PNG.
#   powershell -File tools\shot-window.ps1 -Title "Gate^Flame" -Out release\logs\desktop-shot.png
# Used to PROVE a desktop build renders (a green exit code from electron-builder
# says nothing about whether the window paints).
param([string]$Title = 'Gate^Flame', [string]$Out = 'release\logs\window-shot.png')
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class GfWin {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$Title*" } | Select -First 1
if (-not $p) { Write-Error "no window with title like *$Title*"; exit 1 }
[GfWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 400
$rc = New-Object GfWin+RECT
[GfWin]::GetWindowRect($p.MainWindowHandle, [ref]$rc) | Out-Null
$w = $rc.R - $rc.L; $h = $rc.B - $rc.T
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rc.L, $rc.T, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"$($p.MainWindowTitle): ${w}x${h} -> $Out"
