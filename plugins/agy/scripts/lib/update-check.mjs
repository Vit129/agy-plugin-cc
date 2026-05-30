import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@vit129/agy-plugin-cc";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NPM_TIMEOUT_MS = 3500;
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".config", "agy-plugin-cc", "config.json");

const ROOT_DIR = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function readCurrentVersion() {
  const manifestPath = path.join(ROOT_DIR, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return manifest.version;
}

function parseVersion(version) {
  return String(version)
    .trim()
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function isNewerVersion(candidate, current) {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) {
      return true;
    }
    if (a < b) {
      return false;
    }
  }
  return false;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: options.timeout ?? NPM_TIMEOUT_MS,
    stdio: options.stdio ?? "pipe"
  });
}

function shouldCheck(config, force) {
  if (force) {
    return true;
  }
  const lastCheckedAt = Date.parse(config.lastUpdateCheckAt ?? "");
  if (!Number.isFinite(lastCheckedAt)) {
    return true;
  }
  return Date.now() - lastCheckedAt >= CHECK_INTERVAL_MS;
}

function readGlobalConfig() {
  if (!fs.existsSync(GLOBAL_CONFIG_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function resolveAutoUpdate(config) {
  if (typeof config.autoUpdate === "boolean") {
    return config.autoUpdate;
  }
  return Boolean(readGlobalConfig().autoUpdate);
}

function viewLatestVersion() {
  const result = run("npm", ["view", PACKAGE_NAME, "version", "--silent"]);
  if (result.status !== 0 || result.error) {
    return {
      ok: false,
      reason: result.error?.message || String(result.stderr || "").trim() || "npm view failed"
    };
  }
  return {
    ok: true,
    version: String(result.stdout || "").trim()
  };
}

function runAutoInstall() {
  const result = run(
    "npx",
    ["-y", `${PACKAGE_NAME}@latest`, "install", "--auto-update"],
    {
      timeout: 120000,
      stdio: "pipe"
    }
  );

  return {
    ok: result.status === 0 && !result.error,
    output: String(result.stdout || result.stderr || "").trim(),
    reason: result.error?.message || String(result.stderr || "").trim()
  };
}

export function checkForPluginUpdate(config = {}, options = {}) {
  const currentVersion = readCurrentVersion();
  const autoUpdate = resolveAutoUpdate(config);
  if (!shouldCheck(config, Boolean(options.force))) {
    return {
      checked: false,
      currentVersion,
      autoUpdate
    };
  }

  const latest = viewLatestVersion();
  const checkedAt = new Date().toISOString();
  if (!latest.ok || !latest.version) {
    return {
      checked: true,
      currentVersion,
      latestVersion: null,
      autoUpdate,
      checkedAt,
      error: latest.reason
    };
  }

  const updateAvailable = isNewerVersion(latest.version, currentVersion);
  const report = {
    checked: true,
    currentVersion,
    latestVersion: latest.version,
    updateAvailable,
    autoUpdate,
    checkedAt
  };

  if (updateAvailable && autoUpdate) {
    const installed = runAutoInstall();
    return {
      ...report,
      autoUpdateAttempted: true,
      autoUpdateSucceeded: installed.ok,
      installOutput: installed.output,
      error: installed.ok ? null : installed.reason
    };
  }

  return report;
}
