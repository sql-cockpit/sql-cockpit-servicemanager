const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, Notification, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { autoUpdater } = require("electron-updater");

const DEFAULT_SETTINGS_PATH = path.join(process.env.ProgramData || "C:\\ProgramData", "SqlCockpit", "sql-cockpit-service.settings.json");

let mainWindow = null;
let tray = null;
let cachedSettingsPath = "";
let updateDownloaded = false;

function parseCliArgs(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = String(argv[index] || "");
        if (!token.startsWith("--")) {
            continue;
        }
        const key = token.slice(2);
        const next = argv[index + 1];
        if (!next || String(next).startsWith("--")) {
            parsed[key] = true;
            continue;
        }
        parsed[key] = String(next);
        index += 1;
    }
    return parsed;
}

const cli = parseCliArgs(process.argv.slice(1));
const settingsPathFromCli = String(cli.settings || "").trim();

function execFileAsync(filePath, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(filePath, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
            if (error) {
                const wrapped = new Error(stderr?.trim() || error.message || "Command failed.");
                wrapped.code = error.code;
                reject(wrapped);
                return;
            }
            resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
        });
    });
}

function resolveSettingsPath(explicitPath = "") {
    if (explicitPath && fs.existsSync(explicitPath)) {
        return path.resolve(explicitPath);
    }
    if (settingsPathFromCli && fs.existsSync(settingsPathFromCli)) {
        return path.resolve(settingsPathFromCli);
    }
    return path.resolve(DEFAULT_SETTINGS_PATH);
}

function getSettingsMeta(explicitPath = "") {
    const settingsPath = resolveSettingsPath(explicitPath);
    const fallback = {
        settingsPath,
        serviceName: "SQLCockpitServiceHost",
        apiKey: "",
        controlApiBaseUrl: "http://127.0.0.1:8610",
        settingsError: ""
    };
    try {
        const settings = readServiceSettings(explicitPath);
        return { ...settings, settingsError: "" };
    } catch (error) {
        return {
            ...fallback,
            settingsError: error?.message || "Failed to read settings."
        };
    }
}

function readServiceSettings(explicitPath = "") {
    const settingsPath = resolveSettingsPath(explicitPath);
    if (!fs.existsSync(settingsPath)) {
        throw new Error(`Settings file not found at ${settingsPath}`);
    }

    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const listenPrefix = String(raw.listenPrefix || "http://127.0.0.1:8610/").trim();
    const serviceName = String(raw.serviceName || "SQLCockpitServiceHost").trim() || "SQLCockpitServiceHost";
    const apiKey = String(raw.apiKey || "");
    const baseUrl = listenPrefix.replace(/\/+$/, "");
    cachedSettingsPath = settingsPath;

    return {
        settingsPath,
        serviceName,
        apiKey,
        controlApiBaseUrl: baseUrl
    };
}

function resolveDocsUrl(explicitPath = "") {
    const defaultDocsUrl = "http://127.0.0.1:8000/";
    try {
        const settingsPath = resolveSettingsPath(explicitPath);
        const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        const components = Array.isArray(raw?.components) ? raw.components : [];
        const docsComponent = components.find((component) => String(component?.id || "").toLowerCase() === "docs");
        const candidate = String(docsComponent?.healthUrl || "").trim();
        if (candidate) {
            return candidate;
        }
    } catch {
        // Fallback to default.
    }

    return defaultDocsUrl;
}

async function requestControlApi(settings, endpoint, method = "GET") {
    const headers = {};
    if (settings.apiKey) {
        headers["X-SqlCockpit-Service-Key"] = settings.apiKey;
    }
    if (method !== "GET") {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${settings.controlApiBaseUrl}${endpoint}`, {
        method,
        headers,
        body: method === "GET" ? undefined : "{}"
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = null;
    }
    if (!response.ok) {
        const message = payload?.error || text || `Control API request failed with status ${response.status}`;
        const error = new Error(message);
        error.statusCode = response.status;
        throw error;
    }
    return payload;
}

async function getWindowsServiceStatus(serviceName) {
    const command = `$ErrorActionPreference='Stop'; $svc = Get-Service -Name '${serviceName}'; $svc | Select-Object Name,DisplayName,Status | ConvertTo-Json -Compress`;
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
    return JSON.parse(result.stdout || "{}");
}

async function startWindowsService(serviceName) {
    const command = `$ErrorActionPreference='Stop'; Start-Service -Name '${serviceName}'; Start-Sleep -Seconds 1; $svc = Get-Service -Name '${serviceName}'; $svc | Select-Object Name,DisplayName,Status | ConvertTo-Json -Compress`;
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
    return JSON.parse(result.stdout || "{}");
}

async function stopWindowsService(serviceName) {
    const command = `$ErrorActionPreference='Stop'; Stop-Service -Name '${serviceName}' -Force; Start-Sleep -Seconds 1; $svc = Get-Service -Name '${serviceName}'; $svc | Select-Object Name,DisplayName,Status | ConvertTo-Json -Compress`;
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
    return JSON.parse(result.stdout || "{}");
}

function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1240,
        height: 820,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: "#0f172a",
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.js")
        }
    });

    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.on("close", (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function createTray() {
    const trayIcon = nativeImage.createFromDataURL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAZ0lEQVR4AWNABf7//3+GQYFhBiMGBgaG/38G4mBgYHj8+P8fQwPDf4YGRnYGBgY8P8nAwMDw/8fQwPDf4YQpQYGBgYkJ2f/4+NnYGAQx4A0A8MDAwMDA8M0A8MwMDAwMDAw0GSAKQAAh1QbU5Jm0iQAAAABJRU5ErkJggg=="
    );
    tray = new Tray(trayIcon);
    tray.setToolTip("SQL Cockpit Service Control");
    tray.on("double-click", () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open Service Control", click: () => mainWindow?.show() },
        { type: "separator" },
        {
            label: "Check For Updates",
            click: () => autoUpdater.checkForUpdates().catch((error) => sendToRenderer("updates:status", { level: "error", message: error.message }))
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => {
                app.isQuiting = true;
                app.quit();
            }
        }
    ]));
}

function setupAutoUpdater() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => sendToRenderer("updates:status", { level: "info", message: "Checking for updates..." }));
    autoUpdater.on("update-available", (info) => sendToRenderer("updates:status", { level: "info", message: `Update available: ${info.version}` }));
    autoUpdater.on("update-not-available", () => sendToRenderer("updates:status", { level: "info", message: "No updates available." }));
    autoUpdater.on("error", (error) => sendToRenderer("updates:status", { level: "error", message: error.message || "Update error." }));
    autoUpdater.on("download-progress", (progress) => sendToRenderer("updates:status", {
        level: "info",
        message: `Downloading update: ${Math.round(progress.percent || 0)}%`
    }));
    autoUpdater.on("update-downloaded", (info) => {
        updateDownloaded = true;
        sendToRenderer("updates:status", {
            level: "success",
            message: `Update ${info.version} downloaded. Click install to restart and apply.`
        });
    });
}

ipcMain.handle("app:get-meta", async () => {
    const settings = getSettingsMeta();
    return {
        version: app.getVersion(),
        platform: os.platform(),
        settingsPath: settings.settingsPath,
        serviceName: settings.serviceName,
        controlApiBaseUrl: settings.controlApiBaseUrl,
        updateDownloaded,
        settingsError: settings.settingsError || ""
    };
});

ipcMain.handle("settings:reload", async (_, explicitPath = "") => {
    const settings = readServiceSettings(String(explicitPath || ""));
    return settings;
});

ipcMain.handle("status:get", async () => {
    const settings = getSettingsMeta();
    const diagnostics = {
        settingsError: settings.settingsError || "",
        serviceError: "",
        runtimeError: ""
    };

    let service = {
        Name: settings.serviceName,
        DisplayName: settings.serviceName,
        Status: "Unknown"
    };
    let runtime = { components: [] };

    if (!diagnostics.settingsError) {
        const [serviceResult, runtimeResult] = await Promise.allSettled([
            getWindowsServiceStatus(settings.serviceName),
            requestControlApi(settings, "/api/runtime/components", "GET")
        ]);

        if (serviceResult.status === "fulfilled") {
            service = serviceResult.value || service;
        } else {
            diagnostics.serviceError = serviceResult.reason?.message || "Failed to query Windows service status.";
        }

        if (runtimeResult.status === "fulfilled") {
            runtime = runtimeResult.value || runtime;
        } else {
            diagnostics.runtimeError = runtimeResult.reason?.message || "Failed to query runtime components.";
        }
    }

    if (!Array.isArray(runtime?.components)) {
        runtime = { components: [] };
    }

    return { settings, service, runtime, diagnostics };
});

ipcMain.handle("service:start", async () => {
    const settings = readServiceSettings();
    const service = await startWindowsService(settings.serviceName);
    return { service };
});

ipcMain.handle("service:stop", async () => {
    const settings = readServiceSettings();
    const service = await stopWindowsService(settings.serviceName);
    return { service };
});

ipcMain.handle("components:start-all", async () => {
    const settings = readServiceSettings();
    return requestControlApi(settings, "/api/runtime/components/start-all", "POST");
});

ipcMain.handle("components:restart-all", async () => {
    const settings = readServiceSettings();
    return requestControlApi(settings, "/api/runtime/components/restart-all", "POST");
});

ipcMain.handle("components:stop-all", async () => {
    const settings = readServiceSettings();
    return requestControlApi(settings, "/api/runtime/components/stop-all", "POST");
});

ipcMain.handle("component:action", async (_, componentId, action) => {
    const settings = readServiceSettings();
    const normalizedAction = String(action || "").toLowerCase();
    if (!["start", "stop", "restart"].includes(normalizedAction)) {
        throw new Error(`Unsupported component action: ${action}`);
    }
    const id = encodeURIComponent(String(componentId || "").toLowerCase());
    return requestControlApi(settings, `/api/runtime/components/${id}/${normalizedAction}`, "POST");
});

ipcMain.handle("updates:check", async () => {
    await autoUpdater.checkForUpdates();
    return { requested: true };
});

ipcMain.handle("updates:install", async () => {
    if (!updateDownloaded) {
        return { installed: false, reason: "No downloaded update is available yet." };
    }
    autoUpdater.quitAndInstall();
    return { installed: true };
});

ipcMain.handle("docs:open", async () => {
    const docsUrl = resolveDocsUrl();
    await shell.openExternal(docsUrl);
    return { opened: true, url: docsUrl };
});

app.whenReady().then(() => {
    createWindow();
    createTray();
    setupAutoUpdater();

    if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch((error) => {
            sendToRenderer("updates:status", { level: "error", message: error.message || "Update check failed." });
        });
    }
});

app.on("window-all-closed", () => {
    // Keep app alive in tray on Windows.
});

app.on("activate", () => {
    if (!mainWindow) {
        createWindow();
    } else {
        mainWindow.show();
    }
});
