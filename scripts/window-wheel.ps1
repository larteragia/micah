<#
.SYNOPSIS
  Send mouse-wheel steps at a point inside a running window, from outside the app.

.DESCRIPTION
  Companion to window-click.ps1 for zoom controls (the Mind canvas zooms on
  wheel). Moves the real cursor and sends real wheel steps through SendInput's
  legacy mouse_event path, in client coordinates of the target window,
  DPI-aware, so coordinates match a window-shot.ps1 capture one to one.

.EXAMPLE
  powershell -File scripts/window-wheel.ps1 -ProcessId 1234 -X 400 -Y 900 -Steps 6
  # 6 steps of wheel-up (zoom in) at client 400,900
#>
param(
  [string]$ProcessName = "micah",
  [int]$ProcessId = 0,
  [int64]$Hwnd = 0,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  # Positive = wheel up (zoom in), negative = wheel down (zoom out).
  [int]$Steps = 3,
  [int]$SettleMs = 700
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Wheel {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public const uint WHEEL = 0x0800;
}
"@
[void][Win32Wheel]::SetProcessDPIAware()

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
$point = New-Object Win32Wheel+POINT
$point.X = $X
$point.Y = $Y
if (-not [Win32Wheel]::ClientToScreen($target, [ref]$point)) {
  throw "ClientToScreen failed"
}

[void][Win32Wheel]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 200
[void][Win32Wheel]::SetCursorPos($point.X, $point.Y)
Start-Sleep -Milliseconds 150

$delta = if ($Steps -ge 0) { 120 } else { -120 }
$count = [math]::Abs($Steps)
for ($i = 0; $i -lt $count; $i++) {
  [Win32Wheel]::mouse_event([Win32Wheel]::WHEEL, 0, 0, [uint32]$delta, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 90
}
Start-Sleep -Milliseconds $SettleMs

[pscustomobject]@{
  hwnd   = [int64]$target
  client = "$X,$Y"
  steps  = $Steps
} | ConvertTo-Json -Compress
