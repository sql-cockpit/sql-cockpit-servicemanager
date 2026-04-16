# sql-cockpit-servicemanager

The SQL Cockpit Service Control Electron application (Windows tray companion).

## Single Installer Contract (Windows)

End users should run one installer only:

- `SQL Cockpit Service Control Setup *.exe` (Suite installer)

This suite installer now provisions:

- SQL Cockpit Desktop app
- SQLCockpitServiceHost Windows service
- SQL Cockpit Service Control tray app + startup task

Do not distribute a second installer to end users for normal setup.

## Release Publishing

This repository publishes installer artifacts through GitHub Releases using:

- workflow: `.github/workflows/release-electron.yml`
- trigger: git tag push matching `v*.*.*` (for example `v1.0.1`)

### Release steps

1. Update version in `windows/SqlCockpit.ServiceControl.Electron/package.json`.
2. Commit and push to `main`.
3. Tag and push:

```powershell
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

The workflow will run on `windows-latest`, execute `npm ci`, then `npm run dist`, and publish release assets via `electron-builder` + `electron-updater`.

## SQL Cockpit Desktop App Build Modes

The main SQL Cockpit desktop app (separate from this Service Control app) supports two build modes:

1. Portable build for development/testing (`SQL Cockpit portable.exe`)
2. Production installer build for auto-updates (`SQL Cockpit setup.exe`)

### Portable build (development/testing)

```powershell
Push-Location ..\webapp
npm ci
npm run build
npm run dist:desktop:portable
Pop-Location
```

Expected output:

- `..\webapp\publish\desktop-YYYYMMDD-HHMMSS\SQL Cockpit portable.exe`

Run in dev mode:

```powershell
.\webapp\publish\desktop-YYYYMMDD-HHMMSS\SQL Cockpit portable.exe --dev
```

### Production build (installer + auto-updates)

```powershell
Push-Location ..\webapp
npm ci
npm run build
npm run dist:desktop
Pop-Location
```

Expected output:

- `..\webapp\publish\desktop-YYYYMMDD-HHMMSS\SQL Cockpit setup.exe`

### Production release flow (desktop app)

1. Update version in `../webapp/package.json`.
2. Commit and push.
3. Tag and push with `desktop-vX.Y.Z`:

```powershell
git tag desktop-v1.0.0
git push origin main
git push origin desktop-v1.0.0
```

This triggers `.github/workflows/release-desktop-app.yml` in the parent repository.

Note:

- auto-updates require installed/packaged builds from the NSIS installer path.
- portable builds are for dev/test convenience and do not use `electron-updater`.

## Suite Build Prep

Before `npm run dist` for Service Control, ensure a desktop setup exe is bundled:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\Prepare-SqlCockpitSuiteDesktopBundle.ps1
powershell -ExecutionPolicy Bypass -File .\windows\Publish-SqlCockpitServiceControlElectron.ps1
```

Support scripts:

- `windows\Install-SqlCockpitSuite.ps1`
- `windows\Repair-SqlCockpitSuite.ps1`
