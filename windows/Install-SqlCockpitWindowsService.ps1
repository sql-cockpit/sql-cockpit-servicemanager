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

function Write-JsonNoBomFromTemplate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TemplatePath,
        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    $value = Get-Content -LiteralPath $TemplatePath -Raw | ConvertFrom-Json
    $json = $value | ConvertTo-Json -Depth 40
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($DestinationPath, $json, $utf8NoBom)
}

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

 $serviceExists = $false
try {
    $existingService = Get-Service -Name $ServiceName -ErrorAction Stop
    $serviceExists = $null -ne $existingService
}
catch {
}

if ($serviceExists) {
    Write-Host "[SERVICE] Stopping existing service [$ServiceName] before publish to avoid file locks..." -ForegroundColor Cyan
    Stop-ServiceSafely -Name $ServiceName
}

Write-Host "[SERVICE] Publishing Windows service host..." -ForegroundColor Cyan
dotnet publish $projectPath -c $Configuration -r $RuntimeIdentifier --self-contained false -o $publishPath

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed for [$projectPath] with exit code [$LASTEXITCODE]."
}

if (-not (Test-Path -LiteralPath $publishedExePath -PathType Leaf)) {
    throw "Publish succeeded but executable was not found at [$publishedExePath]."
}

if (-not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
    Write-JsonNoBomFromTemplate -TemplatePath $templateSettingsPath -DestinationPath $SettingsPath
    Write-Host "[SERVICE] Created settings file: $SettingsPath (profile: $SettingsProfile)" -ForegroundColor Yellow
}
else {
    Write-Host "[SERVICE] Reusing existing settings file: $SettingsPath" -ForegroundColor Yellow
    Write-Host "[SERVICE] Existing settings were not overwritten. Requested profile template: $SettingsProfile" -ForegroundColor Yellow
}

$serviceArgs = "--settings `"$SettingsPath`""
$binPath = "`"$publishedExePath`" $serviceArgs"

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
    & sc.exe config $ServiceName "binPath= $binPath" "start= auto" | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "sc.exe config failed while updating [$ServiceName]."
    }
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
