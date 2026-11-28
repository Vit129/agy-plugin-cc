import { readProviderQuota } from '../../plugins/agy/scripts/lib/quota-state.mjs';
import { defaultRouteThresholds } from '../../plugins/agy/scripts/lib/quota-route.mjs';
import { readState } from './state.mjs';

const numericDefaults = { watch: 80, ...defaultRouteThresholds, cost: 5, target: 6, refreshMinutes: 4 };
const providerDefaults = Object.freeze({ claude: true, agy: true, copilot: true, codex: false });
export const defaultSettings = Object.freeze({ ...numericDefaults, providers: providerDefaults });
const severity = { unknown: -1, healthy: 0, watch: 1, low: 2, critical: 3 };
const cachedProviders = ['claude', 'agy'];
const providers = [
  { provider: 'claude', pool: 'default', label: 'Claude Code' },
  { provider: 'agy', pool: 'gemini', label: 'Antigravity · Gemini' },
  { provider: 'copilot', pool: 'premium', label: 'GitHub Copilot', windowKeys: ['monthly'] },
  { provider: 'codex', pool: 'default', label: 'OpenAI Codex' },
];

export function enabledProviders(settings) {
  return Object.keys(providerDefaults).filter(provider => (settings.providers?.[provider] ?? providerDefaults[provider]));
}

export function validSettings(candidate) {
  if (!Object.keys(numericDefaults).every(key => Number.isInteger(candidate?.[key]) && candidate[key] >= 0 && candidate[key] <= 100)) return false;
  const selected = candidate.providers;
  if (selected !== undefined && (!selected || Array.isArray(selected) ||
    Object.keys(selected).length !== Object.keys(providerDefaults).length ||
    !Object.keys(providerDefaults).every(provider => typeof selected[provider] === 'boolean'))) return false;
  const { watch, low, critical, cost, target, refreshMinutes } = candidate;
  return critical < low && low < watch && cost > 0 && target > 0 && refreshMinutes >= 1 && refreshMinutes <= 60;
}

export function loadSettings(directory) {
  const saved = { ...defaultSettings, ...readState(directory, 'settings.json', {}) };
  return validSettings(saved) ? saved : defaultSettings;
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
  const enabled = enabledProviders(settings);
  return providers.filter(description => enabled.includes(description.provider)).map(description => {
    const source = quota[description.provider];
    const pool = source?.pools?.[description.pool];
    const windows = (description.windowKeys ?? ['5h', '7d']).map(short => {
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
  const cached = enabledProviders(settings).filter(provider => cachedProviders.includes(provider));
  return buildQuotaRows(Object.fromEntries(cached.map(provider => [provider, readProviderQuota(provider, { ...options, statusLineOnly: true })])), settings);
}

export function planQuotaAlerts(rows, previous, { baseline = false, now = Date.now() } = {}) {
  const state = { ...previous };
  const alerts = [];
  for (const row of rows) {
    for (const window of row.windows) {
      const cycle = window.cycle ?? window.resetsAt;
      if (window.state !== 'live' || cycle == null || window.level === 'unknown') continue;
      const key = `${row.provider}:${row.pool}:${window.short}`;
      const prior = state[key];
      const rank = severity[window.level];
      const priorCycle = prior?.cycle ?? prior?.resetsAt;
      const ongoing = Number.isFinite(cycle) && Number.isFinite(priorCycle) && priorCycle * 1000 > now;
      if (priorCycle !== cycle && !ongoing) {
        state[key] = { cycle, observed: rank, notified: -1 };
        continue;
      }
      const crossed = !baseline && rank > prior.observed && rank > prior.notified;
      state[key] = { cycle, observed: rank, notified: crossed ? rank : prior.notified };
      if (crossed) alerts.push({ key, provider: row.label, ...window });
    }
  }
  return { state, alerts };
}
