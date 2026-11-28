// Pure scenario data for the dashboard: no DOM, no assertions. Shared by view-model tests and Playwright specs.
export const NOW = Date.UTC(2026, 10, 28, 5, 0, 0); // 2026-11-28 12:00 in Bangkok, 05:00 in London
const sec = ms => Math.floor(ms / 1000);
const hour = 3_600_000;

export const settings = {
  watch: 80, low: 25, critical: 10, cost: 5, target: 6, refreshMinutes: 4,
  thresholdWarnings: true, paceWarnings: false, resetCreditReminders: true, notificationSound: false, autoRoute: true,
  providers: { claude: true, agy: true, copilot: true, codex: false },
  titleProviders: { claude: true, agy: true, copilot: true, codex: true },
  accounts: {},
};

const live = (short, remaining, level, resetsIn) => ({ short, state: 'live', remaining, level, resetsAt: sec(NOW + resetsIn) });

export const quotaRows = [
  {
    provider: 'claude', pool: 'default', label: 'Claude Code', login: 'dev@example.com', plan: 'Max', state: 'ready',
    windows: [live('5h', 72.4, 'watch', 2 * hour), live('7d', 91, 'healthy', 60 * hour)],
    capturedAt: sec(NOW - 60_000), capacity: 14,
    rateLimitResetCredits: { availableCount: 1, credits: [{ provider: 'claude', title: 'Full reset', status: 'available', expiresAt: sec(NOW + 30 * hour) }] },
  },
  {
    provider: 'agy', pool: 'gemini', label: 'Antigravity · Gemini', state: 'ready',
    windows: [live('5h', 8, 'critical', hour), { short: '7d', state: 'aging', remaining: 40, level: 'healthy', resetsAt: sec(NOW + 90 * hour) }],
    capturedAt: sec(NOW - 120_000), capacity: 1,
  },
  {
    provider: 'copilot', pool: 'premium', label: 'GitHub Copilot', state: 'ready',
    windows: [live('monthly', 55, 'healthy', 400 * hour)],
    capturedAt: sec(NOW - 30_000), capacity: 11,
  },
];

export const routes = {
  claudeToAgy: { requested: 'agy', target: 'claude', reason: 'agy 5h quota is critical (8% remaining).' },
  agyToClaude: { requested: 'claude', target: 'claude', reason: 'claude quota is above the critical threshold.' },
};

export const schedule = { times: [NOW - 5 * hour, NOW + 5 * hour, NOW + 10 * hour, NOW + 15 * hour] };
export const checks = {
  [NOW - 5 * hour]: { checkedAt: NOW - 5 * hour, windows: [{ provider: 'claude', state: 'live', resetsAt: sec(NOW) }] },
};

export const accounts = {
  claude: [{ id: 'cli', login: 'dev@example.com', kind: 'current' }],
  agy: [], copilot: [], codex: [],
};

export function quotaResponse(overrides = {}) {
  return {
    quota: quotaRows, accounts, claudeFullResetAccounts: [], active: [{ provider: 'claude' }],
    settings, schedule, checks, notificationError: null, routes, ...overrides,
  };
}

export const emptyQuotaResponse = quotaResponse({ quota: [], active: [], schedule: null, checks: {} });
export const claudeCreditPromptResponse = quotaResponse({
  claudeFullResetAccounts: [{ accountUuid: 'abc', login: 'dev@example.com', expiresAt: null, used: false, status: 'unknown' }],
});

export const models = [
  { provider: 'claude', model: 'claude-opus', calls: 120, okPct: 99, tokens: 1_500_000, avgMs: 2400 },
  { provider: 'agy', model: 'gemini-pro', calls: 40, okPct: 95, tokens: 420_000, avgMs: 800 },
];
