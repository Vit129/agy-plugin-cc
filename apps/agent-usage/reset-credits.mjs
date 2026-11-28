const hour = 3_600_000;
const expiryClock = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const creditReminderPrefix = 'codex-reset-credit:';

export function availableResetCredits(summary, now) {
  return (summary?.credits ?? []).filter(credit => credit.status === 'available' &&
    (credit.expiresAt === null || credit.expiresAt * 1000 > now));
}

export function creditExpiryLabel(expiresAt, now) {
  if (expiresAt === null) return 'No expiry reported';
  const expires = expiresAt * 1000;
  const remaining = expires - now;
  const relative = remaining > 24 * hour ? `${Math.ceil(remaining / (24 * hour))}d`
    : remaining >= hour ? `${Math.ceil(remaining / hour)}h` : `${Math.max(1, Math.ceil(remaining / 60_000))}m`;
  return `expires ${expiryClock.format(expires)} (in ${relative})`;
}

export function creditStage(credit, now) {
  if (credit.status !== 'available' || !Number.isFinite(credit.expiresAt)) return null;
  const expiry = credit.expiresAt * 1000;
  if (now >= expiry || now < expiry - 24 * hour) return null;
  const hours = now >= expiry - 2 * hour ? 2 : 24;
  return { hours, startsAt: expiry - hours * hour };
}

export function planResetCreditAlerts(rows, previous, now) {
  const state = { ...previous };
  const alerts = [];
  for (const row of rows) {
    if (!Number.isFinite(row.creditsObservedAt)) continue;
    for (const credit of availableResetCredits(row.rateLimitResetCredits, now)) {
      const stage = creditStage(credit, now);
      if (!stage || row.creditsObservedAt < stage.startsAt) continue;
      const key = creditReminderPrefix + JSON.stringify([row.accountId ?? 'default', credit.id, stage.hours]);
      if (Object.hasOwn(state, key)) continue;
      state[key] = { notifiedAt: now };
      const label = row.accountId ? row.label : 'Codex';
      const title = credit.title || 'Rate limit reset';
      alerts.push({ key, message: `${label} reset credit "${title}" ${creditExpiryLabel(credit.expiresAt, now)} — not used yet.` });
    }
  }
  return { state, alerts };
}
