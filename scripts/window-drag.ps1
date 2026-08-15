<#
.SYNOPSIS
  Drag the mouse between two points inside a window, from outside the app.

.DESCRIPTION
  Companion to window-click.ps1, for controls that only respond to a held
  gesture (panel dividers). Coordinates are client coordinates of the target
  window, DPI-aware, so they can be read straight off a window-shot capture.

.EXAMPLE
  powershell -File scripts/window-drag.ps1 -ProcessName micah -FromX 841 -FromY 700 -ToX 1100 -ToY 700
#>
param(
  [string]$ProcessName = "micah",
  [int]$ProcessId = 0,
  [Parameter(Mandatory = $true)][int]$FromX,
  [Parameter(Mandatory = $true)][int]$FromY,
  [Parameter(Mandatory = $true)][int]$ToX,
  [Parameter(Mandatory = $true)][int]$ToY,
  [int]$Steps = 24,
  [int]$SettleMs = 900
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Drag {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
"@
[void][Win32Drag]::SetProcessDPIAware()

$procs = if ($ProcessId -ne 0) { @(Get-Process -Id $ProcessId) } else { @(Get-Process -Name $ProcessName) }
$target = ($procs | Where-Object { $_.MainWindowHandle -ne 0 })[0].MainWindowHandle
if (-not $target) { throw "no window found" }

function ToScreen([int]$x, [int]$y) {
  $p = New-Object Win32Drag+POINT
  $p.X = $x; $p.Y = $y
  [void][Win32Drag]::ClientToScreen($target, [ref]$p)
  return $p
}

$from = ToScreen $FromX $FromY
$to = ToScreen $ToX $ToY

[void][Win32Drag]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 250
[void][Win32Drag]::SetCursorPos($from.X, $from.Y)
Start-Sleep -Milliseconds 150
[Win32Drag]::mouse_event([Win32Drag]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
for ($i = 1; $i -le $Steps; $i++) {
  $x = [int]($from.X + ($to.X - $from.X) * $i / $Steps)
  $y = [int]($from.Y + ($to.Y - $from.Y) * $i / $Steps)
  [void][Win32Drag]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 16
}
Start-Sleep -Milliseconds 150
[Win32Drag]::mouse_event([Win32Drag]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds $SettleMs

[pscustomobject]@{ hwnd = [int64]$target; from = "$FromX,$FromY"; to = "$ToX,$ToY" } | ConvertTo-Json -Compress
