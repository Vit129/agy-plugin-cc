const timestamp = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const accountKey = /^[A-Za-z0-9_-]{1,64}$/;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeClaudeFullResets(input = {}) {
  if (!isRecord(input)) return null;
  const entries = [];
  for (const [accountUuid, record] of Object.entries(input)) {
    if (!accountKey.test(accountUuid) || !isRecord(record) || Object.keys(record).length !== 2 ||
        typeof record.used !== 'boolean' || !Object.hasOwn(record, 'expiresAt')) return null;
    const { expiresAt, used } = record;
    if (expiresAt === null && !used) {
      entries.push([accountUuid, { expiresAt, used }]);
      continue;
    }
    const date = typeof expiresAt === 'string' ? timestamp.exec(expiresAt)?.[1] : undefined;
    const millis = date ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(millis) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) return null;
    entries.push([accountUuid, { expiresAt: new Date(millis).toISOString(), used }]);
  }
  return Object.fromEntries(entries);
}

export function claudeFullResetStatus(account, manual, now) {
  const cache = account.resetCache;
  if (cache?.accountUuid === account.accountUuid && typeof cache.holdsUnusedReset === 'boolean' &&
      Number.isFinite(cache.checkedAt) && cache.checkedAt <= now &&
      Number.isFinite(cache.validUntil) && now < cache.validUntil) {
    return cache.holdsUnusedReset ? 'available' : 'used';
  }
  return manual?.used ? 'used' : 'unknown';
}

export function claudeFullResetAccounts(profiles, saved, now) {
  const accounts = new Map();
  for (const profile of profiles) {
    const { accountUuid, login } = profile;
    if (!accountKey.test(accountUuid ?? '') || accounts.has(accountUuid)) continue;
    const manual = Object.hasOwn(saved, accountUuid) ? saved[accountUuid] : undefined;
    accounts.set(accountUuid, {
      accountUuid, login, expiresAt: manual?.expiresAt ?? null, used: manual?.used ?? false,
      status: claudeFullResetStatus(profile, manual, now),
    });
  }
  return accounts;
}

export function addClaudeFullReset(rows, accountForRow, accounts, now) {
  const displayed = new Set();
  return rows.map(row => {
    if (row.provider !== 'claude') return row;
    const account = accounts.get(accountForRow(row)?.accountUuid);
    if (!account?.expiresAt || displayed.has(account.accountUuid)) return row;
    displayed.add(account.accountUuid);
    const expiresAt = Date.parse(account.expiresAt) / 1000;
    const credit = {
      id: JSON.stringify([account.accountUuid, expiresAt]),
      provider: 'claude', label: 'Full reset', title: 'Full reset', expiresAt, status: account.status,
    };
    return { ...row, creditsObservedAt: now, rateLimitResetCredits: { credits: [credit] } };
  });
}
