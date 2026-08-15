<#
.SYNOPSIS
  Right-click a point inside a window, from outside the app (context menus).

.EXAMPLE
  powershell -File scripts/window-rightclick.ps1 -ProcessName micah -X 30 -Y 90
#>
param(
  [string]$ProcessName = "micah",
  [int]$ProcessId = 0,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [int]$SettleMs = 700
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32RClick {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public const uint RIGHTDOWN = 0x0008;
  public const uint RIGHTUP = 0x0010;
}
"@
[void][Win32RClick]::SetProcessDPIAware()

$procs = if ($ProcessId -ne 0) { @(Get-Process -Id $ProcessId) } else { @(Get-Process -Name $ProcessName) }
$target = ($procs | Where-Object { $_.MainWindowHandle -ne 0 })[0].MainWindowHandle
if (-not $target) { throw "no window found" }

$p = New-Object Win32RClick+POINT
$p.X = $X; $p.Y = $Y
[void][Win32RClick]::ClientToScreen($target, [ref]$p)

[void][Win32RClick]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 200
[void][Win32RClick]::SetCursorPos($p.X, $p.Y)
Start-Sleep -Milliseconds 120
[Win32RClick]::mouse_event([Win32RClick]::RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[Win32RClick]::mouse_event([Win32RClick]::RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds $SettleMs

[pscustomobject]@{ hwnd = [int64]$target; client = "$X,$Y"; screen = "$($p.X),$($p.Y)" } | ConvertTo-Json -Compress
