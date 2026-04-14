[CmdletBinding()]
param(
    [string]$TaskName = "SQLCockpitServiceTrayAtLogon"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($null -ne $task) {
        Write-Host "[TRAY] Removing scheduled task [$TaskName]..." -ForegroundColor Cyan
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[TRAY] Scheduled task removed." -ForegroundColor Green
    }
}
catch {
    Write-Host "[TRAY] Scheduled task [$TaskName] was not found. Nothing to remove." -ForegroundColor Yellow
}
