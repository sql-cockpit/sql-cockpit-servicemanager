[CmdletBinding()]
param(
    [string]$ServiceName = "SQLCockpitServiceHost"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$service = $null
try {
    $service = Get-Service -Name $ServiceName -ErrorAction Stop
}
catch {
    Write-Host "[SERVICE] Service [$ServiceName] does not exist." -ForegroundColor Yellow
    return
}

if ($service.Status -ne "Stopped") {
    Write-Host "[SERVICE] Stopping [$ServiceName]..." -ForegroundColor Cyan
    Stop-Service -Name $ServiceName -Force
}

Write-Host "[SERVICE] Deleting [$ServiceName]..." -ForegroundColor Cyan
& sc.exe delete $ServiceName | Out-Host
Write-Host "[SERVICE] Uninstall complete." -ForegroundColor Green
