[CmdletBinding()]
param(
    [string]$ServiceName = "SQLCockpitServiceHost",
    [string]$Configuration = "Release",
    [string]$RuntimeIdentifier = "win-x64",
    [ValidateSet("prod", "dev", "default")]
    [string]$SettingsProfile = "prod",
    [string]$SettingsPath = "",
    [switch]$StartAfterInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "Install-SqlCockpitWindowsService.ps1 must be run from an elevated PowerShell session (Run as Administrator)."
}

$serviceRoot = Split-Path -Path $PSScriptRoot -Parent
$projectPath = Join-Path -Path $PSScriptRoot -ChildPath "SqlCockpit.ServiceHost.Windows\SqlCockpit.ServiceHost.Windows.csproj"
$publishPath = Join-Path -Path $serviceRoot -ChildPath ("publish\" + $RuntimeIdentifier)
$publishedExePath = Join-Path -Path $publishPath -ChildPath "SqlCockpit.ServiceHost.Windows.exe"
$templateSettingsPath = switch ($SettingsProfile) {
    "prod" { Join-Path -Path $PSScriptRoot -ChildPath "sql-cockpit-service.prod.settings.json" }
    "dev" { Join-Path -Path $PSScriptRoot -ChildPath "sql-cockpit-service.dev.settings.json" }
    default { Join-Path -Path $PSScriptRoot -ChildPath "sql-cockpit-service.settings.json" }
}

if (-not (Test-Path -LiteralPath $projectPath -PathType Leaf)) {
    throw "Could not find project [$projectPath]."
}

if (-not (Test-Path -LiteralPath $templateSettingsPath -PathType Leaf)) {
    throw "Could not find settings template [$templateSettingsPath]."
}

if ([string]::IsNullOrWhiteSpace($SettingsPath)) {
    $settingsDirectory = Join-Path -Path $env:ProgramData -ChildPath "SqlCockpit"
    if (-not (Test-Path -LiteralPath $settingsDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $settingsDirectory | Out-Null
    }

    $SettingsPath = Join-Path -Path $settingsDirectory -ChildPath "sql-cockpit-service.settings.json"
}

Write-Host "[SERVICE] Publishing Windows service host..." -ForegroundColor Cyan
dotnet publish $projectPath -c $Configuration -r $RuntimeIdentifier --self-contained false -o $publishPath

if (-not (Test-Path -LiteralPath $publishedExePath -PathType Leaf)) {
    throw "Publish succeeded but executable was not found at [$publishedExePath]."
}

if (-not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
    Copy-Item -LiteralPath $templateSettingsPath -Destination $SettingsPath
    Write-Host "[SERVICE] Created settings file: $SettingsPath (profile: $SettingsProfile)" -ForegroundColor Yellow
}
else {
    Write-Host "[SERVICE] Reusing existing settings file: $SettingsPath" -ForegroundColor Yellow
    Write-Host "[SERVICE] Existing settings were not overwritten. Requested profile template: $SettingsProfile" -ForegroundColor Yellow
}

$serviceArgs = "--settings `"$SettingsPath`""
$binPath = "`"$publishedExePath`" $serviceArgs"

$serviceExists = $false
try {
    $existingService = Get-Service -Name $ServiceName -ErrorAction Stop
    $serviceExists = $null -ne $existingService
}
catch {
}

if (-not $serviceExists) {
    Write-Host "[SERVICE] Creating service [$ServiceName]..." -ForegroundColor Cyan
    New-Service `
        -Name $ServiceName `
        -BinaryPathName $binPath `
        -DisplayName "SQL Cockpit Service Host" `
        -Description "SQL Cockpit SCM host for API-side process supervision." `
        -StartupType Automatic | Out-Null
}
else {
    Write-Host "[SERVICE] Updating service [$ServiceName]..." -ForegroundColor Cyan
    & sc.exe config $ServiceName binPath= $binPath start= auto | Out-Host
    & sc.exe description $ServiceName "SQL Cockpit SCM host for API-side process supervision." | Out-Host
}

$installedService = Get-Service -Name $ServiceName -ErrorAction Stop

if ($StartAfterInstall) {
    Write-Host "[SERVICE] Starting [$ServiceName]..." -ForegroundColor Green
    if ($installedService.Status -ne "Running") {
        Start-Service -Name $ServiceName
    }
}

Write-Host "[SERVICE] Install complete." -ForegroundColor Green
Write-Host "[SERVICE] EXE: $publishedExePath" -ForegroundColor DarkCyan
Write-Host "[SERVICE] Settings: $SettingsPath" -ForegroundColor DarkCyan
