[CmdletBinding()]
param(
    [string]$SettingsPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectPath = Join-Path -Path $PSScriptRoot -ChildPath "SqlCockpit.ServiceHost.Windows\SqlCockpit.ServiceHost.Windows.csproj"
if ([string]::IsNullOrWhiteSpace($SettingsPath)) {
    $SettingsPath = Join-Path -Path $PSScriptRoot -ChildPath "sql-cockpit-service.settings.json"
}

if (-not (Test-Path -LiteralPath $projectPath -PathType Leaf)) {
    throw "Could not find project [$projectPath]."
}

if (-not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
    throw "Could not find settings file [$SettingsPath]."
}

Write-Host "[SERVICE] Running host in console mode for local validation..." -ForegroundColor Cyan
dotnet run --project $projectPath -- --console --settings $SettingsPath
