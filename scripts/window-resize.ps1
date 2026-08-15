param([int64]$Hwnd,[int]$W,[int]$H)
Add-Type @"
using System;using System.Runtime.InteropServices;
public static class Wp{
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [StructLayout(LayoutKind.Sequential)] public struct RECT{public int Left,Top,Right,Bottom;}
}
"@
[void][Wp]::SetProcessDPIAware()
$h=[IntPtr]$Hwnd
$r=New-Object Wp+RECT; [void][Wp]::GetWindowRect($h,[ref]$r)
"before: $($r.Right-$r.Left)x$($r.Bottom-$r.Top)"
[void][Wp]::SetWindowPos($h,[IntPtr]::Zero,$r.Left,$r.Top,$W,$H,0x0014)
Start-Sleep -Milliseconds 1500
$r2=New-Object Wp+RECT; [void][Wp]::GetWindowRect($h,[ref]$r2)
"after: $($r2.Right-$r2.Left)x$($r2.Bottom-$r2.Top)"
