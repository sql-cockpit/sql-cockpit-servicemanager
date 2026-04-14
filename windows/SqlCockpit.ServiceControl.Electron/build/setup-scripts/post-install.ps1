[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Administrator {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
        IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        throw "Installer post-install must run as Administrator."
    }
}

function Assert-DotNetSdk {
    $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        throw "dotnet SDK is required to provision SQLCockpitServiceHost during install."
    }
}

Assert-Administrator
Assert-DotNetSdk

$setupRoot = Split-Path -Path $PSScriptRoot -Parent
$windowsSetupRoot = Join-Path -Path $setupRoot -ChildPath "windows"

$installServiceScript = Join-Path -Path $windowsSetupRoot -ChildPath "Install-SqlCockpitWindowsService.ps1"
$installTrayScript = Join-Path -Path $windowsSetupRoot -ChildPath "Install-SqlCockpitServiceTrayStartup.ps1"
$serviceSettingsPath = Join-Path -Path $env:ProgramData -ChildPath "SqlCockpit\sql-cockpit-service.settings.json"
$installedExe = Join-Path -Path $InstallDir -ChildPath "SQL Cockpit Service Control.exe"

if (-not (Test-Path -LiteralPath $installServiceScript -PathType Leaf)) {
    throw "Missing installer resource [$installServiceScript]."
}
if (-not (Test-Path -LiteralPath $installTrayScript -PathType Leaf)) {
    throw "Missing installer resource [$installTrayScript]."
}
if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw "Installed app executable was not found at [$installedExe]."
}

Write-Host "[INSTALLER] Provisioning SQL Cockpit Windows service..." -ForegroundColor Cyan
powershell -NoProfile -ExecutionPolicy Bypass -File $installServiceScript -SettingsProfile prod -StartAfterInstall

Write-Host "[INSTALLER] Provisioning SQL Cockpit tray startup task..." -ForegroundColor Cyan
powershell -NoProfile -ExecutionPolicy Bypass -File $installTrayScript `
    -ExecutablePath $installedExe `
    -SettingsPath $serviceSettingsPath `
    -SkipPublish `
    -RunImmediately `
    -UseHighestPrivileges

Write-Host "[INSTALLER] Post-install provisioning complete." -ForegroundColor Green
