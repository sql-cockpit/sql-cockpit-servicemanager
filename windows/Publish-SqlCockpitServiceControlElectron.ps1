[CmdletBinding()]
param(
    [switch]$PortableOnly,
    [switch]$SkipDesktopBundle,
    [string]$DesktopSetupPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$appRoot = Join-Path -Path $PSScriptRoot -ChildPath "SqlCockpit.ServiceControl.Electron"
$packagePath = Join-Path -Path $appRoot -ChildPath "package.json"
$prepareDesktopBundleScript = Join-Path -Path $PSScriptRoot -ChildPath "Prepare-SqlCockpitSuiteDesktopBundle.ps1"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "Could not find Electron service control app package [$packagePath]."
}
if (-not (Test-Path -LiteralPath $prepareDesktopBundleScript -PathType Leaf)) {
    throw "Could not find desktop bundle prep script [$prepareDesktopBundleScript]."
}

if (-not $SkipDesktopBundle) {
    Write-Host "[SUITE] Preparing bundled desktop installer..." -ForegroundColor Cyan
    $bundleArgs = @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        $prepareDesktopBundleScript
    )
    if (-not [string]::IsNullOrWhiteSpace($DesktopSetupPath)) {
        $bundleArgs += @("-DesktopSetupPath", $DesktopSetupPath)
    }
    powershell @bundleArgs
}
else {
    Write-Host "[SUITE] Skipping desktop bundle preparation (requested)." -ForegroundColor Yellow
}

Push-Location $appRoot
try {
    Write-Host "[ELECTRON] Installing dependencies..." -ForegroundColor Cyan
    npm install

    if ($PortableOnly) {
        Write-Host "[ELECTRON] Building portable package..." -ForegroundColor Cyan
        npm run dist:portable
    }
    else {
        Write-Host "[ELECTRON] Building NSIS + portable packages..." -ForegroundColor Cyan
        npm run dist
    }
}
finally {
    Pop-Location
}
