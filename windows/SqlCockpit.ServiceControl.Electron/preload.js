const { contextBridge, ipcRenderer } = require("electron");

async function invoke(channel, ...args) {
    try {
        return await ipcRenderer.invoke(channel, ...args);
    } catch (error) {
        throw new Error(error?.message || "IPC request failed.");
    }
}

contextBridge.exposeInMainWorld("serviceControl", {
    getMeta: () => invoke("app:get-meta"),
    reloadSettings: (settingsPath = "") => invoke("settings:reload", settingsPath),
    getStatus: () => invoke("status:get"),
    startService: () => invoke("service:start"),
    stopService: () => invoke("service:stop"),
    checkDesktopLaunchPreflight: () => invoke("desktop:launch-preflight"),
    launchDesktopUserSession: () => invoke("desktop:launch-user-session"),
    runSuiteRepair: () => invoke("suite:repair"),
    forceKillService: () => invoke("service:force-kill"),
    startAllComponents: () => invoke("components:start-all"),
    restartAllComponents: () => invoke("components:restart-all"),
    stopAllComponents: () => invoke("components:stop-all"),
    componentAction: (componentId, action) => invoke("component:action", componentId, action),
    openExternal: (url) => invoke("shell:open-external", url),
    openPath: (targetPath) => invoke("shell:open-path", targetPath),
    openDocs: () => invoke("docs:open"),
    copyToClipboard: (text) => invoke("clipboard:copy", text),
    checkUpdates: () => invoke("updates:check"),
    installUpdate: () => invoke("updates:install"),
    onUpdateStatus: (handler) => {
        if (typeof handler !== "function") {
            return () => {};
        }
        const listener = (_, payload) => handler(payload);
        ipcRenderer.on("updates:status", listener);
        return () => ipcRenderer.removeListener("updates:status", listener);
    }
});
