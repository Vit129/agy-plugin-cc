import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const packageVersion = readJson("package.json").version;
const semver = /^\d+\.\d+\.\d+$/;
if (!semver.test(packageVersion)) throw new Error(`package.json has invalid semver: ${packageVersion}`);

function collectVersions(value, found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, item] of Object.entries(value)) {
    if (key === "version" && typeof item === "string") found.push(item);
    else collectVersions(item, found);
  }
  return found;
}

for (const surface of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
  const versions = collectVersions(readJson(surface));
  if (!versions.length || versions.some((version) => version !== packageVersion)) {
    throw new Error(`${surface} version(s) must match package.json ${packageVersion}; found ${versions.join(", ") || "none"}`);
  }
}

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const latest = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
if (latest !== packageVersion) throw new Error(`CHANGELOG.md latest version ${latest ?? "missing"} does not match ${packageVersion}`);

const buildVersion = readJson("version.json").version;
const updater = fs.readFileSync(path.join(root, "plugins/agy/scripts/lib/git-update-check.mjs"), "utf8");
const updaterVersion = updater.match(/export const CURRENT_VERSION = (\d+);/)?.[1];
if (!Number.isInteger(buildVersion) || Number(updaterVersion) !== buildVersion) {
  throw new Error(`version.json build ${buildVersion} does not match update-check build ${updaterVersion ?? "missing"}`);
}

console.log(`version surfaces agree: ${packageVersion} (build ${buildVersion})`);
