[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$SettingsPath = "",
    [string]$DesktopInstallerPath = "",
    [string]$DesktopExecutablePath = "",
    [switch]$SkipDesktopInstall,
    [switch]$SkipServiceInstall,
    [switch]$RunTrayNow = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    return ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
        IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-DotNetSdk {
    $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        throw "dotnet SDK is required to provision SQLCockpitServiceHost."
    }
}

function Write-JsonNoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 40
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Resolve-DesktopSetupPath {
    param(
        [string]$ExplicitPath,
        [string]$SetupRoot,
        [string]$WindowsSetupRoot
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $resolved = [System.IO.Path]::GetFullPath($ExplicitPath)
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Desktop setup executable was not found at [$resolved]."
        }
        return $resolved
    }

    $repoRoot = Split-Path -Path (Split-Path -Path $WindowsSetupRoot -Parent) -Parent
    $candidates = @(
        (Join-Path -Path $SetupRoot -ChildPath "desktop\SQL Cockpit setup.exe"),
        (Join-Path -Path $SetupRoot -ChildPath "desktop\SQL Cockpit Setup.exe"),
        (Join-Path -Path $WindowsSetupRoot -ChildPath "DesktopBundle\SQL Cockpit setup.exe"),
        (Join-Path -Path $WindowsSetupRoot -ChildPath "DesktopBundle\SQL Cockpit Setup.exe")
    )

    $publishRoots = @(
        (Join-Path -Path $repoRoot -ChildPath "webapp\publish"),
        (Join-Path -Path $repoRoot -ChildPath "webapp\desktop-publish"),
        (Join-Path -Path $repoRoot -ChildPath "desktop-publish")
    )
    foreach ($publishRoot in $publishRoots) {
        if (-not (Test-Path -LiteralPath $publishRoot -PathType Container)) {
            continue
        }

        $latestSetup = Get-ChildItem -Path $publishRoot -Recurse -File -Filter "SQL Cockpit setup*.exe" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1 -ExpandProperty FullName
        if (-not [string]::IsNullOrWhiteSpace($latestSetup)) {
            $candidates += $latestSetup
        }
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    throw "Desktop setup executable is missing. Checked installer resources, DesktopBundle, and webapp publish output. Run Prepare-SqlCockpitSuiteDesktopBundle.ps1 or pass -DesktopInstallerPath."
}

function Resolve-DesktopExecutablePath {
    param(
        [string]$ExplicitPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $resolved = [System.IO.Path]::GetFullPath($ExplicitPath)
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Desktop executable path does not exist: [$resolved]"
        }
        return $resolved
    }

    $candidates = @(
        (Join-Path -Path $env:ProgramFiles -ChildPath "SQL Cockpit\SQL Cockpit.exe"),
        (Join-Path -Path $env:ProgramFiles -ChildPath "SQL Cockpit\SQL Cockpit portable.exe"),
        (Join-Path -Path ${env:ProgramFiles(x86)} -ChildPath "SQL Cockpit\SQL Cockpit.exe"),
        (Join-Path -Path $env:LOCALAPPDATA -ChildPath "Programs\SQL Cockpit\SQL Cockpit.exe")
    )

    foreach ($candidate in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }

    throw "Could not find installed SQL Cockpit desktop executable after install."
}

function Set-ArgPair {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.List[string]]$ArgsList,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $index = -1
    for ($i = 0; $i -lt $ArgsList.Count; $i += 1) {
        if ($ArgsList[$i].ToLowerInvariant() -eq $Name.ToLowerInvariant()) {
            $index = $i
            break
        }
    }

    if ($index -ge 0) {
        if ($index + 1 -lt $ArgsList.Count) {
            $ArgsList[$index + 1] = $Value
        } else {
            $ArgsList.Add($Value) | Out-Null
        }
    } else {
        $ArgsList.Add($Name) | Out-Null
        $ArgsList.Add($Value) | Out-Null
    }
}

function Set-OrAddProperty {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Target,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $false)]
        $Value
    )

    $existing = $Target.PSObject.Properties[$Name]
    if ($null -ne $existing) {
        $existing.Value = $Value
    }
    else {
        $Target | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

function Ensure-DesktopComponentSettings {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SettingsFilePath,
        [Parameter(Mandatory = $true)]
        [string]$TemplateSettingsPath,
        [Parameter(Mandatory = $true)]
        [string]$DesktopExePath
    )

    $settings = Get-Content -LiteralPath $SettingsFilePath -Raw | ConvertFrom-Json
    $repoRootValue = [string]$settings.repoRoot
    if ([string]::IsNullOrWhiteSpace($repoRootValue)) {
        $repoRootValue = Split-Path -Path (Split-Path -Path $SettingsFilePath -Parent) -Parent
    }
    $apiRepoRootValue = [string]$settings.apiRepoRoot
    if ([string]::IsNullOrWhiteSpace($apiRepoRootValue)) {
        $apiRepoRootValue = Join-Path -Path $repoRootValue -ChildPath "sql-cockpit-api"
    }
    $desktopRepoRootValue = [string]$settings.desktopRepoRoot
    if ([string]::IsNullOrWhiteSpace($desktopRepoRootValue)) {
        $desktopRepoRootValue = Join-Path -Path $repoRootValue -ChildPath "webapp"
    }
    $serviceRepoRootValue = [string]$settings.serviceRepoRoot
    if ([string]::IsNullOrWhiteSpace($serviceRepoRootValue)) {
        $serviceRepoRootValue = Join-Path -Path $repoRootValue -ChildPath "service"
    }
    $objectSearchRepoRootValue = [string]$settings.objectSearchRepoRoot
    if ([string]::IsNullOrWhiteSpace($objectSearchRepoRootValue)) {
        $objectSearchRepoRootValue = Join-Path -Path $repoRootValue -ChildPath "object-search"
    }
    Set-OrAddProperty -Target $settings -Name "desktopRepoRoot" -Value $desktopRepoRootValue
    Set-OrAddProperty -Target $settings -Name "apiRepoRoot" -Value $apiRepoRootValue
    Set-OrAddProperty -Target $settings -Name "serviceRepoRoot" -Value $serviceRepoRootValue
    Set-OrAddProperty -Target $settings -Name "objectSearchRepoRoot" -Value $objectSearchRepoRootValue

    if (-not $settings.components) {
        $settings | Add-Member -MemberType NoteProperty -Name components -Value @()
    }

    $components = @($settings.components)
    $desktop = $components | Where-Object { $_.id -eq "desktop-app" } | Select-Object -First 1
    if ($null -eq $desktop) {
        $template = Get-Content -LiteralPath $TemplateSettingsPath -Raw | ConvertFrom-Json
        $templateDesktop = @($template.components | Where-Object { $_.id -eq "desktop-app" } | Select-Object -First 1)
        if (-not $templateDesktop.Count) {
            throw "Desktop component template was not found in [$TemplateSettingsPath]."
        }
        $desktop = $templateDesktop[0]
        $components += $desktop
        $settings.components = $components
    }

    Set-OrAddProperty -Target $desktop -Name "disabled" -Value $false
    Set-OrAddProperty -Target $desktop -Name "autoStart" -Value $false
    Set-OrAddProperty -Target $desktop -Name "autoRestart" -Value $false
    Set-OrAddProperty -Target $desktop -Name "command" -Value "powershell.exe"
    Set-OrAddProperty -Target $desktop -Name "workingDirectory" -Value "{ServiceRepoRoot}"

    $argsList = [System.Collections.Generic.List[string]]::new()
    foreach ($value in @($desktop.args)) {
        $argsList.Add([string]$value) | Out-Null
    }

    Set-ArgPair -ArgsList $argsList -Name "-File" -Value "{RepoRoot}\Start-SqlCockpitDesktopPackaged.ps1"
    Set-ArgPair -ArgsList $argsList -Name "-RuntimeProfile" -Value "prod"
    Set-ArgPair -ArgsList $argsList -Name "-ManageComponents" -Value "false"
    Set-ArgPair -ArgsList $argsList -Name "-ExternalApiOnly" -Value "true"
    Set-ArgPair -ArgsList $argsList -Name "-DesktopExecutablePath" -Value $DesktopExePath
    Set-ArgPair -ArgsList $argsList -Name "-ServiceHostControlUrl" -Value "http://127.0.0.1:8610/"

    Set-ArgPair -ArgsList $argsList -Name "-ListenPrefix" -Value "http://127.0.0.1:8000/"
    Set-ArgPair -ArgsList $argsList -Name "-DocsListenPrefix" -Value "http://127.0.0.1:8001/"
    Set-ArgPair -ArgsList $argsList -Name "-NotificationsListenPrefix" -Value "http://127.0.0.1:8090/"

    $desktop.args = @($argsList.ToArray())

    $docsComponent = @($settings.components | Where-Object { $_.id -eq "docs" } | Select-Object -First 1)
    if ($docsComponent.Count) {
        $docs = $docsComponent[0]
        Set-OrAddProperty -Target $docs -Name "healthUrl" -Value "http://127.0.0.1:8001/"

        $docsArgs = [System.Collections.Generic.List[string]]::new()
        foreach ($value in @($docs.args)) {
            $docsArgs.Add([string]$value) | Out-Null
        }
        Set-ArgPair -ArgsList $docsArgs -Name "-ListenPrefix" -Value "http://127.0.0.1:8001/"
        $docs.args = @($docsArgs.ToArray())
    }

    $webApiComponent = @($settings.components | Where-Object { $_.id -eq "web-api" } | Select-Object -First 1)
    if ($webApiComponent.Count) {
        $webApi = $webApiComponent[0]
        Set-OrAddProperty -Target $webApi -Name "workingDirectory" -Value "{ApiRepoRoot}"
        Set-OrAddProperty -Target $webApi -Name "healthUrl" -Value "http://127.0.0.1:8000/health"

        $webApiArgs = [System.Collections.Generic.List[string]]::new()
        foreach ($value in @($webApi.args)) {
            $webApiArgs.Add([string]$value) | Out-Null
        }
        Set-ArgPair -ArgsList $webApiArgs -Name "--listenPrefix" -Value "http://127.0.0.1:8000/"
        Set-ArgPair -ArgsList $webApiArgs -Name "--notificationsListenPrefix" -Value "http://127.0.0.1:8090/"
        Set-ArgPair -ArgsList $webApiArgs -Name "--runtimeProfile" -Value "prod"
        Set-ArgPair -ArgsList $webApiArgs -Name "--manageComponents" -Value "false"
        Set-ArgPair -ArgsList $webApiArgs -Name "--serviceHostControlUrl" -Value "http://127.0.0.1:8610/"
        $webApi.args = @($webApiArgs.ToArray())
    }

    $objectSearchComponent = @($settings.components | Where-Object { $_.id -eq "object-search" } | Select-Object -First 1)
    if ($objectSearchComponent.Count) {
        $objectSearch = $objectSearchComponent[0]
        Set-OrAddProperty -Target $objectSearch -Name "workingDirectory" -Value "{ObjectSearchRepoRoot}"
        Set-OrAddProperty -Target $objectSearch -Name "healthUrl" -Value "http://127.0.0.1:8094/health"

        $objectSearchArgs = [System.Collections.Generic.List[string]]::new()
        foreach ($value in @($objectSearch.args)) {
            $objectSearchArgs.Add([string]$value) | Out-Null
        }
        Set-ArgPair -ArgsList $objectSearchArgs -Name "-File" -Value "{ObjectSearchRepoRoot}\Start-SqlObjectSearchService.ps1"
        Set-ArgPair -ArgsList $objectSearchArgs -Name "-SettingsPath" -Value "{ObjectSearchRepoRoot}\sql-object-search.settings.json"
        $objectSearch.args = @($objectSearchArgs.ToArray())
    }

    Write-JsonNoBom -Path $SettingsFilePath -Value $settings
}

function Resolve-ServiceControlExecutable {
    param(
        [string]$InstallRoot
    )

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($InstallRoot)) {
        $candidates += (Join-Path -Path $InstallRoot -ChildPath "SQL Cockpit Service Control.exe")
    }
    $candidates += (Join-Path -Path $env:ProgramFiles -ChildPath "SQL Cockpit Service Control\SQL Cockpit Service Control.exe")

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    throw "Could not resolve SQL Cockpit Service Control executable path."
}

function Test-ControlApiHealth {
    param(
        [string]$Url = "http://127.0.0.1:8610/health",
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 750
        }
    } while ((Get-Date) -lt $deadline)

    return $false
}

if (-not (Test-IsAdministrator)) {
    throw "Repair-SqlCockpitSuite.ps1 must be run from an elevated PowerShell session (Run as Administrator)."
}

Assert-DotNetSdk

$windowsSetupRoot = $PSScriptRoot
$setupRoot = Split-Path -Path $windowsSetupRoot -Parent
$installServiceScript = Join-Path -Path $windowsSetupRoot -ChildPath "Install-SqlCockpitWindowsService.ps1"
$installTrayScript = Join-Path -Path $windowsSetupRoot -ChildPath "Install-SqlCockpitServiceTrayStartup.ps1"
$templateSettingsPath = Join-Path -Path $windowsSetupRoot -ChildPath "sql-cockpit-service.prod.settings.json"

if (-not (Test-Path -LiteralPath $installServiceScript -PathType Leaf)) {
    throw "Missing suite script [$installServiceScript]."
}
if (-not (Test-Path -LiteralPath $installTrayScript -PathType Leaf)) {
    throw "Missing suite script [$installTrayScript]."
}
if (-not (Test-Path -LiteralPath $templateSettingsPath -PathType Leaf)) {
    throw "Missing suite settings template [$templateSettingsPath]."
}

if ([string]::IsNullOrWhiteSpace($SettingsPath)) {
    $settingsDir = Join-Path -Path $env:ProgramData -ChildPath "SqlCockpit"
    if (-not (Test-Path -LiteralPath $settingsDir -PathType Container)) {
        New-Item -ItemType Directory -Path $settingsDir | Out-Null
    }
    $SettingsPath = Join-Path -Path $settingsDir -ChildPath "sql-cockpit-service.settings.json"
}

if (-not $SkipDesktopInstall) {
    $desktopSetup = Resolve-DesktopSetupPath -ExplicitPath $DesktopInstallerPath -SetupRoot $setupRoot -WindowsSetupRoot $windowsSetupRoot
    Write-Host "[SUITE] Installing SQL Cockpit Desktop app..." -ForegroundColor Cyan
    $desktopInstall = Start-Process -FilePath $desktopSetup -ArgumentList @("/S", "/ALLUSERS") -PassThru -Wait
    if ($desktopInstall.ExitCode -ne 0) {
        throw "Desktop installer failed with exit code [$($desktopInstall.ExitCode)]."
    }
}

$resolvedDesktopExe = Resolve-DesktopExecutablePath -ExplicitPath $DesktopExecutablePath
Write-Host "[SUITE] Desktop executable: $resolvedDesktopExe" -ForegroundColor DarkCyan

if (-not $SkipServiceInstall) {
    Write-Host "[SUITE] Installing/updating SQLCockpitServiceHost..." -ForegroundColor Cyan
    powershell -NoProfile -ExecutionPolicy Bypass -File $installServiceScript -SettingsProfile prod -SettingsPath $SettingsPath
    if ($LASTEXITCODE -ne 0) {
        throw "Install-SqlCockpitWindowsService.ps1 failed with exit code [$LASTEXITCODE]."
    }
}
else {
    Write-Host "[SUITE] Skipping service install/update (requested)." -ForegroundColor Yellow
}

Write-Host "[SUITE] Migrating suite-managed desktop settings..." -ForegroundColor Cyan
Ensure-DesktopComponentSettings -SettingsFilePath $SettingsPath -TemplateSettingsPath $templateSettingsPath -DesktopExePath $resolvedDesktopExe

Write-Host "[SUITE] Starting SQLCockpitServiceHost..." -ForegroundColor Cyan
Start-Service -Name "SQLCockpitServiceHost" -ErrorAction SilentlyContinue

$serviceControlExe = Resolve-ServiceControlExecutable -InstallRoot $InstallDir

Write-Host "[SUITE] Ensuring tray startup task..." -ForegroundColor Cyan
$trayArgs = @(
    "-ExecutablePath", $serviceControlExe,
    "-SettingsPath", $SettingsPath,
    "-SkipPublish",
    "-UseHighestPrivileges"
)
if ($RunTrayNow) {
    $trayArgs += "-RunImmediately"
}
powershell -NoProfile -ExecutionPolicy Bypass -File $installTrayScript @trayArgs

if (-not (Test-ControlApiHealth)) {
    throw "Control API health check failed at http://127.0.0.1:8610/health after provisioning."
}

Write-Host "[SUITE] Repair/provisioning completed successfully." -ForegroundColor Green
Write-Host "[SUITE] Settings: $SettingsPath" -ForegroundColor DarkCyan
Write-Host "[SUITE] Desktop EXE: $resolvedDesktopExe" -ForegroundColor DarkCyan
