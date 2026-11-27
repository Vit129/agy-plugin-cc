import { readAllQuota } from '../../plugins/agy/scripts/lib/quota-state.mjs';

export const defaultSettings = Object.freeze({ watch: 80, low: 60, critical: 30, cost: 5, target: 6 });
const severity = { unknown: -1, healthy: 0, watch: 1, low: 2, critical: 3 };
const providers = [
  { provider: 'claude', pool: 'default', label: 'Claude Code' },
  { provider: 'agy', pool: 'gemini', label: 'Antigravity · Gemini' },
];

export function validSettings(candidate) {
  if (!Object.keys(defaultSettings).every(key => Number.isInteger(candidate?.[key]) && candidate[key] >= 0 && candidate[key] <= 100)) return false;
  const { watch, low, critical, cost, target } = candidate;
  return critical < low && low < watch && cost > 0 && target > 0;
}

export function forecastResetChecks(anchorMs, count) {
  if (!Number.isFinite(anchorMs) || !Number.isInteger(count) || count < 1 || count > 6) throw new RangeError('Expected a reset timestamp and 1–6 rounds.');
  return Array.from({ length: count }, (_, index) => anchorMs + (index + 1) * 5 * 60 * 60 * 1000);
}

export function levelFor(remaining, settings) {
  if (!Number.isFinite(remaining)) return 'unknown';
  if (remaining <= settings.critical) return 'critical';
  if (remaining <= settings.low) return 'low';
  if (remaining <= settings.watch) return 'watch';
  return 'healthy';
}

export function estimateCapacity(windows, settings) {
  if (!windows.every(window => window.state === 'live' && window.remaining !== null)) return null;
  return Math.floor(Math.min(...windows.map(window => window.remaining)) / settings.cost);
}

export function buildQuotaRows(quota, settings) {
  return providers.map(description => {
    const source = quota[description.provider];
    const pool = source?.pools?.[description.pool];
    const windows = ['5h', '7d'].map(short => {
      const window = pool?.[short];
      const state = window?.state ?? 'unknown';
      const reported = window?.effectiveRemainingPct;
      const remaining = ['live', 'aging'].includes(state) && Number.isFinite(reported) && reported >= 0 && reported <= 100 ? reported : null;
      return { short, state, remaining, resetsAt: window?.resetsAt ?? null, level: levelFor(remaining, settings) };
    });
    return { ...description, windows, capturedAt: source?.capturedAt ?? null, capacity: estimateCapacity(windows, settings) };
  });
}

export function readQuota(settings, options = {}) {
  return buildQuotaRows(readAllQuota(options), settings);
}

export function planQuotaAlerts(rows, previous, { baseline = false } = {}) {
  const state = { ...previous };
  const alerts = [];
  for (const row of rows) {
    for (const window of row.windows) {
      if (window.state !== 'live' || !Number.isFinite(window.resetsAt) || window.level === 'unknown') continue;
      const key = `${row.provider}:${row.pool}:${window.short}`;
      const prior = state[key];
      const rank = severity[window.level];
      if (prior?.resetsAt !== window.resetsAt) {
        state[key] = { resetsAt: window.resetsAt, observed: rank, notified: -1 };
        continue;
      }
      const crossed = !baseline && rank > prior.observed && rank > prior.notified;
      state[key] = { resetsAt: window.resetsAt, observed: rank, notified: crossed ? rank : prior.notified };
      if (crossed) alerts.push({ key, provider: row.label, ...window });
    }
  }
  return { state, alerts };
}
