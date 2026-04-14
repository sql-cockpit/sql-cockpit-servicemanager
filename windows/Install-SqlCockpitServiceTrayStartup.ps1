[CmdletBinding()]
param(
    [string]$TaskName = "SQLCockpitServiceTrayAtLogon",
    [string]$ExecutablePath = "",
    [string]$SettingsPath = "",
    [switch]$SkipPublish,
    [switch]$RunImmediately,
    [switch]$UseHighestPrivileges
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = $PSScriptRoot
$repoRoot = Split-Path -Path $scriptRoot -Parent
$publishScriptPath = Join-Path -Path $scriptRoot -ChildPath "Publish-SqlCockpitServiceControlElectron.ps1"

if ([string]::IsNullOrWhiteSpace($SettingsPath)) {
    $SettingsPath = Join-Path -Path $env:ProgramData -ChildPath "SqlCockpit\sql-cockpit-service.settings.json"
}

if (-not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
    throw "Could not find service settings file [$SettingsPath]."
}

if ([string]::IsNullOrWhiteSpace($ExecutablePath)) {
    $candidatePaths = New-Object System.Collections.Generic.List[string]
    $candidatePaths.Add((Join-Path -Path $scriptRoot -ChildPath "publish\electron-control\win-unpacked\SQL Cockpit Service Control.exe"))
    $candidatePaths.Add((Join-Path -Path $repoRoot -ChildPath "publish\electron-control\win-unpacked\SQL Cockpit Service Control.exe"))

    $publishRoots = @(
        (Join-Path -Path $scriptRoot -ChildPath "publish"),
        (Join-Path -Path $repoRoot -ChildPath "publish")
    ) | Select-Object -Unique

    foreach ($publishRoot in $publishRoots) {
        if (-not (Test-Path -LiteralPath $publishRoot -PathType Container)) {
            continue
        }

        $buildDirectories = Get-ChildItem -Path $publishRoot -Directory -Filter "electron-control*" -ErrorAction SilentlyContinue |
            Sort-Object -Property LastWriteTime -Descending
        foreach ($buildDirectory in $buildDirectories) {
            $candidatePaths.Add((Join-Path -Path $buildDirectory.FullName -ChildPath "win-unpacked\SQL Cockpit Service Control.exe"))
        }
    }

    $ExecutablePath = $candidatePaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($ExecutablePath)) {
        $ExecutablePath = $candidatePaths | Select-Object -First 1
    }
}

if (-not $SkipPublish) {
    if (-not (Test-Path -LiteralPath $publishScriptPath -PathType Leaf)) {
        throw "Could not find publish script [$publishScriptPath]."
    }

    Write-Host "[TRAY] Publishing Electron service control app before task registration..." -ForegroundColor Cyan
    powershell -NoProfile -ExecutionPolicy Bypass -File $publishScriptPath
}

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
    throw "Electron service control executable was not found at [$ExecutablePath]. Run Publish-SqlCockpitServiceControlElectron.ps1 or pass -ExecutablePath."
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$userName = $currentIdentity.Name
if ([string]::IsNullOrWhiteSpace($userName)) {
    throw "Could not resolve current Windows user identity for task registration."
}

$taskAction = New-ScheduledTaskAction -Execute $ExecutablePath -Argument ("--settings `"" + $SettingsPath + "`"")
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userName
$taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId $userName `
    -LogonType Interactive `
    -RunLevel ($(if ($UseHighestPrivileges) { "Highest" } else { "Limited" }))
$taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Write-Host "[TRAY] Registering scheduled task [$TaskName] for user [$userName]..." -ForegroundColor Cyan
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Principal $taskPrincipal `
    -Settings $taskSettings `
    -Description "Starts SQL Cockpit Service Control Electron app at user logon." `
    -Force | Out-Null

Write-Host "[TRAY] Scheduled task registered successfully." -ForegroundColor Green
Write-Host "[TRAY] TaskName: $TaskName" -ForegroundColor DarkCyan
Write-Host "[TRAY] Executable: $ExecutablePath" -ForegroundColor DarkCyan
Write-Host "[TRAY] SettingsPath: $SettingsPath" -ForegroundColor DarkCyan

if ($RunImmediately) {
    Write-Host "[TRAY] Starting scheduled task now..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
}
