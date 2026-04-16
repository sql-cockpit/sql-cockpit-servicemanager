[CmdletBinding()]
param(
    [string]$ServiceName = "SQLCockpitServiceHost"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ServiceProcessId {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $queryOutput = & sc.exe queryex $Name 2>$null
    if (-not $queryOutput) {
        return 0
    }

    foreach ($line in $queryOutput) {
        if ($line -match "PID\s*:\s*(\d+)") {
            return [int]$matches[1]
        }
    }

    return 0
}

function Stop-ServiceSafely {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $svc = Get-Service -Name $Name -ErrorAction Stop
    if ($svc.Status -eq "Stopped") {
        return
    }

    try {
        Stop-Service -Name $Name -Force -ErrorAction Stop
        Start-Sleep -Seconds 1
    } catch {
        Write-Host "[SERVICE] Graceful stop failed for [$Name], attempting process termination..." -ForegroundColor Yellow
    }

    $svc = Get-Service -Name $Name -ErrorAction Stop
    if ($svc.Status -eq "Stopped") {
        return
    }

    $servicePid = Get-ServiceProcessId -Name $Name
    if ($servicePid -gt 0) {
        Write-Host "[SERVICE] Terminating stuck service process PID [$servicePid]..." -ForegroundColor Yellow
        & taskkill.exe /F /PID $servicePid | Out-Null
        Start-Sleep -Seconds 1
    }
}

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
    Stop-ServiceSafely -Name $ServiceName
}

Write-Host "[SERVICE] Deleting [$ServiceName]..." -ForegroundColor Cyan
& sc.exe delete $ServiceName | Out-Host
Write-Host "[SERVICE] Uninstall complete." -ForegroundColor Green
