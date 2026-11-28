import { readProviderQuota } from '../../plugins/agy/scripts/lib/quota-state.mjs';
import { defaultRouteThresholds } from '../../plugins/agy/scripts/lib/quota-route.mjs';
import { readState } from './state.mjs';
import { accountsForProvider, normalizeAccounts } from './accounts.mjs';
import { normalizeClaudeFullResets } from './claude-reset-credit.mjs';

const numericDefaults = { watch: 80, ...defaultRouteThresholds, cost: 5, target: 6, refreshMinutes: 4 };
const providerDefaults = Object.freeze({ claude: true, agy: true, copilot: true, codex: false });
const titleProviderDefaults = Object.freeze({ claude: true, agy: true, copilot: true, codex: true });
const toggleDefaults = { thresholdWarnings: true, paceWarnings: false, resetCreditReminders: true, notificationSound: false, autoRoute: true };
export const defaultSettings = Object.freeze({
  ...numericDefaults, ...toggleDefaults, providers: providerDefaults, titleProviders: titleProviderDefaults,
  accounts: Object.freeze({}), claudeFullReset: Object.freeze({}),
});
const severity = { unknown: -1, healthy: 0, watch: 1, low: 2, critical: 3 };
const cachedProviders = ['claude', 'agy'];
const providers = [
  { provider: 'claude', pool: 'default', label: 'Claude Code' },
  { provider: 'agy', pool: 'gemini', label: 'Antigravity · Gemini' },
  { provider: 'copilot', pool: 'premium', label: 'GitHub Copilot', windowKeys: ['monthly'] },
  { provider: 'codex', pool: 'default', label: 'OpenAI Codex' },
];

export function providerLabel(provider, account) {
  const label = providers.find(description => description.provider === provider).label;
  return account ? `${label} · ${account.label}` : label;
}

export function enabledProviders(settings) {
  return Object.keys(providerDefaults).filter(provider => (settings.providers?.[provider] ?? providerDefaults[provider]));
}

export function validSettings(candidate) {
  if (!Object.keys(numericDefaults).every(key => Number.isInteger(candidate?.[key]) && candidate[key] >= 0 && candidate[key] <= 100)) return false;
  if (!Object.keys(toggleDefaults).every(key => !Object.hasOwn(candidate, key) || typeof candidate[key] === 'boolean')) return false;
  for (const selected of [candidate.providers, candidate.titleProviders]) {
    const providerKeys = Object.keys(providerDefaults);
    if (selected !== undefined && (!selected || Array.isArray(selected) ||
      Object.keys(selected).length !== providerKeys.length ||
      !providerKeys.every(provider => typeof selected[provider] === 'boolean'))) return false;
  }
  if (normalizeAccounts(candidate.accounts) === null) return false;
  const { watch, low, critical, cost, target, refreshMinutes } = candidate;
  return critical < low && low < watch && cost > 0 && target > 0 && refreshMinutes >= 1 && refreshMinutes <= 60;
}

export function loadSettings(directory) {
  const saved = { ...defaultSettings, ...readState(directory, 'settings.json', {}) };
  return validSettings(saved) ? {
    ...saved, accounts: normalizeAccounts(saved.accounts),
    claudeFullReset: normalizeClaudeFullResets(saved.claudeFullReset) ?? defaultSettings.claudeFullReset,
  } : defaultSettings;
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

export function buildQuotaRows(quota, settings, { includeRouteFallback = false } = {}) {
  const enabled = enabledProviders(settings);
  return providers.filter(description => enabled.includes(description.provider)).flatMap(description => {
    const accounts = [...accountsForProvider(settings, description.provider)];
    if (includeRouteFallback && !accounts.includes(null) && cachedProviders.includes(description.provider)) accounts.push(null);
    return accounts.map(account => {
      const source = account ? null : quota[description.provider];
      const pool = source?.pools?.[description.pool];
      const windows = (description.windowKeys ?? ['5h', '7d']).map(short => {
        const window = pool?.[short];
        const state = window?.state ?? 'unknown';
        const reported = window?.effectiveRemainingPct;
        const remaining = ['live', 'aging'].includes(state) && Number.isFinite(reported) && reported >= 0 && reported <= 100 ? reported : null;
        return { short, state, remaining, resetsAt: window?.resetsAt ?? null, level: levelFor(remaining, settings) };
      });
      const identity = account ? { accountId: account.id, label: providerLabel(description.provider, account) } : {};
      return { ...description, ...identity, windows, capturedAt: source?.capturedAt ?? null, capacity: estimateCapacity(windows, settings) };
    });
  });
}

export function readQuota(settings, options = {}) {
  const cached = enabledProviders(settings).filter(provider => cachedProviders.includes(provider));
  const quota = Object.fromEntries(cached.map(provider => [provider, readProviderQuota(provider, { ...options, statusLineOnly: true })]));
  return buildQuotaRows(quota, settings, options);
}

function behindPace(window, now) {
  if (!Number.isFinite(window.resetsAt) || !Number.isFinite(window.remaining)) return false;
  const end = window.resetsAt * 1000;
  let duration = { '5h': 18_000_000, '7d': 604_800_000 }[window.short];
  if (window.short === 'monthly') {
    const start = new Date(end);
    const day = start.getDate();
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    start.setDate(Math.min(day, lastDay));
    duration = end - start;
  }
  const timeLeft = end - now;
  return timeLeft > 0 && timeLeft < duration && window.remaining / 100 < timeLeft / duration - 1e-10;
}

export function planQuotaAlerts(rows, previous, {
  baseline = false, now = Date.now(), thresholdWarnings = true, paceWarnings = false,
} = {}) {
  const state = { ...previous };
  const alerts = [];
  function observe(key, cycle, rank, enabled, alert) {
    const prior = state[key];
    const priorCycle = prior?.cycle ?? prior?.resetsAt;
    const ongoing = Number.isFinite(cycle) && Number.isFinite(priorCycle) && priorCycle * 1000 > now;
    if (priorCycle !== cycle && !ongoing) {
      state[key] = { cycle, observed: rank, notified: -1 };
      return;
    }
    const crossed = enabled && !baseline && rank > prior.observed && rank > prior.notified;
    state[key] = { cycle, observed: rank, notified: crossed ? rank : prior.notified };
    if (crossed) alerts.push({ key, ...alert });
  }

  for (const row of rows) {
    for (const window of row.windows) {
      const cycle = window.cycle ?? window.resetsAt;
      if (window.state !== 'live' || cycle == null || window.level === 'unknown') continue;
      const scope = row.accountId ? `${row.provider}:${row.accountId}` : row.provider;
      const key = `${scope}:${row.pool}:${window.short}`;
      const alert = { provider: row.label, ...window };
      observe(key, cycle, severity[window.level], thresholdWarnings, alert);
      if (paceWarnings) {
        const message = `${row.label} ${window.short}: ${Math.floor(window.remaining)}% remaining · quota is running out ahead of reset.`;
        observe(`${key}:pace`, cycle, Number(behindPace(window, now)), true, { ...alert, message });
      }
    }
  }
  return { state, alerts };
}
