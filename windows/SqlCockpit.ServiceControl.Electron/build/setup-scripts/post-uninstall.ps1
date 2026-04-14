[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-BestEffortScript {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,
        [string[]]$Arguments = @()
    )

    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        return
    }

    try {
        powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
    } catch {
        Write-Host "[UNINSTALL] Ignored failure from [$ScriptPath]: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$setupRoot = Split-Path -Path $PSScriptRoot -Parent
$windowsSetupRoot = Join-Path -Path $setupRoot -ChildPath "windows"

$uninstallTrayScript = Join-Path -Path $windowsSetupRoot -ChildPath "Uninstall-SqlCockpitServiceTrayStartup.ps1"
$uninstallServiceScript = Join-Path -Path $windowsSetupRoot -ChildPath "Uninstall-SqlCockpitWindowsService.ps1"

Invoke-BestEffortScript -ScriptPath $uninstallTrayScript -Arguments @("-TaskName", "SQLCockpitServiceTrayAtLogon")
Invoke-BestEffortScript -ScriptPath $uninstallServiceScript -Arguments @("-ServiceName", "SQLCockpitServiceHost")
