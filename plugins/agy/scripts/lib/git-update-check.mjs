import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { isWorkingTreeDirty } from "./git.mjs";
import { runCommand } from "./process.mjs";

// Bump alongside version.json at the repo root whenever a feature ships.
export const CURRENT_VERSION = 1;

const REPO = "Vit129/agy-plugin-cc";
const VERSION_URL = `https://raw.githubusercontent.com/${REPO}/main/version.json`;
const FETCH_TIMEOUT_MS = 2500;
const CONFIG_DIR = path.join(os.homedir(), ".config", "agy-plugin-cc");
const DISMISS_FILE = path.join(CONFIG_DIR, "update-dismissed");

function findGitRoot(startDir) {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd: startDir });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

async function fetchRemoteVersion() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(VERSION_URL, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const data = await response.json();
    if (typeof data.version !== "number") {
      return { ok: false, reason: "version.json missing numeric \"version\" field" };
    }
    return { ok: true, data };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timed out" : error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

function readDismissedVersion() {
  try {
    const raw = fs.readFileSync(DISMISS_FILE, "utf8").trim();
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeDismissedVersion(version) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(DISMISS_FILE, `${version}\n`, "utf8");
  } catch {
    // best-effort only
  }
}

// Checks the git-clone install path for a newer version.json on GitHub and,
// when found, either reports it (dirty tree) or hands the caller enough to
// ask the user for confirmation before pulling (clean tree). Never pulls
// itself — see commands/agy-update.md for the confirm-then-pull step.
export async function checkGitCloneUpdate(startDir) {
  const gitRoot = findGitRoot(startDir);
  if (!gitRoot) {
    return { checked: false, reason: "not-a-git-checkout" };
  }

  const remote = await fetchRemoteVersion();
  if (!remote.ok) {
    return { checked: false, gitRoot, reason: remote.reason };
  }

  const { version: remoteVersion, updated, summary } = remote.data;
  if (remoteVersion <= CURRENT_VERSION) {
    return { checked: true, gitRoot, currentVersion: CURRENT_VERSION, remoteVersion, updateAvailable: false };
  }

  const dismissedVersion = readDismissedVersion();
  if (dismissedVersion !== null && dismissedVersion >= remoteVersion) {
    return {
      checked: true,
      gitRoot,
      currentVersion: CURRENT_VERSION,
      remoteVersion,
      updateAvailable: true,
      dismissed: true
    };
  }

  const dirty = isWorkingTreeDirty(gitRoot);

  return {
    checked: true,
    gitRoot,
    currentVersion: CURRENT_VERSION,
    remoteVersion,
    updated,
    summary,
    updateAvailable: true,
    dismissed: false,
    dirty
  };
}

export function dismissUpdate(version) {
  writeDismissedVersion(version);
}

export function formatUpdateNotice(report) {
  if (!report.checked || !report.updateAvailable || report.dismissed) {
    return null;
  }
  const versionLabel = `v${report.currentVersion} -> v${report.remoteVersion}`;
  if (report.dirty) {
    return `agy-plugin-cc git update available (${versionLabel}): working tree has uncommitted changes, pull manually later.`;
  }
  return `agy-plugin-cc git update available (${versionLabel}, ${report.updated}): ${report.summary}. Run /agy-update to review and pull.`;
}
