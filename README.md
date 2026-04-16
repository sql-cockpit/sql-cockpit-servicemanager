# SQL Cockpit Service Manager

[![GitHub release](https://img.shields.io/github/v/release/sql-cockpit/sql-cockpit-servicemanager?label=version&logo=github)](https://github.com/sql-cockpit/sql-cockpit-servicemanager/releases)
[![Build & Publish](https://github.com/sql-cockpit/sql-cockpit-servicemanager/actions/workflows/release-electron.yml/badge.svg)](https://github.com/sql-cockpit/sql-cockpit-servicemanager/actions/workflows/release-electron.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey?logo=windows)](https://github.com/sql-cockpit/sql-cockpit-servicemanager)

> **Part of the [SQL Cockpit](https://github.com/sql-cockpit/sql-cockpit) suite** – Your modern database management companion

---

## 📖 Overview

The **SQL Cockpit Service Manager** is a Windows tray companion application that provides seamless control and monitoring for the SQL Cockpit Windows Service. Built with Electron, this component ensures smooth integration between the SQL Cockpit Desktop app and the underlying Windows service infrastructure.

### 🎯 Purpose

This repository contains:
- **Service Control Tray App**: A system tray application for managing the SQL Cockpit Windows Service lifecycle
- **Windows Service Host**: The .NET-based Windows service that powers SQL Cockpit backend operations
- **Suite Installer Scripts**: PowerShell scripts for unified installation, repair, and maintenance of the complete SQL Cockpit suite

Together with the main [SQL Cockpit Desktop app](https://github.com/sql-cockpit/sql-cockpit), this forms a complete database management solution for Windows users.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SQL Cockpit Suite                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  Desktop App    │◄──►│  Service Control (Tray App)     │ │
│  │  (Electron)     │    │  (Electron + electron-updater)  │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
│                              │                               │
│                              ▼                               │
│                   ┌─────────────────────┐                   │
│                   │  Windows Service    │                   │
│                   │  (.NET ServiceHost) │                   │
│                   └─────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| Component | Location | Technology | Purpose |
|-----------|----------|------------|---------|
| **Service Control UI** | `windows/SqlCockpit.ServiceControl.Electron` | Electron | System tray interface for service management |
| **Windows Service** | `windows/SqlCockpit.ServiceHost.Windows` | .NET | Background service for SQL Cockpit operations |
| **Installation Scripts** | `windows/*.ps1` | PowerShell | Suite installation, repair, and maintenance |
| **Icons & Assets** | `icons/` | Various | Cross-platform application icons |

---

## 🚀 Quick Start

### For End Users

Download the latest installer from the [Releases page](https://github.com/sql-cockpit/sql-cockpit-servicemanager/releases):

- **`SQL Cockpit Service Control Setup *.exe`** – Run this single installer to provision the complete suite

The suite installer automatically provisions:
- ✅ SQL Cockpit Desktop app
- ✅ SQLCockpitServiceHost Windows service
- ✅ SQL Cockpit Service Control tray app with auto-startup

> **Note:** Do not distribute separate installers to end users for normal setup. Use the suite installer only.

### For Developers

```powershell
# Clone the repository
git clone https://github.com/sql-cockpit/sql-cockpit-servicemanager.git
cd sql-cockpit-servicemanager

# Prepare the desktop bundle
powershell -ExecutionPolicy Bypass -File .\windows\Prepare-SqlCockpitSuiteDesktopBundle.ps1

# Build the Service Control Electron app
powershell -ExecutionPolicy Bypass -File .\windows\Publish-SqlCockpitServiceControlElectron.ps1
```

---

## 🛠️ Development

### Prerequisites

- **Node.js 20+** ([Download](https://nodejs.org/))
- **PowerShell 5.1+** (Windows)
- **.NET SDK** (for Windows Service Host)
- **Git**

### Project Structure

```
sql-cockpit-servicemanager/
├── .github/workflows/       # CI/CD pipelines
├── icons/                   # Application icons (Windows, macOS, Linux)
├── publish/                 # Build output directory
├── windows/
│   ├── SqlCockpit.ServiceControl.Electron/
│   │   ├── build/           # Electron build configuration
│   │   ├── main.js          # Electron main process
│   │   ├── preload.js       # Preload script
│   │   └── renderer/        # Renderer process UI
│   ├── SqlCockpit.ServiceHost.Windows/
│   │   └── ...              # .NET Windows Service source
│   ├── *.ps1                # PowerShell installation/maintenance scripts
│   └── *.settings.json      # Service configuration templates
└── README.md
```

### Running in Development Mode

```powershell
cd windows/SqlCockpit.ServiceControl.Electron

# Install dependencies
npm ci

# Run in development mode
npm run dev

# Or with file watching
npm run dev:watch
```

### Building Distribution Packages

```powershell
cd windows/SqlCockpit.ServiceControl.Electron

# NSIS installer (production)
npm run dist

# Portable build (testing)
npm run dist:portable
```

---

## 📦 Release Publishing

This repository publishes installer artifacts through GitHub Releases using automated workflows.

### Release Workflow

- **Workflow File:** `.github/workflows/release-electron.yml`
- **Trigger:** Git tag push matching `v*.*.*` (e.g., `v1.0.1`)
- **Platform:** `windows-latest` runner

### Release Steps

1. **Update version** in `windows/SqlCockpit.ServiceControl.Electron/package.json`

2. **Commit and push** to `main`:
   ```bash
   git add .
   git commit -m "Bump version to 1.0.1"
   git push origin main
   ```

3. **Tag and push** the release:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

The workflow will automatically:
- Checkout the repository
- Setup Node.js 20 with npm caching
- Install dependencies via `npm ci`
- Build distribution packages via `npm run dist`
- Publish release assets using `electron-builder` + `electron-updater`

### Desktop App Release Flow

For the main SQL Cockpit desktop app (separate repository), use the `desktop-vX.Y.Z` tag format:

```bash
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

This triggers the `.github/workflows/release-desktop-app.yml` workflow in the parent repository.

> **Important:** Auto-updates require installed/packaged builds from the NSIS installer path. Portable builds are for dev/test convenience only.

---

## 🔧 Maintenance

### Common Maintenance Tasks

#### Reset Development Environment
```powershell
powershell -ExecutionPolicy Bypass -File .\windows\Reset-SqlCockpitServiceControlDevEnvironment.ps1
```

#### Test Windows Service Host
```powershell
powershell -ExecutionPolicy Bypass -File .\windows\Test-SqlCockpitWindowsServiceHost.ps1
```

#### Repair Suite Installation
```powershell
powershell -ExecutionPolicy Bypass -File .\windows\Repair-SqlCockpitSuite.ps1
```

### Configuration Files

| File | Purpose |
|------|---------|
| `sql-cockpit-service.settings.json` | Default service configuration |
| `sql-cockpit-service.dev.settings.json` | Development environment settings |
| `sql-cockpit-service.prod.settings.json` | Production environment settings |

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### How to Contribute

1. **Fork the repository** on GitHub
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes** following our coding standards
4. **Test thoroughly** using the provided PowerShell scripts
5. **Submit a Pull Request** with a clear description of changes

### Contribution Guidelines

- Follow existing code style and conventions
- Write meaningful commit messages
- Include tests for new features where applicable
- Update documentation for significant changes
- Ensure PowerShell scripts are compatible with PowerShell 5.1+

### Reporting Issues

Found a bug or have a feature request? Please open an issue on GitHub with:
- Clear description of the problem or feature
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Environment details (OS version, Node.js version, etc.)

### Code of Conduct

Please be respectful and constructive in all interactions. We're building a community around SQL Cockpit!

---

## 📄 License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.

---

## 🔗 Links

- **Main Repository:** [https://github.com/sql-cockpit/sql-cockpit](https://github.com/sql-cockpit/sql-cockpit)
- **Releases:** [https://github.com/sql-cockpit/sql-cockpit-servicemanager/releases](https://github.com/sql-cockpit/sql-cockpit-servicemanager/releases)
- **Issues:** [https://github.com/sql-cockpit/sql-cockpit-servicemanager/issues](https://github.com/sql-cockpit/sql-cockpit-servicemanager/issues)
- **Actions:** [https://github.com/sql-cockpit/sql-cockpit-servicemanager/actions](https://github.com/sql-cockpit/sql-cockpit-servicemanager/actions)

---

<div align="center">

**Made with ❤️ by the SQL Cockpit Team**

[⭐ Star this repo](https://github.com/sql-cockpit/sql-cockpit-servicemanager) | [🐛 Report an issue](https://github.com/sql-cockpit/sql-cockpit-servicemanager/issues) | [📖 View main project](https://github.com/sql-cockpit/sql-cockpit)

</div>
