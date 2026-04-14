[CmdletBinding()]
param(
    [string]$TaskName = "SQLCockpitServiceTrayAtLogon",
    [string]$ExecutablePath = "",
    [string]$SettingsPath = "",
    [switch]$SkipPublish,
    [switch]$RunImmediately,
    [switch]$UseHighestPrivileges
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$canonicalInstaller = Join-Path -Path $PSScriptRoot -ChildPath "Install-SqlCockpitServiceTrayStartup.ps1"
if (-not (Test-Path -LiteralPath $canonicalInstaller -PathType Leaf)) {
    throw "Could not find canonical startup installer [$canonicalInstaller]."
}

Write-Host "[ELECTRON] Forwarding to Install-SqlCockpitServiceTrayStartup.ps1 (canonical startup installer)." -ForegroundColor Yellow
powershell -NoProfile -ExecutionPolicy Bypass -File $canonicalInstaller `
    -TaskName $TaskName `
    -ExecutablePath $ExecutablePath `
    -SettingsPath $SettingsPath `
    -SkipPublish:$SkipPublish `
    -RunImmediately:$RunImmediately `
    -UseHighestPrivileges:$UseHighestPrivileges
