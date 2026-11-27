import { getAgyAuthStatus, getAgyAvailability, installHint } from "../lib/agy.mjs";
import { getCodexBarAvailability, runCodexBarAntigravityQuota } from "../lib/codexbar.mjs";
import { readAllQuota } from "../lib/quota-state.mjs";
import { renderSetupReport } from "../lib/render.mjs";
import { getConfig, setConfig } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";
import { outputResult, parseCommandInput, resolveCommandCwd, resolveCommandWorkspace } from "./shared.mjs";

export async function buildSetupReport(cwd, actionsTaken = []) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const agyStatus = getAgyAvailability(cwd);
  const authStatus = getAgyAuthStatus(cwd);
  const config = getConfig(workspaceRoot);

  const nextSteps = [];
  if (!agyStatus.available) {
    nextSteps.push(
      `Install agy with: ${installHint()}`
    );
  }
  if (!config.stopReviewGate) {
    nextSteps.push(
      "Optional: run `/agy:setup --enable-review-gate` to require a fresh review before stop."
    );
  }

  return {
    ready: agyStatus.available,
    agy: agyStatus,
    auth: authStatus,
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps
  };
}

export async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: [
      "json",
      "enable-review-gate",
      "disable-review-gate"
    ]
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }

  const finalReport = await buildSetupReport(cwd, actionsTaken);
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), options.json);
}

export function buildQuotaLines(cwd, options = {}) {
  if (!options.liveQuota) {
    const all = readAllQuota(options);
    const agyPools = all.agy.pools;
    const hasLocal =
      all.agy.available ||
      all.claude.available ||
      agyPools.gemini["5h"].state !== "unknown";
    if (hasLocal) {
      const fmt = (w) =>
        w && w.state !== "unknown"
          ? `${100 - w.effectiveRemainingPct}% used (${w.effectiveRemainingPct}% rem, ${w.state})`
          : "unknown";
      const lines = [];
      if (all.agy.available) {
        lines.push(
          `- agy:gemini — 5h: ${fmt(agyPools.gemini["5h"])}, 7d: ${fmt(agyPools.gemini["7d"])}`,
          `- agy:argon — 7d: ${fmt(agyPools.argon["7d"])}`,
          `- agy:3p — 5h: ${fmt(agyPools["3p"]["5h"])}, 7d: ${fmt(agyPools["3p"]["7d"])}`
        );
      }
      if (all.claude.available) {
        const cp = all.claude.pools.default;
        lines.push(`- claude:default — 5h: ${fmt(cp["5h"])}, 7d: ${fmt(cp["7d"])}`);
      }
      if (lines.length > 0) return lines;
    }
  }

  const avail = getCodexBarAvailability(cwd);
  if (!avail.available) {
    return ["codexbar not installed — run `brew install --cask codexbar` to see Antigravity quota here."];
  }

  const result = runCodexBarAntigravityQuota(cwd, { timeout: 10000 });
  if (result.exitCode !== 0) {
    const detail = String(result.stderr ?? "").trim();
    return [`codexbar usage check failed (not logged in, or the antigravity provider is disabled in codexbar)${detail ? `: ${detail}` : "."}`];
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return ["Could not parse codexbar output."];
  }

  const usage = Array.isArray(parsed) ? parsed[0]?.usage : null;
  const windows = usage?.extraRateWindows ?? [];
  if (windows.length === 0) {
    return ["No Antigravity usage data returned by codexbar."];
  }

  const lines = usage.accountEmail ? [`Account: ${usage.accountEmail}`] : [];
  for (const w of windows) {
    const pct = typeof w.window?.usedPercent === "number" ? `${w.window.usedPercent.toFixed(1)}% used` : "unknown";
    const resets = w.window?.resetsAt ? ` (resets ${w.window.resetsAt})` : "";
    lines.push(`- ${w.title}: ${pct}${resets}`);
  }
  return lines;
}
