<#
.SYNOPSIS
  Send a keyboard shortcut to a running window, from outside the app.

.DESCRIPTION
  Companion to window-click.ps1. A screenshot proves what is on screen; this
  proves a keybinding still reaches the app, which is the only way to check that
  a surface stayed reachable after its trigger moved.

.EXAMPLE
  powershell -File scripts/window-key.ps1 -ProcessId 1234 -Ctrl -Shift -Key S
#>
param(
  [string]$ProcessName = "micah",
  [int]$ProcessId = 0,
  [int64]$Hwnd = 0,
  [switch]$Ctrl,
  [switch]$Shift,
  [switch]$Alt,
  [Parameter(Mandatory = $true)][string]$Key,
  [int]$SettleMs = 900
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Key {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern short VkKeyScanW(char ch);
  public const uint KEYUP = 0x0002;
  public const byte CTRL = 0x11;
  public const byte SHIFT = 0x10;
  public const byte ALT = 0x12;
}
"@

$procs = if ($Hwnd -ne 0) {
  $null
} elseif ($ProcessId -ne 0) {
  @(Get-Process -Id $ProcessId -ErrorAction Stop)
} else {
  @(Get-Process -Name $ProcessName -ErrorAction Stop)
}

$target = if ($Hwnd -ne 0) {
  [IntPtr]$Hwnd
} else {
  $withWindow = $procs | Where-Object { $_.MainWindowHandle -ne 0 }
  if (-not $withWindow) { throw "no window found for the target process" }
  $withWindow[0].MainWindowHandle
}

[void][Win32Key]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 250

$vk = [byte](([Win32Key]::VkKeyScanW([char]$Key.ToUpper())) -band 0xFF)

if ($Ctrl) { [Win32Key]::keybd_event([Win32Key]::CTRL, 0, 0, [UIntPtr]::Zero) }
if ($Shift) { [Win32Key]::keybd_event([Win32Key]::SHIFT, 0, 0, [UIntPtr]::Zero) }
if ($Alt) { [Win32Key]::keybd_event([Win32Key]::ALT, 0, 0, [UIntPtr]::Zero) }
[Win32Key]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[Win32Key]::keybd_event($vk, 0, [Win32Key]::KEYUP, [UIntPtr]::Zero)
if ($Alt) { [Win32Key]::keybd_event([Win32Key]::ALT, 0, [Win32Key]::KEYUP, [UIntPtr]::Zero) }
if ($Shift) { [Win32Key]::keybd_event([Win32Key]::SHIFT, 0, [Win32Key]::KEYUP, [UIntPtr]::Zero) }
if ($Ctrl) { [Win32Key]::keybd_event([Win32Key]::CTRL, 0, [Win32Key]::KEYUP, [UIntPtr]::Zero) }
Start-Sleep -Milliseconds $SettleMs

[pscustomobject]@{ hwnd = [int64]$target; key = $Key; vk = $vk } | ConvertTo-Json -Compress
