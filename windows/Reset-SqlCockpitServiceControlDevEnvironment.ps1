[CmdletBinding()]
param(
    [string]$ServiceName = "SQLCockpitServiceHost",
    [string]$TrayTaskName = "SQLCockpitServiceTrayAtLogon",
    [string]$LegacyTrayTaskName = "SQLCockpitServiceControlAtLogon",
    [switch]$KeepServiceSettings,
    [switch]$SkipPublishCleanup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    return ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
        IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-BestEffort {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Description,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    try {
        & $Action
        Write-Host "[RESET] ${Description}: OK" -ForegroundColor Green
    } catch {
        Write-Host "[RESET] ${Description}: SKIPPED ($($_.Exception.Message))" -ForegroundColor Yellow
    }
}

function Remove-IfExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        Write-Host "[RESET] Removed [$Path]" -ForegroundColor Green
    } else {
        Write-Host "[RESET] Path not found [$Path]" -ForegroundColor DarkYellow
    }
}

if (-not (Test-IsAdministrator)) {
    throw "Reset-SqlCockpitServiceControlDevEnvironment.ps1 must be run from an elevated PowerShell session (Run as Administrator)."
}

$scriptRoot = $PSScriptRoot
$serviceRoot = Split-Path -Path $scriptRoot -Parent

$trayUninstallScript = Join-Path -Path $scriptRoot -ChildPath "Uninstall-SqlCockpitServiceTrayStartup.ps1"
$serviceUninstallScript = Join-Path -Path $scriptRoot -ChildPath "Uninstall-SqlCockpitWindowsService.ps1"

Write-Host "[RESET] Stopping local SQL Cockpit Service Control app processes..." -ForegroundColor Cyan
Invoke-BestEffort -Description "taskkill SQL Cockpit Service Control.exe" -Action { taskkill /F /IM "SQL Cockpit Service Control.exe" | Out-Null }
Invoke-BestEffort -Description "taskkill electron.exe" -Action { taskkill /F /IM "electron.exe" | Out-Null }
Invoke-BestEffort -Description "taskkill node.exe" -Action { taskkill /F /IM "node.exe" | Out-Null }

if (Test-Path -LiteralPath $trayUninstallScript -PathType Leaf) {
    Write-Host "[RESET] Removing tray startup tasks via uninstall script..." -ForegroundColor Cyan
    Invoke-BestEffort -Description "remove task [$TrayTaskName]" -Action {
        powershell -NoProfile -ExecutionPolicy Bypass -File $trayUninstallScript -TaskName $TrayTaskName
    }
    Invoke-BestEffort -Description "remove legacy task [$LegacyTrayTaskName]" -Action {
        powershell -NoProfile -ExecutionPolicy Bypass -File $trayUninstallScript -TaskName $LegacyTrayTaskName
    }
}

if (Test-Path -LiteralPath $serviceUninstallScript -PathType Leaf) {
    Write-Host "[RESET] Removing Windows service host..." -ForegroundColor Cyan
    Invoke-BestEffort -Description "remove service [$ServiceName]" -Action {
        powershell -NoProfile -ExecutionPolicy Bypass -File $serviceUninstallScript -ServiceName $ServiceName
    }
}

Write-Host "[RESET] Attempting uninstall from registered Windows uninstall entries..." -ForegroundColor Cyan
$uninstallEntries = Get-ItemProperty `
    HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*, `
    HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*, `
    HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "*SQL Cockpit Service Control*" }

foreach ($entry in $uninstallEntries) {
    $displayName = [string]$entry.DisplayName
    $uninstallString = [string]$entry.UninstallString
    if ([string]::IsNullOrWhiteSpace($uninstallString)) {
        continue
    }

    Invoke-BestEffort -Description "registry uninstall [$displayName]" -Action {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "$uninstallString /S" -Wait -NoNewWindow
    }
}

Write-Host "[RESET] Removing common installation leftovers..." -ForegroundColor Cyan
$pathsToRemove = @(
    (Join-Path -Path $env:LOCALAPPDATA -ChildPath "Programs\SQL Cockpit Service Control"),
    (Join-Path -Path $env:LOCALAPPDATA -ChildPath "sql-cockpit-service-control-updater"),
    (Join-Path -Path ${env:ProgramFiles} -ChildPath "SQL Cockpit Service Control"),
    (Join-Path -Path ${env:ProgramFiles(x86)} -ChildPath "SQL Cockpit Service Control")
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

foreach ($path in $pathsToRemove) {
    Invoke-BestEffort -Description "remove [$path]" -Action { Remove-IfExists -Path $path }
}

if (-not $KeepServiceSettings) {
    $settingsPath = Join-Path -Path $env:ProgramData -ChildPath "SqlCockpit\sql-cockpit-service.settings.json"
    Invoke-BestEffort -Description "remove service settings [$settingsPath]" -Action { Remove-IfExists -Path $settingsPath }
}
else {
    Write-Host "[RESET] Keeping service settings file under ProgramData." -ForegroundColor DarkCyan
}

if (-not $SkipPublishCleanup) {
    $servicePublishPath = Join-Path -Path $serviceRoot -ChildPath "publish\win-x64"
    Invoke-BestEffort -Description "remove service publish output [$servicePublishPath]" -Action { Remove-IfExists -Path $servicePublishPath }
}
else {
    Write-Host "[RESET] Skipping service publish output cleanup." -ForegroundColor DarkCyan
}

Write-Host "[RESET] Development reset complete." -ForegroundColor Green
Write-Host "[RESET] Next step: run installer, then verify service and control API health." -ForegroundColor DarkCyan
