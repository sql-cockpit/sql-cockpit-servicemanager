/* global serviceControl */

const state = {
    meta: null,
    snapshot: null,
    selectedComponentId: ""
};

const elements = {
    appVersion: document.getElementById("appVersion"),
    settingsPath: document.getElementById("settingsPath"),
    controlUrl: document.getElementById("controlUrl"),
    serviceName: document.getElementById("serviceName"),
    serviceStatus: document.getElementById("serviceStatus"),
    updateStatus: document.getElementById("updateStatus"),
    componentBody: document.getElementById("componentBody"),
    componentDetail: document.getElementById("componentDetail"),
    statusBar: document.getElementById("statusBar"),
    installUpdateButton: document.getElementById("installUpdateButton")
};

function setStatus(text) {
    elements.statusBar.textContent = text;
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

    elements.appVersion.textContent = `Version: ${state.meta.version}`;
    elements.settingsPath.textContent = `Settings: ${state.meta.settingsPath}`;
    elements.controlUrl.textContent = `Control API: ${state.meta.controlApiBaseUrl}`;
    elements.serviceName.textContent = state.meta.serviceName;
    elements.installUpdateButton.disabled = !state.meta.updateDownloaded;
}

function renderService(service) {
    const status = String(service?.Status || service?.status || "Unknown");
    elements.serviceStatus.textContent = status;
    elements.serviceStatus.className = `pill ${serviceStatusClass(status)}`;
}

function renderComponents(runtime) {
    const components = Array.isArray(runtime?.components) ? runtime.components : [];
    elements.componentBody.innerHTML = "";

    components.forEach((component) => {
        const row = document.createElement("tr");
        row.dataset.componentId = component.id;
        row.innerHTML = `
            <td>${component.id || "-"}</td>
            <td>${component.displayName || "-"}</td>
            <td class="${serviceStatusClass(formatStatus(component))}">${formatStatus(component)}</td>
            <td class="${healthClass(component.health?.status)}">${component.health?.status || "unknown"}</td>
            <td>${component.pid ?? "-"}</td>
            <td>${component.restartCount ?? 0}</td>
            <td>${component.lastStartUtc || "-"}</td>
            <td>${component.lastExitCode ?? "-"}</td>
            <td>${component.lastError || "-"}</td>
            <td>
              <button data-action="start">Start</button>
              <button data-action="restart">Restart</button>
              <button data-action="stop">Stop</button>
            </td>
        `;

        row.addEventListener("click", (event) => {
            const action = event.target?.dataset?.action;
            if (action) {
                runComponentAction(component.id, action);
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
        elements.componentDetail.textContent = "Select a component row to view output tail and metadata.";
        return;
    }

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
}

async function refreshAll() {
    try {
        const [meta, snapshot] = await Promise.all([
            serviceControl.getMeta(),
            serviceControl.getStatus()
        ]);
        state.meta = meta;
        state.snapshot = snapshot;
        renderMeta();
        renderService(snapshot.service);
        renderComponents(snapshot.runtime);
        renderComponentDetail();
        setStatus(`Refreshed at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
        setStatus(`Refresh failed: ${error.message}`);
    }
}

async function runServiceAction(action) {
    try {
        if (action === "start") {
            await serviceControl.startService();
        } else {
            await serviceControl.stopService();
        }
        await refreshAll();
        setStatus(`Service ${action} succeeded.`);
    } catch (error) {
        setStatus(`Service ${action} failed: ${error.message}`);
    }
}

async function runBulkAction(action) {
    try {
        if (action === "start") {
            await serviceControl.startAllComponents();
        } else if (action === "restart") {
            await serviceControl.restartAllComponents();
        } else {
            await serviceControl.stopAllComponents();
        }
        await refreshAll();
        setStatus(`${action} all components succeeded.`);
    } catch (error) {
        setStatus(`${action} all components failed: ${error.message}`);
    }
}

async function runComponentAction(componentId, action) {
    try {
        await serviceControl.componentAction(componentId, action);
        await refreshAll();
        setStatus(`${action} ${componentId} succeeded.`);
    } catch (error) {
        setStatus(`${action} ${componentId} failed: ${error.message}`);
    }
}

function wireButtons() {
    document.getElementById("refreshButton").addEventListener("click", refreshAll);
    document.getElementById("startServiceButton").addEventListener("click", () => runServiceAction("start"));
    document.getElementById("stopServiceButton").addEventListener("click", () => runServiceAction("stop"));

    document.getElementById("startAllButton").addEventListener("click", () => runBulkAction("start"));
    document.getElementById("restartAllButton").addEventListener("click", () => runBulkAction("restart"));
    document.getElementById("stopAllButton").addEventListener("click", () => runBulkAction("stop"));

    document.getElementById("checkUpdatesButton").addEventListener("click", async () => {
        try {
            await serviceControl.checkUpdates();
            setStatus("Update check requested.");
        } catch (error) {
            setStatus(`Update check failed: ${error.message}`);
        }
    });

    document.getElementById("installUpdateButton").addEventListener("click", async () => {
        try {
            const result = await serviceControl.installUpdate();
            if (!result.installed) {
                setStatus(result.reason || "No downloaded update available.");
            }
        } catch (error) {
            setStatus(`Install update failed: ${error.message}`);
        }
    });
}

function initUpdateEvents() {
    serviceControl.onUpdateStatus((payload) => {
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
