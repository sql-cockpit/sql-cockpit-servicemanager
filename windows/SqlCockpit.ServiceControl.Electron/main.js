const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, Notification, shell, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile, spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");

const DEFAULT_SETTINGS_PATH = path.join(process.env.ProgramData || "C:\\ProgramData", "SqlCockpit", "sql-cockpit-service.settings.json");
const IS_WINDOWS = process.platform === "win32";
const IS_MACOS = process.platform === "darwin";
const WEB_API_COMPONENT_ID = "web-api";
const WEB_API_LISTEN_PREFIX = "http://127.0.0.1:8000/";
const WEB_API_HEALTH_URL = "http://127.0.0.1:8000/health";

function resolveIconFile() {
    const devRoot = path.resolve(__dirname, "..", "..", "icons");
    const packagedRoot = path.join(process.resourcesPath, "icons");
    const root = app.isPackaged ? packagedRoot : devRoot;

    if (IS_WINDOWS) {
        return path.join(root, "windows", "icon.ico");
    }
    if (IS_MACOS) {
        return path.join(root, "macos", "icon.icns");
    }
    return path.join(root, "linux", "icons", "512x512.png");
}

function resolveTrayIconFile() {
    const devRoot = path.resolve(__dirname, "..", "..", "icons");
    const packagedRoot = path.join(process.resourcesPath, "icons");
    const root = app.isPackaged ? packagedRoot : devRoot;

    if (IS_WINDOWS) {
        return path.join(root, "windows", "icon.ico");
    }
    if (IS_MACOS) {
        return path.join(root, "macos", "32x32.png");
    }
    return path.join(root, "linux", "icons", "32x32.png");
}

let mainWindow = null;
let tray = null;
let cachedSettingsPath = "";
let updateDownloaded = false;
const APP_TITLE_BASE = "SQL Cockpit Service Control";

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
const autoStartApiOnLaunch = String(cli.autoStartApi ?? cli.autostartapi ?? "true").trim().toLowerCase() !== "false";

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

function parseJsonWithBom(input) {
    const text = String(input || "");
    const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return JSON.parse(normalized);
}

function readJsonFile(filePath) {
    return parseJsonWithBom(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
    const payload = JSON.stringify(value, null, 2);
    fs.writeFileSync(filePath, payload, { encoding: "utf8" });
}

function getSettingsMeta(explicitPath = "") {
    const settingsPath = resolveSettingsPath(explicitPath);
    const fallback = {
        settingsPath,
        serviceName: "SQLCockpitServiceHost",
        apiKey: "",
        controlApiBaseUrl: "http://127.0.0.1:8610",
        repoRoot: "",
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

    const raw = readJsonFile(settingsPath);
    const listenPrefix = String(raw.listenPrefix || "http://127.0.0.1:8610/").trim();
    const serviceName = String(raw.serviceName || "SQLCockpitServiceHost").trim() || "SQLCockpitServiceHost";
    const apiKey = String(raw.apiKey || "");
    const repoRoot = String(raw.repoRoot || "").trim();
    const baseUrl = listenPrefix.replace(/\/+$/, "");
    cachedSettingsPath = settingsPath;

    return {
        settingsPath,
        serviceName,
        apiKey,
        controlApiBaseUrl: baseUrl,
        repoRoot
    };
}

function readRawSettings(explicitPath = "") {
    const settingsPath = resolveSettingsPath(explicitPath);
    if (!fs.existsSync(settingsPath)) {
        throw new Error(`Settings file not found at ${settingsPath}`);
    }
    const raw = readJsonFile(settingsPath);
    const repoRoot = String(raw.repoRoot || "").trim() ||
        path.resolve(path.join(path.dirname(settingsPath), "..", "..", ".."));
    const desktopRepoRoot = String(raw.desktopRepoRoot || "").trim() || path.join(repoRoot, "webapp");
    const apiRepoRoot = String(raw.apiRepoRoot || "").trim() || path.join(repoRoot, "sql-cockpit-api");
    const serviceRepoRoot = String(raw.serviceRepoRoot || "").trim() || path.join(repoRoot, "service");
    const objectSearchRepoRoot = String(raw.objectSearchRepoRoot || "").trim() || path.join(repoRoot, "object-search");
    const settingsDirectory = path.dirname(settingsPath);
    return { raw, settingsPath, repoRoot, desktopRepoRoot, apiRepoRoot, serviceRepoRoot, objectSearchRepoRoot, settingsDirectory };
}

function buildRepoRoots(rawSettings, fallbackRepoRoot) {
    const repoRoot = String(rawSettings?.repoRoot || "").trim() || fallbackRepoRoot;
    return {
        repoRoot,
        desktopRepoRoot: String(rawSettings?.desktopRepoRoot || "").trim() || path.join(repoRoot, "webapp"),
        apiRepoRoot: String(rawSettings?.apiRepoRoot || "").trim() || path.join(repoRoot, "sql-cockpit-api"),
        serviceRepoRoot: String(rawSettings?.serviceRepoRoot || "").trim() || path.join(repoRoot, "service"),
        objectSearchRepoRoot: String(rawSettings?.objectSearchRepoRoot || "").trim() || path.join(repoRoot, "object-search")
    };
}

function setArgPair(args, name, value) {
    const normalizedName = String(name || "").trim().toLowerCase();
    const result = Array.isArray(args) ? [...args] : [];
    const index = result.findIndex((item) => String(item || "").trim().toLowerCase() === normalizedName);
    if (index >= 0) {
        if (index + 1 < result.length) {
            result[index + 1] = value;
        } else {
            result.push(value);
        }
        return result;
    }
    result.push(name, value);
    return result;
}

function ensureWebApiSettingsContract(explicitPath = "") {
    const settingsPath = resolveSettingsPath(explicitPath);
    if (!fs.existsSync(settingsPath)) {
        return { changed: false, reason: "settings-not-found" };
    }

    const raw = readJsonFile(settingsPath);
    if (!raw || !Array.isArray(raw.components)) {
        return { changed: false, reason: "components-not-found" };
    }

    const component = raw.components.find((item) => String(item?.id || "").toLowerCase() === WEB_API_COMPONENT_ID);
    if (!component) {
        return { changed: false, reason: "web-api-component-missing" };
    }

    let changed = false;
    const controlApiListenPrefix = String(raw.listenPrefix || "http://127.0.0.1:8610/").trim() || "http://127.0.0.1:8610/";
    const repoRoot = String(raw.repoRoot || "").trim() || path.resolve(path.join(path.dirname(settingsPath), "..", "..", ".."));
    if (!String(raw.desktopRepoRoot || "").trim()) {
        raw.desktopRepoRoot = path.join(repoRoot, "webapp");
        changed = true;
    }
    if (!String(raw.apiRepoRoot || "").trim()) {
        raw.apiRepoRoot = path.join(repoRoot, "sql-cockpit-api");
        changed = true;
    }
    if (!String(raw.serviceRepoRoot || "").trim()) {
        raw.serviceRepoRoot = path.join(repoRoot, "service");
        changed = true;
    }
    if (!String(raw.objectSearchRepoRoot || "").trim()) {
        raw.objectSearchRepoRoot = path.join(repoRoot, "object-search");
        changed = true;
    }

    if (component.disabled !== false) {
        component.disabled = false;
        changed = true;
    }
    if (component.autoStart !== true) {
        component.autoStart = true;
        changed = true;
    }
    if (component.workingDirectory !== "{ApiRepoRoot}") {
        component.workingDirectory = "{ApiRepoRoot}";
        changed = true;
    }

    const originalArgs = Array.isArray(component.args) ? [...component.args] : [];
    let nextArgs = [...originalArgs];
    nextArgs = setArgPair(nextArgs, "--listenPrefix", WEB_API_LISTEN_PREFIX);
    nextArgs = setArgPair(nextArgs, "--runtimeProfile", "prod");
    nextArgs = setArgPair(nextArgs, "--manageComponents", "false");
    nextArgs = setArgPair(nextArgs, "--serviceHostControlUrl", controlApiListenPrefix);
    if (JSON.stringify(nextArgs) !== JSON.stringify(originalArgs)) {
        component.args = nextArgs;
        changed = true;
    }

    if (String(component.healthUrl || "").trim() !== WEB_API_HEALTH_URL) {
        component.healthUrl = WEB_API_HEALTH_URL;
        changed = true;
    }

    if (changed) {
        writeJsonFile(settingsPath, raw);
    }

    return { changed, reason: changed ? "updated" : "no-change", settingsPath };
}

function expandComponentValue(value, roots, settingsDirectory) {
    return String(value || "")
        .replaceAll("{RepoRoot}", String(roots?.repoRoot || ""))
        .replaceAll("{DesktopRepoRoot}", String(roots?.desktopRepoRoot || ""))
        .replaceAll("{ApiRepoRoot}", String(roots?.apiRepoRoot || ""))
        .replaceAll("{ServiceRepoRoot}", String(roots?.serviceRepoRoot || ""))
        .replaceAll("{ObjectSearchRepoRoot}", String(roots?.objectSearchRepoRoot || ""))
        .replaceAll("{SettingsDirectory}", settingsDirectory);
}

function launchDetachedProcess(fileName, args, options) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(fileName, args, options);

        child.once("error", (error) => {
            if (settled) {
                return;
            }
            settled = true;
            reject(error);
        });

        child.once("spawn", () => {
            if (settled) {
                return;
            }
            settled = true;
            child.unref();
            resolve({ pid: child.pid || null });
        });
    });
}

function containsArg(args, value) {
    const target = String(value || "").trim().toLowerCase();
    return args.some((arg) => String(arg || "").trim().toLowerCase() === target);
}

function getArgValue(args, name) {
    const target = String(name || "").trim().toLowerCase();
    const values = Array.isArray(args) ? args : [];
    for (let index = 0; index < values.length; index += 1) {
        const token = String(values[index] || "").trim().toLowerCase();
        if (token !== target) {
            continue;
        }
        const next = values[index + 1];
        if (next === undefined || next === null) {
            return "";
        }
        return String(next).trim();
    }
    return "";
}

function parseListenPrefixPort(listenPrefix) {
    const raw = String(listenPrefix || "").trim();
    if (!raw) {
        return 0;
    }
    try {
        const parsed = new URL(raw);
        const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
        return Number.isFinite(port) ? port : 0;
    } catch {
        return 0;
    }
}

function ensureTcpPortAvailable(port) {
    return new Promise((resolve, reject) => {
        if (!Number.isFinite(port) || port <= 0) {
            resolve();
            return;
        }

        const tester = net.createServer();
        let settled = false;
        const finishResolve = () => {
            if (settled) {
                return;
            }
            settled = true;
            resolve();
        };
        const finishReject = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            reject(error);
        };

        tester.once("error", (error) => {
            tester.close(() => {
                finishReject(error);
            });
        });

        tester.once("listening", () => {
            tester.close(() => finishResolve());
        });

        tester.listen(port, "127.0.0.1");
    });
}

function getDesktopComponent(rawSettings) {
    const components = Array.isArray(rawSettings?.components) ? rawSettings.components : [];
    return components.find((item) => String(item?.id || "").toLowerCase() === "desktop-app") || null;
}

function resolveDesktopListenPrefix(component, roots, settingsDirectory) {
    const rawArgs = (Array.isArray(component?.args) ? component.args : [])
        .map((arg) => expandComponentValue(arg, roots, settingsDirectory));
    const fromArgs = getArgValue(rawArgs, "-ListenPrefix");
    if (fromArgs) {
        return fromArgs;
    }
    return "http://127.0.0.1:8000/";
}

async function runDesktopLaunchPreflight() {
    const { raw, repoRoot, settingsDirectory } = readRawSettings();
    const roots = buildRepoRoots(raw, repoRoot);
    const component = getDesktopComponent(raw);
    if (!component) {
        throw new Error("desktop-app component is not defined in settings.");
    }
    if (component.disabled) {
        throw new Error("desktop-app component is disabled in settings.");
    }

    const listenPrefix = resolveDesktopListenPrefix(component, roots, settingsDirectory);
    const port = parseListenPrefixPort(listenPrefix);
    try {
        await ensureTcpPortAvailable(port);
    } catch (error) {
        const message = String(error?.message || "");
        if (message.includes("EADDRINUSE")) {
            return {
                ok: false,
                listenPrefix,
                port,
                warning: `Desktop port ${port} is already in use. Close the process using ${listenPrefix} before launching Desktop UI.`
            };
        }
        return {
            ok: false,
            listenPrefix,
            port,
            warning: `Desktop preflight failed for ${listenPrefix}: ${message || "unknown error"}`
        };
    }

    return {
        ok: true,
        listenPrefix,
        port
    };
}

function ensureDesktopLaunchArguments(fileName, args, repoRoot) {
    const normalizedFileName = String(fileName || "").trim().toLowerCase();
    const resolvedArgs = Array.isArray(args) ? [...args] : [];

    if (normalizedFileName !== "powershell.exe" && normalizedFileName !== "powershell") {
        return { fileName, args: resolvedArgs };
    }

    const fileArgIndex = resolvedArgs.findIndex((arg) => String(arg || "").trim().toLowerCase() === "-file");
    if (fileArgIndex === -1 || fileArgIndex + 1 >= resolvedArgs.length) {
        return { fileName, args: resolvedArgs };
    }

    const scriptPath = String(resolvedArgs[fileArgIndex + 1] || "");
    const scriptName = path.basename(scriptPath).toLowerCase();
    const packagedLauncherPath = path.join(repoRoot, "Start-SqlCockpitDesktopPackaged.ps1");

    if (scriptName === "start-sqlcockpitdesktop.ps1" && fs.existsSync(packagedLauncherPath)) {
        resolvedArgs[fileArgIndex + 1] = packagedLauncherPath;
    }

    const activeScriptName = path.basename(String(resolvedArgs[fileArgIndex + 1] || "")).toLowerCase();
    if (activeScriptName === "start-sqlcockpitdesktoppackaged.ps1" && !containsArg(resolvedArgs, "-LaunchDetached")) {
        resolvedArgs.push("-LaunchDetached");
    }

    return { fileName, args: resolvedArgs };
}

function resolveDocsUrl(explicitPath = "") {
    const defaultDocsUrl = "http://127.0.0.1:8000/";
    try {
        const settingsPath = resolveSettingsPath(explicitPath);
        const raw = readJsonFile(settingsPath);
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

async function waitForControlApi(settings, timeoutMs = 20000, intervalMs = 750) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            await requestControlApi(settings, "/health", "GET");
            return true;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }
    return false;
}

async function ensureManagedApiStartedFromControlApp() {
    const settings = readServiceSettings();
    const service = await getWindowsServiceStatus(settings.serviceName);
    const serviceStatus = String(service?.Status || service?.status || "").toLowerCase();

    if (serviceStatus !== "running") {
        sendToRenderer("updates:status", { level: "info", message: "Starting SQLCockpitServiceHost..." });
        await startWindowsService(settings.serviceName);
    }

    const controlApiReady = await waitForControlApi(settings);
    if (!controlApiReady) {
        throw new Error(`Control API did not become available at ${settings.controlApiBaseUrl}.`);
    }

    const snapshot = await requestControlApi(settings, "/api/runtime/components", "GET");
    const components = Array.isArray(snapshot?.components) ? snapshot.components : [];
    const webApi = components.find((item) => String(item?.id || "").toLowerCase() === WEB_API_COMPONENT_ID);
    if (!webApi) {
        throw new Error("Managed component [web-api] was not found in runtime snapshot.");
    }

    if (!webApi.running) {
        sendToRenderer("updates:status", { level: "info", message: "Starting managed web-api on port 8000..." });
        await requestControlApi(settings, `/api/runtime/components/${encodeURIComponent(WEB_API_COMPONENT_ID)}/start`, "POST");
    }

    sendToRenderer("updates:status", { level: "success", message: "Managed web-api is online at http://127.0.0.1:8000/." });
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

async function getElevationState() {
    if (process.platform !== "win32") {
        return { isElevated: true };
    }

    try {
        const command = "$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); if ($isAdmin) { 'true' } else { 'false' }";
        const result = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
        return { isElevated: String(result.stdout || "").trim().toLowerCase() === "true" };
    } catch {
        return { isElevated: false };
    }
}

function isElevationRequiredError(error) {
    const message = String(error?.message || "").toLowerCase();
    return (
        message.includes("cannot open") ||
        message.includes("access is denied")
    );
}

function isUacCancelledError(error) {
    const message = String(error?.message || "").toLowerCase();
    return (
        message.includes("operation was canceled by the user") ||
        message.includes("operation cancelled by user") ||
        message.includes("error code 1223")
    );
}

async function runElevatedServiceAction(serviceName, action) {
    const escapedServiceName = String(serviceName || "").replace(/'/g, "''");
    const actionCommand = action === "start"
        ? `Start-Service -Name '${escapedServiceName}' -ErrorAction Stop`
        : `Stop-Service -Name '${escapedServiceName}' -Force -ErrorAction Stop`;
    const elevatedPayload = `$ErrorActionPreference='Stop'; ${actionCommand}; Start-Sleep -Seconds 1`;
    const encodedPayload = Buffer.from(elevatedPayload, "utf16le").toString("base64");

    const launcherCommand = `$ErrorActionPreference='Stop'; ` +
        `$proc = Start-Process -FilePath 'powershell.exe' -Verb RunAs ` +
        `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedPayload}') ` +
        `-PassThru -Wait; ` +
        `exit $proc.ExitCode`;

    await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        launcherCommand
    ]);
}

async function runElevatedForceKill(serviceName) {
    const escapedServiceName = String(serviceName || "").replace(/'/g, "''");
    const killCommand = `$ErrorActionPreference='Stop'; ` +
        `$svc = Get-CimInstance Win32_Service -Filter "Name='${escapedServiceName}'"; ` +
        `if (-not $svc) { throw 'Service not found.' }; ` +
        `$servicePid = [int]$svc.ProcessId; ` +
        `if ($servicePid -le 0) { throw 'Service has no process id.' }; ` +
        `taskkill /F /PID $servicePid | Out-Null`;
    const encodedPayload = Buffer.from(killCommand, "utf16le").toString("base64");
    const launcherCommand = `$ErrorActionPreference='Stop'; ` +
        `$proc = Start-Process -FilePath 'powershell.exe' -Verb RunAs ` +
        `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedPayload}') ` +
        `-PassThru -Wait; ` +
        `exit $proc.ExitCode`;
    await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        launcherCommand
    ]);
}

function escapePsSingleQuotedValue(value) {
    return String(value || "").replace(/'/g, "''");
}

async function runElevatedScript(scriptPath, argumentsMap = {}) {
    const resolvedScriptPath = path.resolve(String(scriptPath || ""));
    if (!fs.existsSync(resolvedScriptPath)) {
        throw new Error(`Repair script not found at [${resolvedScriptPath}]`);
    }

    const argumentSegments = Object.entries(argumentsMap)
        .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
        .map(([key, value]) => `-${key} '${escapePsSingleQuotedValue(value)}'`);

    const payloadCommand = `& '${escapePsSingleQuotedValue(resolvedScriptPath)}' ${argumentSegments.join(" ")}`.trim();
    const encodedPayload = Buffer.from(payloadCommand, "utf16le").toString("base64");

    const launcherCommand = `$ErrorActionPreference='Stop'; ` +
        `$proc = Start-Process -FilePath 'powershell.exe' -Verb RunAs ` +
        `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedPayload}') ` +
        `-PassThru -Wait; ` +
        `exit $proc.ExitCode`;

    await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        launcherCommand
    ]);
}

async function startWindowsService(serviceName) {
    const command = `$ErrorActionPreference='Stop'; Start-Service -Name '${serviceName}'; Start-Sleep -Seconds 1; $svc = Get-Service -Name '${serviceName}'; $svc | Select-Object Name,DisplayName,Status | ConvertTo-Json -Compress`;
    try {
        const result = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
        return JSON.parse(result.stdout || "{}");
    } catch (error) {
        if (isElevationRequiredError(error)) {
            try {
                await runElevatedServiceAction(serviceName, "start");
                return await getWindowsServiceStatus(serviceName);
            } catch (elevatedError) {
                if (isUacCancelledError(elevatedError)) {
                    throw new Error("Start service canceled at UAC prompt.");
                }
                throw new Error(`Could not start service after elevation attempt: ${elevatedError.message}`);
            }
        }
        throw error;
    }
}

async function stopWindowsService(serviceName) {
    const command = `$ErrorActionPreference='Stop'; Stop-Service -Name '${serviceName}' -Force; Start-Sleep -Seconds 1; $svc = Get-Service -Name '${serviceName}'; $svc | Select-Object Name,DisplayName,Status | ConvertTo-Json -Compress`;
    try {
        const result = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
        return JSON.parse(result.stdout || "{}");
    } catch (error) {
        if (isElevationRequiredError(error)) {
            try {
                await runElevatedServiceAction(serviceName, "stop");
                return await getWindowsServiceStatus(serviceName);
            } catch (elevatedError) {
                if (isUacCancelledError(elevatedError)) {
                    throw new Error("Stop service canceled at UAC prompt.");
                }
                throw new Error(`Could not stop service after elevation attempt: ${elevatedError.message}`);
            }
        }
        throw error;
    }
}

async function forceKillWindowsService(serviceName) {
    const escapedServiceName = String(serviceName || "").replace(/'/g, "''");
    const command = `$ErrorActionPreference='Stop'; ` +
        `$svc = Get-CimInstance Win32_Service -Filter "Name='${escapedServiceName}'"; ` +
        `if (-not $svc) { throw 'Service not found.' }; ` +
        `$servicePid = [int]$svc.ProcessId; ` +
        `if ($servicePid -le 0) { throw 'Service has no process id.' }; ` +
        `taskkill /F /PID $servicePid | Out-Null; ` +
        `Start-Sleep -Seconds 1; ` +
        `$svc = Get-Service -Name '${escapedServiceName}'; ` +
        `$svc | Select-Object Name,DisplayName,Status | ConvertTo-Json -Compress`;
    try {
        const result = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
        return JSON.parse(result.stdout || "{}");
    } catch (error) {
        if (isElevationRequiredError(error)) {
            try {
                await runElevatedForceKill(serviceName);
                return await getWindowsServiceStatus(serviceName);
            } catch (elevatedError) {
                if (isUacCancelledError(elevatedError)) {
                    throw new Error("Force kill canceled at UAC prompt.");
                }
                throw new Error(`Force kill failed after elevation attempt: ${elevatedError.message}`);
            }
        }
        throw error;
    }
}

function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

function createWindow() {
    const windowIconPath = resolveIconFile();
    const windowOptions = {
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
    };
    if (fs.existsSync(windowIconPath) && !IS_MACOS) {
        windowOptions.icon = windowIconPath;
    }

    mainWindow = new BrowserWindow(windowOptions);

    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    mainWindow.once("ready-to-show", () => mainWindow.show());
    updateWindowTitle();
    mainWindow.on("focus", updateWindowTitle);
    mainWindow.on("close", (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function updateWindowTitle() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    getElevationState()
        .then((elevation) => {
            const suffix = elevation?.isElevated ? " (Admin)" : "";
            mainWindow.setTitle(`${APP_TITLE_BASE}${suffix}`);
        })
        .catch(() => {
            mainWindow.setTitle(APP_TITLE_BASE);
        });
}

function createTray() {
    const trayIconPath = resolveTrayIconFile();
    const trayIcon = fs.existsSync(trayIconPath)
        ? nativeImage.createFromPath(trayIconPath)
        : nativeImage.createFromDataURL(
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
    const elevation = await getElevationState();
    return {
        version: app.getVersion(),
        platform: os.platform(),
        isPackaged: app.isPackaged,
        settingsPath: settings.settingsPath,
        serviceName: settings.serviceName,
        controlApiBaseUrl: settings.controlApiBaseUrl,
        updateDownloaded,
        settingsError: settings.settingsError || "",
        isElevated: elevation.isElevated
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

ipcMain.handle("service:force-kill", async () => {
    const settings = readServiceSettings();
    const service = await forceKillWindowsService(settings.serviceName);
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

ipcMain.handle("shell:open-external", async (_, targetUrl) => {
    const url = String(targetUrl || "").trim();
    if (!/^https?:\/\//i.test(url)) {
        throw new Error("Invalid URL.");
    }
    await shell.openExternal(url);
    return { opened: true, url };
});

ipcMain.handle("shell:open-path", async (_, targetPath) => {
    const value = String(targetPath || "").trim();
    if (!value) {
        throw new Error("Path is empty.");
    }
    const result = await shell.openPath(value);
    if (result) {
        throw new Error(result);
    }
    return { opened: true, path: value };
});

ipcMain.handle("clipboard:copy", async (_, text) => {
    const value = String(text || "");
    clipboard.writeText(value);
    return { copied: true };
});

ipcMain.handle("desktop:launch-user-session", async () => {
    const { raw, repoRoot, settingsDirectory } = readRawSettings();
    const roots = buildRepoRoots(raw, repoRoot);
    const component = getDesktopComponent(raw);
    if (!component) {
        throw new Error("desktop-app component is not defined in settings.");
    }
    if (component.disabled) {
        throw new Error("desktop-app component is disabled in settings.");
    }

    const fileName = expandComponentValue(component.command, roots, settingsDirectory).trim();
    if (!fileName) {
        throw new Error("desktop-app command is empty.");
    }

    const rawArgs = (Array.isArray(component.args) ? component.args : [])
        .map((arg) => expandComponentValue(arg, roots, settingsDirectory));
    const launchCommand = ensureDesktopLaunchArguments(fileName, rawArgs, repoRoot);

    const rawWorkingDirectory = expandComponentValue(component.workingDirectory || "", roots, settingsDirectory).trim();
    const workingDirectory = rawWorkingDirectory
        ? (path.isAbsolute(rawWorkingDirectory) ? rawWorkingDirectory : path.resolve(path.join(repoRoot, rawWorkingDirectory)))
        : repoRoot;

    const launchResult = await execFileAsync(launchCommand.fileName, launchCommand.args, {
        cwd: workingDirectory,
        windowsHide: false
    });

    const pidMatch = String(launchResult.stdout || "").match(/PID:\s*(\d+)/i);
    const launchedPid = pidMatch ? Number.parseInt(pidMatch[1], 10) : null;

    return {
        launched: true,
        pid: Number.isFinite(launchedPid) ? launchedPid : null,
        command: launchCommand.fileName,
        listenPrefix: ""
    };
});

ipcMain.handle("desktop:launch-preflight", async () => ({ ok: true, listenPrefix: "", port: 0 }));

ipcMain.handle("suite:repair", async () => {
    const settings = getSettingsMeta();
    const candidateScripts = [
        path.join(process.resourcesPath || "", "setup", "windows", "Repair-SqlCockpitSuite.ps1"),
        path.resolve(__dirname, "..", "Repair-SqlCockpitSuite.ps1")
    ];
    const repairScriptPath = candidateScripts.find((candidate) => candidate && fs.existsSync(candidate));
    if (!repairScriptPath) {
        throw new Error("Repair-SqlCockpitSuite.ps1 was not found in installer resources or local workspace.");
    }

    const installDir = app.isPackaged ? path.dirname(app.getPath("exe")) : "";
    await runElevatedScript(repairScriptPath, {
        InstallDir: installDir,
        SettingsPath: settings.settingsPath
    });
    return { repaired: true };
});

app.whenReady().then(() => {
    createWindow();
    createTray();
    setupAutoUpdater();

    try {
        const reconciliation = ensureWebApiSettingsContract();
        if (reconciliation.changed) {
            sendToRenderer("updates:status", {
                level: "info",
                message: `Updated service settings to enforce web-api on ${WEB_API_LISTEN_PREFIX}`
            });
        }
    } catch (error) {
        sendToRenderer("updates:status", {
            level: "warning",
            message: `Could not reconcile web-api settings: ${error?.message || error}`
        });
    }

    if (autoStartApiOnLaunch) {
        setTimeout(() => {
            ensureManagedApiStartedFromControlApp().catch((error) => {
                sendToRenderer("updates:status", {
                    level: "warning",
                    message: `Auto-start API skipped: ${error?.message || error}`
                });
            });
        }, 1200);
    }

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
