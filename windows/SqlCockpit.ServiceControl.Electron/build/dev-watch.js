const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const electronBinary = require("electron");
const passthroughArgs = process.argv.slice(2);

let child = null;
let restartTimer = null;
let stopping = false;

function log(message) {
    process.stdout.write(`[DEV-WATCH] ${message}\n`);
}

function startElectron() {
    const args = ["."].concat(passthroughArgs);
    child = spawn(electronBinary, args, {
        cwd: appRoot,
        stdio: "inherit"
    });
    child.on("exit", (code, signal) => {
        if (!stopping) {
            log(`Electron exited (code=${code ?? "null"}, signal=${signal ?? "null"}). Waiting for file changes...`);
        }
    });
}

function stopElectron() {
    if (!child || child.killed) {
        return;
    }
    child.kill();
}

function scheduleRestart(reason) {
    if (restartTimer) {
        clearTimeout(restartTimer);
    }
    restartTimer = setTimeout(() => {
        log(`Change detected (${reason}). Restarting Electron...`);
        stopElectron();
        startElectron();
    }, 250);
}

function shouldTrigger(filePath = "") {
    const lower = filePath.toLowerCase();
    return (
        lower.endsWith(".js") ||
        lower.endsWith(".html") ||
        lower.endsWith(".css") ||
        lower.endsWith(".json")
    );
}

function watchPath(targetPath, recursive = false) {
    if (!fs.existsSync(targetPath)) {
        return;
    }

    fs.watch(targetPath, { recursive }, (eventType, fileName) => {
        const rel = String(fileName || "");
        if (!shouldTrigger(rel)) {
            return;
        }
        scheduleRestart(`${eventType}:${rel}`);
    });
}

process.on("SIGINT", () => {
    stopping = true;
    stopElectron();
    process.exit(0);
});

process.on("SIGTERM", () => {
    stopping = true;
    stopElectron();
    process.exit(0);
});

log("Starting Electron in watch mode...");
if (passthroughArgs.length) {
    log(`Forwarded args: ${passthroughArgs.join(" ")}`);
}

startElectron();
watchPath(path.join(appRoot, "main.js"));
watchPath(path.join(appRoot, "preload.js"));
watchPath(path.join(appRoot, "renderer"), true);
