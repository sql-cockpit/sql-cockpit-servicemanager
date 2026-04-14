const fs = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

function formatStamp(value) {
    const pad = (n) => String(n).padStart(2, "0");
    return [
        value.getFullYear(),
        pad(value.getMonth() + 1),
        pad(value.getDate())
    ].join("") + "-" + [pad(value.getHours()), pad(value.getMinutes()), pad(value.getSeconds())].join("");
}

const target = String(process.argv[2] || "nsis").trim().toLowerCase();
if (!["nsis", "portable"].includes(target)) {
    console.error(`[BUILD] Unsupported target [${target}]. Expected nsis or portable.`);
    process.exit(1);
}

const appRoot = path.resolve(__dirname, "..");
const defaultOutput = path.join("..", "publish", `electron-control-${formatStamp(new Date())}`);
const outputDir = process.env.ELECTRON_BUILDER_OUTPUT_DIR || defaultOutput;
const builderCliJs = path.join(appRoot, "node_modules", "electron-builder", "out", "cli", "cli.js");
if (!fs.existsSync(builderCliJs)) {
    console.error(`[BUILD] electron-builder CLI not found at ${builderCliJs}. Run npm ci first.`);
    process.exit(1);
}

console.log(`[BUILD] Target: ${target}`);
console.log(`[BUILD] Output: ${path.resolve(appRoot, outputDir)}`);

const result = spawnSync(
    process.execPath,
    [
        builderCliJs,
        "--win",
        target,
        `--config.directories.output=${outputDir}`
    ],
    {
        cwd: appRoot,
        stdio: "inherit"
    }
);

if (result.error) {
    console.error(`[BUILD] Failed to start electron-builder: ${result.error.message}`);
    process.exit(1);
}

if (typeof result.status !== "number" || result.status !== 0) {
    process.exit(typeof result.status === "number" ? result.status : 1);
}

function findInstallerPath(rootDir) {
    if (!fs.existsSync(rootDir)) {
        return "";
    }

    const queue = [rootDir];
    const matches = [];
    while (queue.length) {
        const current = queue.shift();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(full);
                continue;
            }

            const lower = entry.name.toLowerCase();
            if (!lower.endsWith(".exe")) {
                continue;
            }
            if (target === "nsis" && !lower.includes("setup")) {
                continue;
            }
            if (target === "portable" && lower.includes("setup")) {
                continue;
            }
            matches.push(full);
        }
    }

    return matches.sort()[0] || "";
}

const absoluteOutput = path.resolve(appRoot, outputDir);
const installerPath = findInstallerPath(absoluteOutput);
if (installerPath) {
    console.log(`[BUILD] Installer path: ${installerPath}`);
} else {
    console.log(`[BUILD] Installer path: (not found under ${absoluteOutput})`);
}

process.exit(0);
