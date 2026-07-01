[CmdletBinding()]
param(
    [string]$ServiceName = "SQLCockpitServiceHost",
    [string]$Configuration = "Release",
    [string]$RuntimeIdentifier = "win-x64",
    [ValidateSet("prod", "dev", "default")]
    [string]$SettingsProfile = "prod",
    [ValidateSet("", "dev", "test", "prod")]
    [string]$EnvironmentId = "",
    [string]$SettingsPath = "",
    [string]$ReleaseVersion = "",
    [string]$BuildSha = "",
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

function Get-LaneDefaults {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("dev", "test", "prod")]
        [string]$EnvironmentId
    )

    switch ($EnvironmentId) {
        "dev" {
            return @{
                ServiceName = "SQLCockpitServiceHost.Dev"
                DisplayName = "SQL Cockpit Service Host (Dev)"
                SettingsProfile = "dev"
                ControlPort = 8610
                ApiPort = 8080
                DocsPort = 8001
                NotificationsPort = 8090
                ObjectSearchPort = 8094
                RuntimeProfile = "dev"
            }
        }
        "test" {
            return @{
                ServiceName = "SQLCockpitServiceHost.Test"
                DisplayName = "SQL Cockpit Service Host (Test)"
                SettingsProfile = "prod"
                ControlPort = 8620
                ApiPort = 8200
                DocsPort = 8201
                NotificationsPort = 8290
                ObjectSearchPort = 8294
                RuntimeProfile = "prod"
            }
        }
        default {
            return @{
                ServiceName = "SQLCockpitServiceHost.Prod"
                DisplayName = "SQL Cockpit Service Host (Prod)"
                SettingsProfile = "prod"
                ControlPort = 8630
                ApiPort = 8300
                DocsPort = 8301
                NotificationsPort = 8390
                ObjectSearchPort = 8394
                RuntimeProfile = "prod"
            }
        }
    }
}

function Set-ArgPair {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Args,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $next = @($Args)
    for ($index = 0; $index -lt $next.Count; $index += 1) {
        if ([string]::Equals([string]$next[$index], $Name, [System.StringComparison]::OrdinalIgnoreCase)) {
            if ($index + 1 -lt $next.Count) {
                $next[$index + 1] = $Value
            } else {
                $next += $Value
            }
            return @($next)
        }
    }
    return @($next + @($Name, $Value))
}

function Set-ServiceSettingsLane {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SettingsPath,
        [Parameter(Mandatory = $true)]
        [string]$EnvironmentId,
        [Parameter(Mandatory = $true)]
        [hashtable]$Defaults,
        [string]$ReleaseVersion,
        [string]$BuildSha
    )

    $settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
    $settingsDirectory = Split-Path -Path $SettingsPath -Parent
    $programDataRoot = Join-Path -Path $env:ProgramData -ChildPath "SqlCockpit\$EnvironmentId"
    $objectSearchSettingsPath = Join-Path -Path $settingsDirectory -ChildPath "sql-object-search.$EnvironmentId.settings.json"
    $settings.environmentId = $EnvironmentId
    $settings.channelName = $EnvironmentId
    $settings.serviceName = $Defaults.ServiceName
    $settings.releaseVersion = $ReleaseVersion
    $settings.buildSha = $BuildSha
    $settings.listenPrefix = "http://127.0.0.1:$($Defaults.ControlPort)/"
    $settings.dataRoot = Join-Path -Path $programDataRoot -ChildPath "data"
    $settings.logsRoot = Join-Path -Path $programDataRoot -ChildPath "Logs"

    foreach ($component in @($settings.components)) {
        $id = [string]$component.id
        if ($id -eq "web-api") {
            $component.args = Set-ArgPair -Args $component.args -Name "--listenPrefix" -Value "http://127.0.0.1:$($Defaults.ApiPort)/"
            $component.args = Set-ArgPair -Args $component.args -Name "--notificationsListenPrefix" -Value "http://127.0.0.1:$($Defaults.NotificationsPort)/"
            $component.args = Set-ArgPair -Args $component.args -Name "--runtimeProfile" -Value $Defaults.RuntimeProfile
            $component.args = Set-ArgPair -Args $component.args -Name "--serviceHostControlUrl" -Value $settings.listenPrefix
            $component.args = Set-ArgPair -Args $component.args -Name "--environmentId" -Value $EnvironmentId
            $component.args = Set-ArgPair -Args $component.args -Name "--objectSearchSettingsPath" -Value $objectSearchSettingsPath
            $component.healthUrl = "http://127.0.0.1:$($Defaults.ApiPort)/health"
        }
        elseif ($id -eq "docs") {
            $component.args = Set-ArgPair -Args $component.args -Name "-ListenPrefix" -Value "http://127.0.0.1:$($Defaults.DocsPort)/"
            $component.healthUrl = "http://127.0.0.1:$($Defaults.DocsPort)/"
        }
        elseif ($id -eq "notifications") {
            $component.args = Set-ArgPair -Args $component.args -Name "-ListenPrefix" -Value "http://127.0.0.1:$($Defaults.NotificationsPort)/"
            $component.healthUrl = "http://127.0.0.1:$($Defaults.NotificationsPort)/health"
        }
        elseif ($id -eq "object-search") {
            $component.args = Set-ArgPair -Args $component.args -Name "-SettingsPath" -Value $objectSearchSettingsPath
            $component.healthUrl = "http://127.0.0.1:$($Defaults.ObjectSearchPort)/health"
        }
        elseif ($id -eq "desktop-app") {
            $component.args = Set-ArgPair -Args $component.args -Name "-ListenPrefix" -Value "http://127.0.0.1:$($Defaults.ApiPort)/"
            $component.args = Set-ArgPair -Args $component.args -Name "-NotificationsListenPrefix" -Value "http://127.0.0.1:$($Defaults.NotificationsPort)/"
            $component.args = Set-ArgPair -Args $component.args -Name "-DocsListenPrefix" -Value "http://127.0.0.1:$($Defaults.DocsPort)/"
            $component.args = Set-ArgPair -Args $component.args -Name "-RuntimeProfile" -Value $Defaults.RuntimeProfile
            $component.args = Set-ArgPair -Args $component.args -Name "-ServiceHostControlUrl" -Value $settings.listenPrefix
        }
    }

    $json = $settings | ConvertTo-Json -Depth 60
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($SettingsPath, $json, $utf8NoBom)

    $baseObjectSearchSettingsPath = Join-Path -Path ([string]$settings.objectSearchRepoRoot) -ChildPath "sql-object-search.settings.json"
    if ((Test-Path -LiteralPath $baseObjectSearchSettingsPath -PathType Leaf) -and -not (Test-Path -LiteralPath $objectSearchSettingsPath -PathType Leaf)) {
        $objectSearchSettings = Get-Content -LiteralPath $baseObjectSearchSettingsPath -Raw | ConvertFrom-Json
        $objectSearchSettings.service.listenUrl = "http://127.0.0.1:$($Defaults.ObjectSearchPort)/"
        $objectSearchSettings.service.indexRoot = Join-Path -Path $settings.dataRoot -ChildPath "object-search\index"
        $objectSearchSettings.sync.statusPath = Join-Path -Path $settings.dataRoot -ChildPath "object-search\sync-status.json"
        $objectSearchSettings.sync.manifestDirectory = Join-Path -Path $settings.dataRoot -ChildPath "object-search\manifests"
        $objectSearchSettings.sync.spoolDirectory = Join-Path -Path $settings.dataRoot -ChildPath "object-search\spool"
        $objectSearchSettings.sync.logPath = Join-Path -Path $settings.logsRoot -ChildPath "ObjectSearch\sync.log"
        $objectSearchJson = $objectSearchSettings | ConvertTo-Json -Depth 60
        [System.IO.File]::WriteAllText($objectSearchSettingsPath, $objectSearchJson, $utf8NoBom)
    }
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
$laneDefaults = $null
if (-not [string]::IsNullOrWhiteSpace($EnvironmentId)) {
    $laneDefaults = Get-LaneDefaults -EnvironmentId $EnvironmentId
    if (-not $PSBoundParameters.ContainsKey("ServiceName")) {
        $ServiceName = $laneDefaults.ServiceName
    }
    if (-not $PSBoundParameters.ContainsKey("SettingsProfile")) {
        $SettingsProfile = $laneDefaults.SettingsProfile
    }
}
$publishLeaf = if ($laneDefaults) { "$RuntimeIdentifier-$EnvironmentId" } else { $RuntimeIdentifier }
$publishPath = Join-Path -Path $serviceRoot -ChildPath ("publish\" + $publishLeaf)
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
    $settingsDirectory = if ($laneDefaults) {
        Join-Path -Path $env:ProgramData -ChildPath "SqlCockpit\$EnvironmentId"
    } else {
        Join-Path -Path $env:ProgramData -ChildPath "SqlCockpit"
    }
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
    if ($laneDefaults) {
        Set-ServiceSettingsLane -SettingsPath $SettingsPath -EnvironmentId $EnvironmentId -Defaults $laneDefaults -ReleaseVersion $ReleaseVersion -BuildSha $BuildSha
    }
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
        -DisplayName $(if ($laneDefaults) { $laneDefaults.DisplayName } else { "SQL Cockpit Service Host" }) `
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
