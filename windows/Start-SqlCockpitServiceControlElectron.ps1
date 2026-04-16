[CmdletBinding()]
param(
    [string]$SettingsPath = "",
    [switch]$SkipInstall,
    [switch]$RunAsAdministrator,
    [string[]]$AdditionalArgs = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    return ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
        IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($RunAsAdministrator -and -not (Test-IsAdministrator)) {
    $argList = @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "`"$PSCommandPath`""
    )
    if (-not [string]::IsNullOrWhiteSpace($SettingsPath)) {
        $argList += @("-SettingsPath", "`"$SettingsPath`"")
    }
    if ($SkipInstall) {
        $argList += "-SkipInstall"
    }
    foreach ($extraArg in $AdditionalArgs) {
        if (-not [string]::IsNullOrWhiteSpace($extraArg)) {
            $argList += @("-AdditionalArgs", "`"$extraArg`"")
        }
    }
    $argList += "-RunAsAdministrator"

    Write-Host "[ELECTRON] Restarting launcher with elevation..." -ForegroundColor Yellow
    Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs | Out-Null
    return
}

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
    $forwardedArgs = @("--settings", "$SettingsPath")
    foreach ($extraArg in $AdditionalArgs) {
        if (-not [string]::IsNullOrWhiteSpace($extraArg)) {
            $forwardedArgs += $extraArg
        }
    }
    npm run dev -- @forwardedArgs
}
finally {
    Pop-Location
}
