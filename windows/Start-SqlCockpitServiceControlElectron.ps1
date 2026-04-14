[CmdletBinding()]
param(
    [string]$SettingsPath = "",
    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$appRoot = Join-Path -Path $PSScriptRoot -ChildPath "SqlCockpit.ServiceControl.Electron"
$packagePath = Join-Path -Path $appRoot -ChildPath "package.json"

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "Could not find Electron service control app package [$packagePath]."
}

if ([string]::IsNullOrWhiteSpace($SettingsPath)) {
    $SettingsPath = Join-Path -Path $env:ProgramData -ChildPath "SqlCockpit\sql-cockpit-service.settings.json"
}

if (-not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
    throw "Could not find settings file [$SettingsPath]."
}

Push-Location $appRoot
try {
    if (-not $SkipInstall -or -not (Test-Path -LiteralPath (Join-Path -Path $appRoot -ChildPath "node_modules") -PathType Container)) {
        Write-Host "[ELECTRON] Installing dependencies..." -ForegroundColor Cyan
        npm install
    }

    Write-Host "[ELECTRON] Starting SQL Cockpit Service Control..." -ForegroundColor Green
    npm run dev -- --settings "$SettingsPath"
}
finally {
    Pop-Location
}
