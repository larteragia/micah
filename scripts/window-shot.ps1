<#
.SYNOPSIS
  Capture a real screenshot of a running window, from outside the app.

.DESCRIPTION
  Proof that the browser panel is actually on screen cannot come from CDP:
  `Page.captureScreenshot` happily returns page content while the webview is
  hidden, sized to nothing, or parked off-screen — so a broken panel would pass.
  This grabs what the operating system is compositing instead.

  Uses PrintWindow with PW_RENDERFULLCONTENT so child HWNDs (which is exactly what
  the browser panel is) are included, then falls back to a screen-region grab if
  the driver refuses.

.EXAMPLE
  powershell -File scripts/window-shot.ps1 -ProcessName micah -Out shot.png
#>
param(
  [string]$ProcessName = "micah",
  # Pin the capture to one process. Without it, a machine running two instances
  # of the app (a released build and one under test) can hand back the wrong
  # window — and a screenshot of the wrong window proves nothing.
  [int]$ProcessId = 0,
  # Capture one exact window. `MainWindowHandle` follows whatever the app most
  # recently showed — a settings window opening mid-run would otherwise silently
  # replace the window under test.
  [int64]$Hwnd = 0,
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Shot {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Without this the PowerShell host is DPI-unaware, so GetWindowRect answers in
# virtualized (logical) pixels while PrintWindow paints in physical ones. The
# capture then silently comes back as a top-left crop of the window: on a 150%
# display the whole right third, header controls included, is simply missing and
# the run still reports a full-size screenshot.
[void][Win32Shot]::SetProcessDPIAware()

$procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 }
if ($ProcessId -ne 0) { $procs = $procs | Where-Object { $_.Id -eq $ProcessId } }
if (-not $procs) { throw "no visible window for process '$ProcessName'" }

# Pick the largest visible window: a Tauri app also owns tiny helper HWNDs, and
# grabbing a 15x15 one would produce a "screenshot" that proves nothing.
$candidates = foreach ($p in $procs) {
  $h = $p.MainWindowHandle
  if (-not [Win32Shot]::IsWindowVisible($h)) { continue }
  $r = New-Object Win32Shot+RECT
  if (-not [Win32Shot]::GetWindowRect($h, [ref]$r)) { continue }
  [pscustomobject]@{
    Proc = $p
    Hwnd = $h
    Area = [math]::Max(0, $r.Right - $r.Left) * [math]::Max(0, $r.Bottom - $r.Top)
  }
}
if (-not $candidates) { throw "no visible window with a measurable rect for '$ProcessName'" }
if ($Hwnd -ne 0) {
  $proc = $procs | Select-Object -First 1
  $hwnd = [IntPtr]$Hwnd
} else {
  $best = $candidates | Sort-Object Area -Descending | Select-Object -First 1
  $proc = $best.Proc
  $hwnd = $best.Hwnd
}

# Bring it up front: a fully occluded window composites stale content.
[void][Win32Shot]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 700

$rect = New-Object Win32Shot+RECT
if (-not [Win32Shot]::GetWindowRect($hwnd, [ref]$rect)) { throw "GetWindowRect failed" }
$width  = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "window has no area: ${width}x${height}" }

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
# 0x00000002 = PW_RENDERFULLCONTENT — without it, child webviews come back blank.
$ok = [Win32Shot]::PrintWindow($hwnd, $hdc, 2)
$graphics.ReleaseHdc($hdc)

if (-not $ok) {
  # Compositor said no; copy the screen region the window occupies instead.
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
}

$graphics.Dispose()
$full = [System.IO.Path]::GetFullPath($Out)
$bitmap.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

[pscustomobject]@{
  pid    = $proc.Id
  hwnd   = [int64]$hwnd
  width  = $width
  height = $height
  file   = $full
  method = if ($ok) { "PrintWindow" } else { "CopyFromScreen" }
} | ConvertTo-Json -Compress
