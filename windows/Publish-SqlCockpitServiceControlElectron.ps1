[CmdletBinding()]
param(
    [switch]$PortableOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$appRoot = Join-Path -Path $PSScriptRoot -ChildPath "SqlCockpit.ServiceControl.Electron"
$packagePath = Join-Path -Path $appRoot -ChildPath "package.json"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "Could not find Electron service control app package [$packagePath]."
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
