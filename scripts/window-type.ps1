<#
.SYNOPSIS
  Type a string into a running window, from outside the app.

.DESCRIPTION
  Companion to window-click.ps1 for real keyboard input of full strings
  (window-key.ps1 sends one key at a time). Types through SendInput's legacy
  keybd_event path with VkKeyScanW per character, so accented characters that
  need dead keys are out of scope — ASCII only, which is what shell prompts
  take anyway.

.EXAMPLE
  powershell -File scripts/window-type.ps1 -ProcessId 1234 -Text "claude"
  powershell -File scripts/window-type.ps1 -ProcessId 1234 -Text "dir" -Enter
#>
param(
  [string]$ProcessName = "micah",
  [int]$ProcessId = 0,
  [int64]$Hwnd = 0,
  [Parameter(Mandatory = $true)][string]$Text,
  # Press Enter after the text (shell submit).
  [switch]$Enter,
  # Delay between characters, ms. Fast enough for a shell, slow enough that
  # the terminal's key parser never drops one.
  [int]$CharDelayMs = 25,
  [int]$SettleMs = 700
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Type {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern short VkKeyScanW(char ch);
  public const uint KEYUP = 0x0002;
  public const byte CTRL = 0x11;
  public const byte SHIFT = 0x10;
  public const byte ENTER = 0x0D;
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

[void][Win32Type]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 300

function Press-Vk([byte]$vk, [bool]$shift) {
  if ($shift) { [Win32Type]::keybd_event([Win32Type]::SHIFT, 0, 0, [UIntPtr]::Zero) }
  [Win32Type]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 12
  [Win32Type]::keybd_event($vk, 0, [Win32Type]::KEYUP, [UIntPtr]::Zero)
  if ($shift) { [Win32Type]::keybd_event([Win32Type]::SHIFT, 0, [Win32Type]::KEYUP, [UIntPtr]::Zero) }
}

foreach ($ch in $Text.ToCharArray()) {
  $scan = [Win32Type]::VkKeyScanW($ch)
  if ($scan -eq -1) { throw "char not typeable on this layout: $ch" }
  $vk = [byte]($scan -band 0xFF)
  $shift = (($scan -shr 8) -band 0x01) -ne 0
  Press-Vk $vk $shift
  Start-Sleep -Milliseconds $CharDelayMs
}
if ($Enter) {
  Press-Vk ([Win32Type]::ENTER) $false
}
Start-Sleep -Milliseconds $SettleMs

[pscustomobject]@{
  hwnd = [int64]$target
  typed = $Text.Length
  enter = [bool]$Enter
} | ConvertTo-Json -Compress
