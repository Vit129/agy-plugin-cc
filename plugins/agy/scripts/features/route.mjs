import { decideRoute, readAllQuota } from "../lib/quota-state.mjs";
import { outputResult, parseCommandInput } from "./shared.mjs";

function formatWindow(w) {
  if (!w || w.state === "unknown") return "unknown";
  return `${w.effectiveRemainingPct}% rem (${w.state})`;
}

export function renderRouteReport(decision, quota) {
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
  const payload = { ...decision, quota };

  outputResult(
    options.json ? payload : renderRouteReport(decision, quota),
    options.json
  );
}
