/* global serviceControl */

const api = (typeof window !== "undefined" && window.serviceControl) ? window.serviceControl : null;

const state = {
    meta: null,
    snapshot: null,
    selectedComponentId: "",
    devNoticeShown: false,
    selectedComponent: null
};

const actionLocks = new Set();

const elements = {
    environmentStatus: document.getElementById("environmentStatus"),
    appVersion: document.getElementById("appVersion"),
    settingsPath: document.getElementById("settingsPath"),
    controlUrl: document.getElementById("controlUrl"),
    serviceName: document.getElementById("serviceName"),
    serviceStatus: document.getElementById("serviceStatus"),
    updateStatus: document.getElementById("updateStatus"),
    componentBody: document.getElementById("componentBody"),
    componentDetail: document.getElementById("componentDetail"),
    statusBar: document.getElementById("statusBar"),
    statusText: document.getElementById("statusText"),
    installUpdateButton: document.getElementById("installUpdateButton"),
    adminRequiredBadge: document.getElementById("adminRequiredBadge"),
    toastContainer: document.getElementById("toastContainer"),
    copySettingsButton: document.getElementById("copySettingsButton"),
    copyControlUrlButton: document.getElementById("copyControlUrlButton"),
    openServiceLogsButton: document.getElementById("openServiceLogsButton"),
    openLogButton: document.getElementById("openLogButton"),
    copyErrorButton: document.getElementById("copyErrorButton"),
    copyTailButton: document.getElementById("copyTailButton")
};

function renderEnvironmentStatus() {
    if (!elements.environmentStatus) {
        return;
    }
    const runtimeProfile = String(state.snapshot?.settings?.runtimeProfile || "").trim().toLowerCase();
    const runtimeSuffix = runtimeProfile ? ` | Runtime: ${runtimeProfile}` : "";
    if (state.meta?.isPackaged === false) {
        elements.environmentStatus.textContent = `Environment: Development Build${runtimeSuffix}`;
        return;
    }
    if (state.meta?.isPackaged === true) {
        elements.environmentStatus.textContent = `Environment: Production Build${runtimeSuffix}`;
        return;
    }
    elements.environmentStatus.textContent = `Environment: Unknown${runtimeSuffix}`;
}

const icons = {
    refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.45-6.36L21 3v6h-6l2.32-2.32A7 7 0 1 0 19 12h2a9 9 0 0 1-18 0z"/></svg>`,
    play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7-11-7z"/></svg>`,
    stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>`,
    docs: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 1v5h5"/></svg>`,
    update: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l4 4h-3v7h-2V7H8l4-4zm-7 9h2v7h10v-7h2v9H5v-9z"/></svg>`,
    install: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10l3-3 1.4 1.4-5.4 5.4-5.4-5.4L7 10l3 3V3h2zm-7 16h14v2H5v-2z"/></svg>`,
    restart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6V3L8 7l4 4V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-6z"/></svg>`
};

function iconSvg(name) {
    return icons[name] || "";
}

function normalizeUrl(value) {
    if (!value) {
        return "";
    }
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }
    return raw.replace(/\/+$/, "");
}

function resolveComponentOpenUrl(component) {
    const candidates = [
        component?.openUrl,
        component?.health?.url,
        component?.healthUrl,
        component?.url,
        component?.baseUrl,
        component?.listenPrefix
    ];
    for (const candidate of candidates) {
        const normalized = normalizeUrl(candidate);
        if (normalized) {
            return normalized;
        }
    }
    return "";
}

function extractPorts(component) {
    const candidates = [
        component?.openUrl,
        component?.health?.url,
        component?.healthUrl,
        component?.url,
        component?.baseUrl,
        component?.listenPrefix
    ];
    const ports = new Set();
    candidates.forEach((candidate) => {
        const raw = String(candidate || "").trim();
        if (!raw) {
            return;
        }
        const matches = raw.match(/:(\d{2,5})(?=\/|$)/g) || [];
        matches.forEach((match) => {
            const value = match.replace(":", "");
            if (value) {
                ports.add(value);
            }
        });
    });
    return ports.size ? Array.from(ports).join(", ") : "-";
}

function setStatus(text) {
    if (elements.statusText) {
        elements.statusText.textContent = text;
    } else {
        elements.statusBar.textContent = text;
    }
}

function formatStatusTime(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function showToast(message, level = "info") {
    if (!elements.toastContainer) {
        return;
    }
    const toast = document.createElement("div");
    toast.className = `toast ${level}`;
    toast.innerHTML = `<span class="toastIcon"></span><span>${message}</span>`;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function requireApi() {
    if (!api) {
        throw new Error("IPC bridge unavailable. Restart the app and verify preload is loading.");
    }
    return api;
}

function formatStatus(component) {
    if (component.starting) {
        return "Starting";
    }
    if (component.stopping) {
        return "Stopping";
    }
    return component.running ? "Running" : "Stopped";
}

function serviceStatusClass(status) {
    const value = String(status || "").toLowerCase();
    if (value === "running") {
        return "status-running";
    }
    if (value.includes("pending")) {
        return "status-pending";
    }
    if (value === "paused") {
        return "status-paused";
    }
    if (value === "stopped") {
        return "status-stopped";
    }
    return "";
}

function healthClass(status) {
    const value = String(status || "").toLowerCase();
    if (value === "healthy") {
        return "health-healthy";
    }
    if (value === "unhealthy") {
        return "health-unhealthy";
    }
    return "";
}

function renderMeta() {
    if (!state.meta) {
        return;
    }

    elements.appVersion.textContent = state.meta.version || "-";
    elements.settingsPath.textContent = state.meta.settingsPath || "-";
    elements.controlUrl.textContent = state.meta.controlApiBaseUrl || "-";
    elements.serviceName.textContent = state.meta.serviceName || "-";
    elements.installUpdateButton.disabled = !state.meta.updateDownloaded;
    if (elements.adminRequiredBadge) {
        const isElevated = Boolean(state.meta.isElevated);
        elements.adminRequiredBadge.hidden = isElevated;
    }

    if (!state.devNoticeShown && state.meta.isPackaged === false) {
        showToast("Skip checkForUpdates because application is not packed and dev update config is not forced", "info");
        state.devNoticeShown = true;
    }
    renderEnvironmentStatus();
}

function renderService(service) {
    const statusMap = {
        "1": "Stopped",
        "2": "Start Pending",
        "3": "Stop Pending",
        "4": "Running",
        "5": "Continue Pending",
        "6": "Pause Pending",
        "7": "Paused"
    };

    const rawStatus = service?.Status ?? service?.status ?? "Unknown";
    const normalized = statusMap[String(rawStatus)] || String(rawStatus);
    elements.serviceStatus.textContent = normalized;
    elements.serviceStatus.className = `pill ${serviceStatusClass(normalized)}`;

    const isRunning = normalized.toLowerCase() === "running";
    const isStopped = normalized.toLowerCase() === "stopped";
    const isPending = normalized.toLowerCase().includes("pending");
    const startButton = document.getElementById("startServiceButton");
    const stopButton = document.getElementById("stopServiceButton");
    const forceKillButton = document.getElementById("forceKillServiceButton");
    if (startButton) {
        startButton.disabled = isRunning || isPending;
    }
    if (stopButton) {
        stopButton.disabled = isStopped || isPending;
    }
    if (forceKillButton) {
        forceKillButton.disabled = !(isPending || (!isStopped && !isRunning));
    }
}

function renderComponents(runtime, diagnostics = {}) {
    const components = Array.isArray(runtime?.components) ? runtime.components : [];
    elements.componentBody.innerHTML = "";

    if (!components.length) {
        const row = document.createElement("tr");
        const errorHint = diagnostics.runtimeError || diagnostics.settingsError || "";
        row.innerHTML = `<td colspan="10">${errorHint ? `No managed components available. ${errorHint}` : "No managed components available."}</td>`;
        elements.componentBody.appendChild(row);
        return;
    }

    components.forEach((component) => {
        const row = document.createElement("tr");
        row.dataset.componentId = component.id;
        const isDesktopApp = String(component?.id || "").toLowerCase() === "desktop-app";
        const openUrl = resolveComponentOpenUrl(component);
        const openLabel = component?.displayName ? `Open ${component.displayName}` : "Open";
        const portLabel = extractPorts(component);
        const actionButtons = isDesktopApp
            ? `<button data-action="launch-desktop-ui" class="btn compact">${iconSvg("play")}<span>Launch UI</span></button>`
            : `
              <button data-action="start" class="btn compact">${iconSvg("play")}<span>Start</span></button>
              <button data-action="restart" class="btn compact">${iconSvg("restart")}<span>Restart</span></button>
              <button data-action="stop" class="btn compact">${iconSvg("stop")}<span>Stop</span></button>
              <button data-action="open" class="btn compact" ${openUrl ? "" : "disabled"} title="${openUrl ? `Open ${openUrl}` : "No URL configured"}">${iconSvg("docs")}<span>${openLabel}</span></button>
            `;
        row.innerHTML = `
            <td>${component.id || "-"}</td>
            <td>${component.displayName || "-"}</td>
            <td class="${serviceStatusClass(formatStatus(component))}">${formatStatus(component)}</td>
            <td class="${healthClass(component.health?.status)}">${component.health?.status || "unknown"}</td>
            <td>${portLabel}</td>
            <td>${component.pid ?? "-"}</td>
            <td>${component.restartCount ?? 0}</td>
            <td>${component.lastStartUtc || "-"}</td>
            <td>${component.lastExitCode ?? "-"}</td>
            <td>${component.lastError || "-"}</td>
            <td>${actionButtons}</td>
        `;

        if (!isDesktopApp) {
            const statusText = formatStatus(component).toLowerCase();
            const startBtn = row.querySelector('button[data-action="start"]');
            const stopBtn = row.querySelector('button[data-action="stop"]');
            const restartBtn = row.querySelector('button[data-action="restart"]');
            const running = statusText === "running";
            const stopped = statusText === "stopped";
            const pending = statusText === "starting" || statusText === "stopping";
            if (startBtn) {
                startBtn.disabled = running || pending;
            }
            if (stopBtn) {
                stopBtn.disabled = stopped || pending;
            }
            if (restartBtn) {
                restartBtn.disabled = pending;
            }
        }

        row.addEventListener("click", (event) => {
            const actionButton = event.target?.closest?.("button[data-action]");
            const action = actionButton?.dataset?.action;
            if (action) {
                if (action === "launch-desktop-ui") {
                    withActionLock(`desktop-launch:${component.id}`, actionButton, async () => {
                        try {
                            await launchDesktopUiWithPreflight();
                        } catch (error) {
                            setStatus(`Desktop UI launch failed: ${error.message}`);
                            showToast(`Desktop UI launch failed: ${error.message}`, "error");
                        }
                    });
                    event.stopPropagation();
                    return;
                }
                if (action === "open") {
                    if (!openUrl) {
                        showToast("No URL configured for this component.", "warning");
                        event.stopPropagation();
                        return;
                    }
                    withActionLock(`open:${component.id}`, actionButton, async () => {
                        try {
                            await requireApi().openExternal(openUrl);
                            setStatus(`Opened ${openUrl}`);
                            showToast(`Opened ${openLabel}.`, "success");
                        } catch (error) {
                            setStatus(`Open failed: ${error.message}`);
                            showToast(`Open failed: ${error.message}`, "error");
                        }
                    });
                    event.stopPropagation();
                    return;
                }
                runComponentAction(component.id, action, actionButton);
                event.stopPropagation();
                return;
            }
            state.selectedComponentId = component.id;
            renderComponentDetail();
        });

        elements.componentBody.appendChild(row);
    });
}

function renderComponentDetail() {
    const components = Array.isArray(state.snapshot?.runtime?.components) ? state.snapshot.runtime.components : [];
    const selected = components.find((item) => item.id === state.selectedComponentId);
    if (!selected) {
        state.selectedComponent = null;
        elements.componentDetail.textContent = "Select a component row to view output tail and metadata.";
        if (elements.openLogButton) {
            elements.openLogButton.disabled = true;
        }
        if (elements.copyErrorButton) {
            elements.copyErrorButton.disabled = true;
        }
        if (elements.copyTailButton) {
            elements.copyTailButton.disabled = true;
        }
        return;
    }

    state.selectedComponent = selected;
    const detail = [
        `ID: ${selected.id}`,
        `Display: ${selected.displayName}`,
        `Status: ${formatStatus(selected)}`,
        `Health: ${selected.health?.status || "unknown"}`,
        `PID: ${selected.pid ?? "-"}`,
        `Last Start UTC: ${selected.lastStartUtc || "-"}`,
        `Last Exit UTC: ${selected.lastExitUtc || "-"}`,
        `Last Exit Code: ${selected.lastExitCode ?? "-"}`,
        `Last Error: ${selected.lastError || "-"}`,
        `Log Path: ${selected.logPath || "-"}`,
        "",
        "Output Tail:",
        ...(Array.isArray(selected.outputTail) && selected.outputTail.length ? selected.outputTail : ["(no output tail available)"])
    ];
    elements.componentDetail.textContent = detail.join("\n");

    if (elements.openLogButton) {
        elements.openLogButton.disabled = !selected.logPath;
    }
    if (elements.copyErrorButton) {
        elements.copyErrorButton.disabled = !(selected.lastError && String(selected.lastError || "").trim() && String(selected.lastError || "").trim() !== "-");
    }
    if (elements.copyTailButton) {
        elements.copyTailButton.disabled = !(Array.isArray(selected.outputTail) && selected.outputTail.length);
    }
}

async function refreshAll() {
    let meta = null;
    try {
        meta = await requireApi().getMeta();
        state.meta = meta;
        renderMeta();
    } catch (error) {
        setStatus(`Metadata refresh failed: ${error.message}`);
        showToast(`Metadata refresh failed: ${error.message}`, "error");
    }

    try {
        const snapshot = await requireApi().getStatus();
        state.snapshot = snapshot;
        if (state.meta && !state.meta.repoRoot && snapshot?.settings?.repoRoot) {
            state.meta.repoRoot = snapshot.settings.repoRoot;
        }
        renderService(snapshot.service);
        renderComponents(snapshot.runtime, snapshot.diagnostics);
        renderComponentDetail();
        renderEnvironmentStatus();

        const messages = [];
        if (meta?.settingsError) {
            messages.push(`settings: ${meta.settingsError}`);
        }
        if (snapshot?.diagnostics?.serviceError) {
            messages.push(`service: ${snapshot.diagnostics.serviceError}`);
        }
        if (snapshot?.diagnostics?.runtimeError) {
            const runtimeError = String(snapshot.diagnostics.runtimeError || "");
            const runtimeSuffix = runtimeError.toLowerCase() === "fetch failed"
                ? "fetch failed - is the service running?"
                : runtimeError;
            messages.push(`runtime: ${runtimeSuffix}`);
        }

        if (messages.length) {
            setStatus(`Refreshed with warnings at ${formatStatusTime()} (${messages.join(" | ")})`);
        } else {
            setStatus(`Refreshed at ${formatStatusTime()}`);
        }
    } catch (error) {
        renderService({ status: "Unknown" });
        renderComponents({ components: [] }, { runtimeError: error.message });
        setStatus(`Status refresh failed: ${error.message}`);
        showToast(`Status refresh failed: ${error.message}`, "error");
    }
}

function setBusy(button, busy, label) {
    if (!button) {
        return;
    }
    button.disabled = Boolean(busy);
    button.classList.toggle("is-busy", Boolean(busy));
    if (label) {
        const textNode = button.querySelector("span");
        if (textNode) {
            textNode.textContent = label;
        }
    }
}

async function withActionLock(key, button, fn) {
    if (actionLocks.has(key)) {
        return;
    }
    actionLocks.add(key);
    setBusy(button, true);
    try {
        await fn();
    } finally {
        setBusy(button, false);
        actionLocks.delete(key);
    }
}

async function runServiceAction(action, button) {
    return withActionLock(`service:${action}`, button, async () => {
        try {
            if (action === "start") {
                await requireApi().startService();
            } else {
                await requireApi().stopService();
            }
            await refreshAll();
            setStatus(`Service ${action} succeeded.`);
            showToast(`Service ${action} succeeded.`, "success");
        } catch (error) {
            setStatus(`Service ${action} failed: ${error.message}`);
            showToast(`Service ${action} failed: ${error.message}`, "error");
        }
    });
}

async function runBulkAction(action, button) {
    return withActionLock(`bulk:${action}`, button, async () => {
        try {
            if (action === "start") {
                await requireApi().startAllComponents();
            } else if (action === "restart") {
                await requireApi().restartAllComponents();
            } else {
                await requireApi().stopAllComponents();
            }
            await refreshAll();
            setStatus(`${action} all components succeeded.`);
            showToast(`${action} all components succeeded.`, "success");
        } catch (error) {
            setStatus(`${action} all components failed: ${error.message}`);
            showToast(`${action} all components failed: ${error.message}`, "error");
        }
    });
}

async function runComponentAction(componentId, action, button) {
    return withActionLock(`component:${componentId}:${action}`, button, async () => {
        try {
            await requireApi().componentAction(componentId, action);
            await refreshAll();
            setStatus(`${action} ${componentId} succeeded.`);
            showToast(`${action} ${componentId} succeeded.`, "success");
        } catch (error) {
            setStatus(`${action} ${componentId} failed: ${error.message}`);
            showToast(`${action} ${componentId} failed: ${error.message}`, "error");
        }
    });
}

async function launchDesktopUiWithPreflight() {
    const result = await requireApi().launchDesktopUserSession();
    const pidText = result?.pid ? ` (PID ${result.pid})` : "";
    const listenSuffix = result?.listenPrefix ? ` via ${result.listenPrefix}` : "";
    setStatus(`Desktop UI launch requested${pidText}${listenSuffix}.`);
    showToast(`Desktop UI launch requested${pidText}.`, "success");
}

function bindButton(buttonId, handler) {
    const button = document.getElementById(buttonId);
    if (!button) {
        setStatus(`UI wiring warning: missing button [${buttonId}]`);
        return;
    }
    button.addEventListener("click", () => handler(button));
}

function wireButtons() {
    if (elements.openServiceLogsButton) {
        elements.openServiceLogsButton.addEventListener("click", async () => {
            const repoRoot = state.meta?.repoRoot || state.snapshot?.settings?.repoRoot;
            if (!repoRoot) {
                showToast("No repo root found in settings.", "warning");
                return;
            }
            const path = `${repoRoot}\\Logs\\ServiceHost`;
            try {
                await requireApi().openPath(path);
                showToast("Opened service logs folder.", "success");
            } catch (error) {
                showToast(`Open logs failed: ${error.message}`, "error");
            }
        });
    }

    if (elements.openLogButton) {
        elements.openLogButton.addEventListener("click", async () => {
            const logPath = state.selectedComponent?.logPath;
            if (!logPath) {
                showToast("No log path available for this component.", "warning");
                return;
            }
            try {
                await requireApi().openPath(logPath);
                showToast("Opened component log.", "success");
            } catch (error) {
                showToast(`Open log failed: ${error.message}`, "error");
            }
        });
    }

    if (elements.copyErrorButton) {
        elements.copyErrorButton.addEventListener("click", async () => {
            const errorText = state.selectedComponent?.lastError;
            if (!errorText || String(errorText || "").trim() === "-" ) {
                showToast("No error text to copy.", "warning");
                return;
            }
            try {
                await requireApi().copyToClipboard(String(errorText));
                showToast("Error copied.", "success");
            } catch (error) {
                showToast(`Copy failed: ${error.message}`, "error");
            }
        });
    }

    if (elements.copyTailButton) {
        elements.copyTailButton.addEventListener("click", async () => {
            const tail = state.selectedComponent?.outputTail;
            if (!Array.isArray(tail) || !tail.length) {
                showToast("No output tail to copy.", "warning");
                return;
            }
            try {
                await requireApi().copyToClipboard(tail.join("\n"));
                showToast("Output tail copied.", "success");
            } catch (error) {
                showToast(`Copy failed: ${error.message}`, "error");
            }
        });
    }

    if (elements.copySettingsButton) {
        elements.copySettingsButton.addEventListener("click", async () => {
            const value = elements.settingsPath.textContent.trim();
            if (!value || value === "-") {
                showToast("No settings path to copy.", "warning");
                return;
            }
            try {
                await requireApi().copyToClipboard(value);
                showToast("Settings path copied.", "success");
            } catch (error) {
                showToast(`Copy failed: ${error.message}`, "error");
            }
        });
    }

    if (elements.copyControlUrlButton) {
        elements.copyControlUrlButton.addEventListener("click", async () => {
            const value = elements.controlUrl.textContent.trim();
            if (!value || value === "-") {
                showToast("No Control API URL to copy.", "warning");
                return;
            }
            try {
                await requireApi().copyToClipboard(value);
                showToast("Control API URL copied.", "success");
            } catch (error) {
                showToast(`Copy failed: ${error.message}`, "error");
            }
        });
    }

    bindButton("refreshButton", (button) => withActionLock("refresh", button, refreshAll));
    bindButton("startServiceButton", (button) => runServiceAction("start", button));
    bindButton("stopServiceButton", (button) => runServiceAction("stop", button));
    bindButton("forceKillServiceButton", (button) => withActionLock("forceKill", button, async () => {
        try {
            await requireApi().forceKillService();
            await refreshAll();
            setStatus("Service force kill succeeded.");
            showToast("Service force kill succeeded.", "warning");
        } catch (error) {
            setStatus(`Service force kill failed: ${error.message}`);
            showToast(`Service force kill failed: ${error.message}`, "error");
        }
    }));
    bindButton("launchDesktopUiButton", (button) => withActionLock("launchDesktopUi", button, async () => {
        try {
            await launchDesktopUiWithPreflight();
        } catch (error) {
            setStatus(`Desktop UI launch failed: ${error.message}`);
            showToast(`Desktop UI launch failed: ${error.message}`, "error");
        }
    }));
    bindButton("repairSuiteButton", (button) => withActionLock("suiteRepair", button, async () => {
        try {
            await requireApi().runSuiteRepair();
            await refreshAll();
            setStatus("Suite repair completed successfully.");
            showToast("Suite repair completed successfully.", "success");
        } catch (error) {
            setStatus(`Suite repair failed: ${error.message}`);
            showToast(`Suite repair failed: ${error.message}`, "error");
        }
    }));
    bindButton("startAllButton", (button) => runBulkAction("start", button));
    bindButton("restartAllButton", (button) => runBulkAction("restart", button));
    bindButton("stopAllButton", (button) => runBulkAction("stop", button));

    bindButton("checkUpdatesButton", (button) => withActionLock("checkUpdates", button, async () => {
        try {
            await requireApi().checkUpdates();
            setStatus("Update check requested.");
            showToast("Update check requested.", "info");
        } catch (error) {
            setStatus(`Update check failed: ${error.message}`);
            showToast(`Update check failed: ${error.message}`, "error");
        }
    }));

    bindButton("installUpdateButton", (button) => withActionLock("installUpdate", button, async () => {
        try {
            const result = await requireApi().installUpdate();
            if (!result.installed) {
                setStatus(result.reason || "No downloaded update available.");
                showToast(result.reason || "No downloaded update available.", "warning");
            } else {
                showToast("Installing update.", "success");
            }
        } catch (error) {
            setStatus(`Install update failed: ${error.message}`);
            showToast(`Install update failed: ${error.message}`, "error");
        }
    }));
}

function initUpdateEvents() {
    if (!api || typeof api.onUpdateStatus !== "function") {
        setStatus("IPC bridge unavailable: update events are disabled.");
        return;
    }

    api.onUpdateStatus((payload) => {
        const message = payload?.message || "Update status changed.";
        elements.updateStatus.textContent = `Update status: ${message}`;
        if (/downloaded/i.test(message)) {
            elements.installUpdateButton.disabled = false;
        }
    });
}

wireButtons();
initUpdateEvents();
refreshAll();
setInterval(refreshAll, 15000);
