import { decideRoute, readAllQuota, resolveAgyPool } from "../lib/quota-state.mjs";
import { chooseRoute, isRouteOffPersisted, loadRouteThresholds, parseRouteMode } from "../lib/quota-route.mjs";
import { resolveStateDir } from "../lib/state.mjs";
import { appendUsageLog } from "../lib/usage.mjs";
import { outputResult, parseCommandInput } from "./shared.mjs";

export function applyAgyRoute(workspaceRoot, kind, options, model) {
  const mode = parseRouteMode(options.route);
  if (mode === "off" || options["dry-run"] || !process.env.CLAUDECODE || isRouteOffPersisted()) return false;
  const quota = readAllQuota();
  const settings = { ...loadRouteThresholds(), agyPool: resolveAgyPool(model) };
  const decision = chooseRoute(quota, { ...settings, requested: "agy" });
  if (decision.target === "agy") {
    const recommendation = chooseRoute(quota, { ...settings, requested: "claude" });
    if (recommendation.target === "agy") {
      process.stderr.write(`Auto-route recommends delegating to agy. ${recommendation.reason}\n`);
    }
    return false;
  }

  const event = { kind, status: "diverted", requested: "agy", ...decision };
  try {
    appendUsageLog(resolveStateDir(workspaceRoot), { at: new Date().toISOString(), ...event });
  } catch (error) {
    process.stderr.write(`Quota diversion ledger: ${error.code ?? error.name}\n`);
  }
  const message = `Auto-route diverted to Claude. Run this job in Claude. ${decision.reason}`;
  outputResult(options.json ? { ...event, message } : `${message}\n`, options.json);
  process.exitCode = 1;
  return true;
}

function formatWindow(w) {
  if (!w || w.state === "unknown") return "unknown";
  return `${w.effectiveRemainingPct}% rem (${w.state})`;
}

export function renderRouteReport(decision, quota, recommendation) {
  const lines = [
    "# Quota Route Decision",
    "",
    `Selected: ${decision.selected ? `${decision.selected.provider}:${decision.selected.pool}` : "none"}`,
    `Reason: ${decision.reason}`,
    "",
    "Pools:",
    `- claude:default — 5h: ${formatWindow(quota.claude.pools.default["5h"])}, 7d: ${formatWindow(quota.claude.pools.default["7d"])}`,
    `- agy:gemini — 5h: ${formatWindow(quota.agy.pools.gemini["5h"])}, 7d: ${formatWindow(quota.agy.pools.gemini["7d"])}`,
    `- agy:argon — 7d: ${formatWindow(quota.agy.pools.argon["7d"])}`,
    `- agy:3p — 5h: ${formatWindow(quota.agy.pools["3p"]["5h"])}, 7d: ${formatWindow(quota.agy.pools["3p"]["7d"])}`
  ];
  if (recommendation?.target === "agy") lines.push(`Auto-route recommends delegating to agy. ${recommendation.reason}`);
  return `${lines.join("\n")}\n`;
}

export function handleRoute(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["preferred", "model", "min-5h", "min-7d"],
    booleanOptions: ["json"]
  });

  const min5h = options["min-5h"] !== undefined ? Number(options["min-5h"]) : undefined;
  const min7d = options["min-7d"] !== undefined ? Number(options["min-7d"]) : undefined;
  const decision = decideRoute({
    preferred: options.preferred,
    model: options.model,
    min5h: Number.isFinite(min5h) ? min5h : undefined,
    min7d: Number.isFinite(min7d) ? min7d : undefined
  });
  const quota = readAllQuota();
  const recommendation = chooseRoute(quota, {
    ...loadRouteThresholds(), requested: "claude", agyPool: resolveAgyPool(options.model), enabled: !isRouteOffPersisted()
  });
  const payload = { ...decision, quota, recommendation };

  outputResult(
    options.json ? payload : renderRouteReport(decision, quota, recommendation),
    options.json
  );
}
