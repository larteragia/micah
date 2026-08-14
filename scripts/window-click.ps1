<#
.SYNOPSIS
  Click a point inside a running window, from outside the app.

.DESCRIPTION
  Proof that a control works cannot come from a screenshot: a screenshot
  photographs, it does not press. And CDP cannot reach Micah's own UI by
  construction (only the browser panel's child webview is given a debugging
  port), so driving the app from Playwright is not an option either.

  This moves the real cursor and sends a real click through SendInput, at a point
  given in *client* coordinates of the target window, so the coordinates can be
  read straight off a `window-shot.ps1` capture.

.EXAMPLE
  powershell -File scripts/window-click.ps1 -ProcessId 1234 -X 118 -Y 23
#>
param(
  [string]$ProcessName = "micah",
  [int]$ProcessId = 0,
  [int64]$Hwnd = 0,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [int]$SettleMs = 700
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Click {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
"@

# Without this the PowerShell host is DPI-unaware, so Windows silently scales
# every coordinate it hands to SetCursorPos by the display scale factor. On a
# 150% display a click meant for "Editor" lands on "Ai Viewer", and the run still
# reports success. Declaring awareness makes the coordinates match the pixels in
# a window-shot.ps1 capture one to one.
[void][Win32Click]::SetProcessDPIAware()

function Resolve-TargetHwnd {
  if ($Hwnd -ne 0) { return [IntPtr]$Hwnd }
  $procs = if ($ProcessId -ne 0) {
    @(Get-Process -Id $ProcessId -ErrorAction Stop)
  } else {
    @(Get-Process -Name $ProcessName -ErrorAction Stop)
  }
  $withWindow = $procs | Where-Object { $_.MainWindowHandle -ne 0 }
  if (-not $withWindow) { throw "no window found for the target process" }
  return $withWindow[0].MainWindowHandle
}

$target = Resolve-TargetHwnd
$point = New-Object Win32Click+POINT
$point.X = $X
$point.Y = $Y
if (-not [Win32Click]::ClientToScreen($target, [ref]$point)) {
  throw "ClientToScreen failed"
}

[void][Win32Click]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 200
[void][Win32Click]::SetCursorPos($point.X, $point.Y)
Start-Sleep -Milliseconds 120
[Win32Click]::mouse_event([Win32Click]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[Win32Click]::mouse_event([Win32Click]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds $SettleMs

[pscustomobject]@{
  hwnd   = [int64]$target
  client = "$X,$Y"
  screen = "$($point.X),$($point.Y)"
} | ConvertTo-Json -Compress
