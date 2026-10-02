<#
.SYNOPSIS
  One-liner installer for Micah on Windows.

.DESCRIPTION
  Downloads the latest Micah release bundle from GitHub and installs it
  silently (NSIS per-user, no UAC prompt). The app configures the rest
  itself on first run: CLI run-dir, shell integration, WebView2 runtime
  and the autostart setting.

.EXAMPLE
  curl -fsSL https://raw.githubusercontent.com/larteragia/micah/main/scripts/install.ps1 | powershell -NoProfile -ExecutionPolicy Bypass -

.EXAMPLE
  .\install.ps1 -Version v0.8.6 -DryRun
#>
param(
  # Tag to install, for example v0.8.6. Defaults to the latest published release.
  [string]$Version = "",
  # Resolve and print what would be installed, then stop.
  [switch]$DryRun,
  # Install the MSI bundle instead of the NSIS setup. May require elevation.
  [switch]$Msi,
  # Launch Micah right after a successful install.
  [switch]$Run
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is unusably slow with the progress bar

$Repo = "larteragia/micah"
$ApiBase = "https://api.github.com/repos/$Repo"

if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
  Write-Error "Windows ARM64 is not published yet, only x64 builds exist. See $Repo releases."
  exit 1
}

$headers = @{ "User-Agent" = "micah-install" }

function Get-Release {
  param([string]$Tag)
  $url = if ($Tag) { "$ApiBase/releases/tags/$Tag" } else { "$ApiBase/releases/latest" }
  try {
    return Invoke-RestMethod -Uri $url -Headers $headers
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 404) {
      if ($Tag) {
        Write-Error "Release $Tag not found in $Repo. Check the tag or drop -Version to use the latest."
      } else {
        Write-Error "No published release in $Repo yet. Draft releases are invisible to installers: publish one at https://github.com/$Repo/releases and run this again."
      }
      exit 1
    }
    Write-Error "GitHub API failed for ${url}: $($_.Exception.Message)"
    exit 1
  }
}

$release = Get-Release -Tag $Version

# Asset names follow the bundle productName: Micah_<ver>_x64-setup.exe (NSIS)
# and Micah_<ver>_x64_en-US.msi. Match by suffix so versions stay free-form.
$wanted = if ($Msi) { ".msi" } else { "_x64-setup.exe" }
$asset = $release.assets | Where-Object { $_.name.EndsWith($wanted) } | Select-Object -First 1
if (-not $asset) {
  Write-Error "Release $($release.tag_name) has no asset ending in '$wanted'. Published assets: $($release.assets.name -join ', ')"
  exit 1
}

$dest = Join-Path $env:TEMP $asset.name

Write-Output "Micah $($release.tag_name)"
Write-Output "bundle  : $($asset.name)"
Write-Output "download: $($asset.browser_download_url)"

if ($DryRun) {
  Write-Output "dry run : nothing downloaded, nothing installed"
  exit 0
}

Write-Output "downloading to $dest ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -Headers $headers

# Sanity check: a Windows executable starts with "MZ". Guards against an HTML
# error page saved with a .exe name.
$magic = [System.IO.File]::ReadAllBytes($dest)[0..1]
if (-not ($magic[0] -eq 0x4D -and $magic[1] -eq 0x5A)) {
  Write-Error "$dest is not a Windows executable (bad magic bytes). The download was corrupted, aborted."
  exit 1
}

if ($Msi) {
  # /qn = fully silent. Per-machine MSI bundles may trigger UAC; NSIS is the
  # default for a reason.
  Write-Output "installing MSI silently (this may ask for elevation) ..."
  $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", "`"$dest`"", "/qn" -Wait -PassThru
} else {
  # Tauri NSIS bundle with installMode=currentUser: /S is fully silent and
  # needs no elevation.
  Write-Output "installing NSIS setup silently ..."
  $proc = Start-Process -FilePath $dest -ArgumentList "/S" -Wait -PassThru
}
if ($proc.ExitCode -ne 0) {
  Write-Error "installer exited with code $($proc.ExitCode)"
  exit 1
}

Write-Output ""
Write-Output "Micah $($release.tag_name) installed."
Write-Output "Note: Windows Smart App Control must be OFF for Micah to run (Settings > Privacy & security > Windows Security > App & browser control)."
Write-Output "Launch it from the Start Menu; the CLI, shell integration and updates configure themselves on first run."

if ($Run) {
  foreach ($candidate in @(
    "$env:LOCALAPPDATA\Programs\Micah\Micah.exe",
    "$env:LOCALAPPDATA\Micah\Micah.exe"
  )) {
    if (Test-Path $candidate) {
      Start-Process -FilePath $candidate
      Write-Output "launched: $candidate"
      exit 0
    }
  }
  Write-Output "could not find Micah.exe to auto-launch, open it from the Start Menu"
}
