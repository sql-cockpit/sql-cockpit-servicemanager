[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$SettingsPath = "",
    [string]$DesktopInstallerPath = "",
    [string]$DesktopExecutablePath = "",
    [switch]$SkipDesktopInstall,
    [switch]$RunTrayNow = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repairScript = Join-Path -Path $PSScriptRoot -ChildPath "Repair-SqlCockpitSuite.ps1"
if (-not (Test-Path -LiteralPath $repairScript -PathType Leaf)) {
    throw "Could not find repair script [$repairScript]."
}

$args = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $repairScript
)

if (-not [string]::IsNullOrWhiteSpace($InstallDir)) {
    $args += @("-InstallDir", $InstallDir)
}
if (-not [string]::IsNullOrWhiteSpace($SettingsPath)) {
    $args += @("-SettingsPath", $SettingsPath)
}
if (-not [string]::IsNullOrWhiteSpace($DesktopInstallerPath)) {
    $args += @("-DesktopInstallerPath", $DesktopInstallerPath)
}
if (-not [string]::IsNullOrWhiteSpace($DesktopExecutablePath)) {
    $args += @("-DesktopExecutablePath", $DesktopExecutablePath)
}
if ($SkipDesktopInstall) {
    $args += "-SkipDesktopInstall"
}
if ($RunTrayNow) {
    $args += "-RunTrayNow"
}

Write-Host "[SUITE] Running suite install/repair workflow..." -ForegroundColor Cyan
powershell @args
