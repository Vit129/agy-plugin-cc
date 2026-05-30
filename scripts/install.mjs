#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@vit129/agy-plugin-cc";
const RELOAD_HINT = "In Claude Code, run: /plugin install agy@agy-plugin-cc then /reload-plugins";
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".config", "agy-plugin-cc", "config.json");

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function marketplace() {
  return readJson(path.join(packageRoot, ".claude-plugin", "marketplace.json"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeClaudeMarketplacePointer() {
  const targetDir = path.join(os.homedir(), ".claude", "plugins", "marketplaces");
  ensureDir(targetDir);
  const target = path.join(targetDir, "agy-plugin-cc.json");
  const pointer = {
    name: "agy-plugin-cc",
    source: "local",
    path: packageRoot,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(target, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  return target;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseFlags(args) {
  return new Set(args.filter((arg) => arg.startsWith("--")));
}

function writeGlobalAutoUpdate(enabled) {
  ensureDir(path.dirname(GLOBAL_CONFIG_PATH));
  fs.writeFileSync(
    GLOBAL_CONFIG_PATH,
    `${JSON.stringify({ autoUpdate: enabled, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
  return GLOBAL_CONFIG_PATH;
}

function install(args) {
  const flags = parseFlags(args);
  const meta = marketplace();
  const version = meta.metadata?.version ?? meta.plugins?.[0]?.version ?? "unknown";
  let pointer = null;
  const globalConfigPath = flags.has("--auto-update") ? writeGlobalAutoUpdate(true) : null;

  try {
    pointer = writeClaudeMarketplacePointer();
  } catch (error) {
    console.warn(`Could not write Claude marketplace pointer: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`Prepared agy@agy-plugin-cc v${version}.`);
  console.log(`Package root: ${packageRoot}`);
  if (pointer) {
    console.log(`Marketplace pointer: ${pointer}`);
  }
  if (flags.has("--auto-update")) {
    console.log(`Auto-update config: ${globalConfigPath}`);
    console.log("Auto-update is enabled. The plugin will update during /agy:setup when a newer npm version exists.");
  }
  console.log(RELOAD_HINT);
}

function update(args) {
  run("npm", ["install", "-g", `${PACKAGE_NAME}@latest`]);
  run("npx", ["-y", `${PACKAGE_NAME}@latest`, "install", ...args]);
}

function doctor() {
  const meta = marketplace();
  const version = meta.metadata?.version ?? meta.plugins?.[0]?.version ?? "unknown";
  console.log(`package: ${PACKAGE_NAME}`);
  console.log(`version: ${version}`);
  console.log(`package root: ${packageRoot}`);
  console.log(`root marketplace exists: ${fs.existsSync(path.join(packageRoot, ".claude-plugin", "marketplace.json")) ? "yes" : "no"}`);
  console.log(`plugin manifest exists: ${fs.existsSync(path.join(packageRoot, "plugins", "agy", ".claude-plugin", "plugin.json")) ? "yes" : "no"}`);
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  agy-plugin-cc install [--auto-update]",
      "  agy-plugin-cc update [--auto-update]",
      "  agy-plugin-cc doctor"
    ].join("\n")
  );
}

const [command = "help", ...args] = process.argv.slice(2);

switch (command) {
  case "install":
    install(args);
    break;
  case "update":
    update(args);
    break;
  case "doctor":
    doctor();
    break;
  case "help":
  case "--help":
  case "-h":
    printUsage();
    break;
  default:
    throw new Error(`Unknown command: ${command}`);
}
