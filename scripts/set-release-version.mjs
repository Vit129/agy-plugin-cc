import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function setVersion(value, version) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "version" && typeof item === "string") value[key] = version;
    else setVersion(item, version);
  }
}

export function updateReleaseVersion(root, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Expected semver X.Y.Z");
  const semverFiles = [
    "package.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    "plugins/agy/.codex-plugin/plugin.json",
  ].filter((relative) => fs.existsSync(path.join(root, relative)));
  for (const relative of semverFiles) {
    const file = path.join(root, relative);
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (relative === "package.json") value.version = version;
    else setVersion(value, version);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  const buildFile = path.join(root, "version.json");
  const build = JSON.parse(fs.readFileSync(buildFile, "utf8"));
  build.version += 1;
  build.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(buildFile, `${JSON.stringify(build, null, 2)}\n`);

  const updaterFile = path.join(root, "plugins/agy/scripts/lib/git-update-check.mjs");
  const updater = fs.readFileSync(updaterFile, "utf8");
  const updated = updater.replace(/export const CURRENT_VERSION = \d+;/, `export const CURRENT_VERSION = ${build.version};`);
  if (updated === updater) throw new Error("Could not update CURRENT_VERSION in git-update-check.mjs");
  fs.writeFileSync(updaterFile, updated);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  updateReleaseVersion(path.resolve(path.dirname(scriptPath), ".."), process.argv[2]);
}
