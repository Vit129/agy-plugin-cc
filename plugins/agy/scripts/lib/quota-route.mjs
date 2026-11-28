import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const defaultRouteThresholds = Object.freeze({ critical: 30, low: 60 });

export function resolveAgentUsageState(env = process.env) {
  return env.AGENT_USAGE_STATE_DIR
    || path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "agent-usage");
}

export function loadRouteThresholds(env = process.env) {
  try {
    const { critical, low } = JSON.parse(fs.readFileSync(path.join(resolveAgentUsageState(env), "settings.json"), "utf8"));
    if (Number.isInteger(critical) && Number.isInteger(low) && critical >= 0 && critical < low && low < 100) {
      return { critical, low };
    }
  } catch {
    // The dashboard settings file is optional for independently installed plugins.
  }
  return defaultRouteThresholds;
}

export function parseRouteMode(value = "auto") {
  if (value !== "auto" && value !== "off") throw new Error("--route must be auto or off.");
  return value;
}

function bottleneck(pool) {
  const windows = ["5h", "7d"].map(name => ({ name, quota: pool?.[name] }));
  if (windows.some(({ quota }) => quota?.state !== "live"
    || !Number.isFinite(quota.effectiveRemainingPct)
    || quota.effectiveRemainingPct < 0 || quota.effectiveRemainingPct > 100)) return null;
  const [five, week] = windows;
  const limiting = five.quota.effectiveRemainingPct <= week.quota.effectiveRemainingPct ? five : week;
  return { window: limiting.name, remaining: limiting.quota.effectiveRemainingPct };
}

// Also shipped by the companion plugin for the other host. Keep the policy identical.
export function chooseRoute({ claude, agy }, {
  requested = "agy", agyPool = "gemini", critical = defaultRouteThresholds.critical, low = defaultRouteThresholds.low
} = {}) {
  const alternate = requested === "agy" ? "claude" : "agy";
  const quota = { claude: bottleneck(claude?.pools?.default), agy: bottleneck(agy?.pools?.[agyPool]) };
  const destination = quota[requested];
  const fallback = quota[alternate];
  if (!destination || !fallback) {
    return { target: requested, reason: "Both providers need fresh 5h and 7d quota to divert." };
  }
  if (destination.remaining > critical) {
    return { target: requested, reason: `${requested} quota is above the critical threshold.` };
  }
  if (fallback.remaining <= low) {
    return { target: requested, reason: `${alternate} does not have sufficient quota headroom.` };
  }
  const reason = `${requested} ${destination.window} quota is critical (${destination.remaining.toFixed(1).replace(/\.0$/, "")}% remaining).`;
  return { target: alternate, reason };
}
