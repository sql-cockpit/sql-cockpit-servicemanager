[CmdletBinding()]
param(
    [string]$DesktopSetupPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$bundleRoot = Join-Path -Path $PSScriptRoot -ChildPath "DesktopBundle"
if (-not (Test-Path -LiteralPath $bundleRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $bundleRoot | Out-Null
}

function Resolve-DesktopSetupPath {
    param(
        [string]$ExplicitPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $resolved = [System.IO.Path]::GetFullPath($ExplicitPath)
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Desktop setup executable was not found at [$resolved]."
        }
        return $resolved
    }

    $repoRoot = Split-Path -Path (Split-Path -Path $PSScriptRoot -Parent) -Parent
    $candidateRoots = @(
        (Join-Path -Path $repoRoot -ChildPath "webapp\publish"),
        (Join-Path -Path $repoRoot -ChildPath "webapp\desktop-publish"),
        (Join-Path -Path $repoRoot -ChildPath "desktop-publish")
    )

    $candidates = @()
    foreach ($root in $candidateRoots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) {
            continue
        }

        $found = Get-ChildItem -Path $root -Recurse -File -Filter "SQL Cockpit setup*.exe" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -ExpandProperty FullName
        $candidates += $found
    }

    if (-not $candidates.Count) {
        throw "Could not find a desktop installer. Build desktop app first (webapp: npm run dist:desktop), or pass -DesktopSetupPath."
    }

    return $candidates[0]
}

$desktopSetup = Resolve-DesktopSetupPath -ExplicitPath $DesktopSetupPath
$destinationPath = Join-Path -Path $bundleRoot -ChildPath "SQL Cockpit setup.exe"
Copy-Item -LiteralPath $desktopSetup -Destination $destinationPath -Force

Write-Host "[SUITE] Desktop bundle prepared." -ForegroundColor Green
Write-Host "[SUITE] Source: $desktopSetup" -ForegroundColor DarkCyan
Write-Host "[SUITE] Bundled: $destinationPath" -ForegroundColor DarkCyan
