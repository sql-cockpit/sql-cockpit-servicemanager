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

$repairSuiteScript = Join-Path -Path $windowsSetupRoot -ChildPath "Repair-SqlCockpitSuite.ps1"

if (-not (Test-Path -LiteralPath $repairSuiteScript -PathType Leaf)) {
    throw "Missing installer resource [$repairSuiteScript]."
}

Write-Host "[INSTALLER] Running SQL Cockpit suite provisioning..." -ForegroundColor Cyan
powershell -NoProfile -ExecutionPolicy Bypass -File $repairSuiteScript -InstallDir $InstallDir -RunTrayNow

Write-Host "[INSTALLER] Post-install provisioning complete." -ForegroundColor Green
