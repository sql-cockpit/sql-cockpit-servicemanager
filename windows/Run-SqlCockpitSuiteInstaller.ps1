[CmdletBinding()]
param(
    [string]$InstallerPath = "",
    [switch]$SkipServiceStop,
    [switch]$NoWait
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-InstallerPath {
    param(
        [string]$ExplicitPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $resolved = [System.IO.Path]::GetFullPath($ExplicitPath)
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Installer was not found at [$resolved]."
        }
        return $resolved
    }

    $publishRoot = Join-Path -Path $PSScriptRoot -ChildPath "publish"
    if (-not (Test-Path -LiteralPath $publishRoot -PathType Container)) {
        throw "Publish directory does not exist at [$publishRoot]. Build installer first."
    }

    $latest = Get-ChildItem -Path $publishRoot -Recurse -File -Filter "SQL Cockpit Service Control Setup*.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1 -ExpandProperty FullName

    if ([string]::IsNullOrWhiteSpace($latest)) {
        throw "Could not find suite installer under [$publishRoot]."
    }

    return $latest
}

Write-Host "[SUITE] Preparing machine for installer..." -ForegroundColor Cyan

# Stop app/tray instances that commonly lock installer files.
$processNames = @("SQL Cockpit Service Control", "electron", "node")
foreach ($name in $processNames) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# Stop scheduled task so it does not immediately relaunch the app during install.
Stop-ScheduledTask -TaskName "SQLCockpitServiceTrayAtLogon" -ErrorAction SilentlyContinue

if (-not $SkipServiceStop) {
    Stop-Service -Name "SQLCockpitServiceHost" -ErrorAction SilentlyContinue
}

$resolvedInstaller = Resolve-InstallerPath -ExplicitPath $InstallerPath
Write-Host "[SUITE] Launching installer: $resolvedInstaller" -ForegroundColor Green

if ($NoWait) {
    Start-Process -FilePath $resolvedInstaller | Out-Null
}
else {
    $proc = Start-Process -FilePath $resolvedInstaller -PassThru
    $proc.WaitForExit()
    Write-Host "[SUITE] Installer exit code: $($proc.ExitCode)" -ForegroundColor DarkCyan
}
