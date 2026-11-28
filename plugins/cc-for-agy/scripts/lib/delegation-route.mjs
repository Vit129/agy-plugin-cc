import { chooseRoute, isRouteOffPersisted, loadRouteThresholds, parseRouteMode } from "./quota-route.mjs";
import { readAllQuota, resolveAgyPool } from "./quota-state.mjs";
import { appendUsageLog, nowIso } from "./state.mjs";

export const DIVERSION_PREFIX = "Auto-route diverted";

export function autoRoute(requested, { env = process.env, nowSec, model } = {}) {
  const quota = readAllQuota({ env, nowSec });
  const agyPool = model ? resolveAgyPool(model) : quota.agy.activePool || "gemini";
  return chooseRoute(quota, { ...loadRouteThresholds(env), requested, agyPool, enabled: !isRouteOffPersisted(env) });
}

export function recordDiversion(cwd, kind, requested, decision, env = process.env) {
  const event = { kind, status: "diverted", requested, ...decision };
  try {
    appendUsageLog(cwd, { at: nowIso(), ...event }, env);
  } catch (error) {
    process.stderr.write(`Quota diversion ledger: ${error.code ?? error.name}\n`);
  }
  const provider = decision.target === "agy" ? "agy" : "Claude";
  return { ...event, message: `${DIVERSION_PREFIX} to ${provider}. Run this job in ${provider}. ${decision.reason}` };
}

export function checkClaudeRoute(cwd, kind, route) {
  if (parseRouteMode(route) === "off") return null;
  const decision = autoRoute("claude");
  return decision.target === "agy" ? recordDiversion(cwd, kind, "claude", decision) : null;
}
