// Pure view-model for the dashboard: every quota rule (alerts, levels, route status, target, schedule) lives here.
// No DOM; the dashboard only renders what this returns. Text comes from ui/strings.mjs.
import { availableResetCredits, creditExpiryLabel } from './reset-credits.mjs';
import { format, levelLabels, routeNames, stateLabels, text } from './ui/strings.mjs';

const severity = { watch: 1, low: 2, critical: 3 };
const locale = 'en-GB';

export function routeStatus(decision, autoRoute) {
  if (autoRoute === false) return 'Off';
  return decision.target === decision.requested ? 'Allowed' : 'Diverted';
}

export function displayQuotaPercent(remaining) {
  return Math.floor(remaining);
}

function formatters(timeZone) {
  const options = { dateStyle: 'medium', timeStyle: 'short' };
  return {
    clock: new Intl.DateTimeFormat(locale, options),
    zoned: new Intl.DateTimeFormat(locale, { ...options, timeZone }),
    zoneName: new Intl.DateTimeFormat(locale, { timeZone, timeStyle: 'long' }),
  };
}

export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function zoneLabel(formatter, when) {
  return formatter.formatToParts(when).find(part => part.type === 'timeZoneName')?.value ?? '';
}

function windowModel(window, row, settings, clock) {
  const live = window.state === 'live';
  const level = live ? window.level : 'unknown';
  const label = live ? levelLabels[level] : stateLabels[window.state] || stateLabels.unknown;
  const hasReset = Number.isFinite(window.resetsAt) && window.resetsAt > 0;
  const prefix = window.state === 'reset_assumed' ? text.lastReportedReset : text.resets;
  return {
    short: window.short, level, label,
    amount: window.remaining === null ? '—' : `${displayQuotaPercent(window.remaining)}%`,
    meter: window.remaining === null ? null : {
      percent: window.remaining, value: displayQuotaPercent(window.remaining), label: format.meterLabel(row.label, window.short),
    },
    mobileName: window.short === 'monthly' ? text.monthly : window.short,
    resetText: hasReset ? format.resetAt(prefix, clock.format(window.resetsAt * 1000)) : text.resetUnavailable,
  };
}

function rowModel(row, settings, active, clock) {
  const alerts = [];
  const windows = row.windows.map(window => {
    if (window.state === 'live' && severity[window.level]) alerts.push({ ...window, provider: row.label });
    return windowModel(window, row, settings, clock);
  });
  const captured = Number.isFinite(row.capturedAt) ? format.updated(clock.format(row.capturedAt * 1000)) : text.waitingForSnapshot;
  return {
    alerts,
    row: {
      provider: row.provider, label: row.label, login: row.login ?? null, state: row.state ?? 'ready',
      active: active.has(row.provider), windows,
      status: row.state === 'error' ? { level: 'critical', text: format.rowError(row.error) } : { text: captured },
      capacity: {
        value: row.capacity ?? '—', note: format.target(settings.target),
        target: row.capacity === null ? 'unknown' : row.capacity >= settings.target ? 'met' : 'short',
      },
    },
  };
}

function creditRows(quota, now) {
  let showClaudeUsage = false;
  const rows = quota.flatMap(row => {
    const summary = row.rateLimitResetCredits;
    const available = availableResetCredits(summary, now).sort((first, second) =>
      (first.expiresAt ?? Infinity) - (second.expiresAt ?? Infinity));
    if (summary?.credits === null && summary.availableCount > 0) {
      return [{ kind: 'summary', label: row.label, text: format.creditsAvailable(summary.availableCount) }];
    }
    return available.map(credit => {
      if (credit.provider === 'claude') showClaudeUsage = true;
      return {
        kind: 'credit',
        account: row.accountId || credit.provider === 'claude' ? row.label : null,
        title: credit.title || text.defaultCreditTitle,
        expiry: creditExpiryLabel(credit.expiresAt, now).replace(/^expires /, 'Expires '),
        expiresAtIso: credit.expiresAt === null ? null : new Date(credit.expiresAt * 1000).toISOString(),
      };
    });
  });
  return { rows, showClaudeUsage };
}

function scheduleRows(schedule, checks, zones) {
  return (schedule?.times ?? []).map(time => {
    const result = checks[time];
    let status = text.scheduled;
    if (result?.checkedAt) status = result.windows.some(window => window.state === 'live') ? text.checkedFresh : text.checkedWaiting;
    if (result?.missedAt) status = text.missed;
    if (result?.skippedAt) status = text.skipped;
    return {
      iso: new Date(time).toISOString(),
      time: format.scheduleTime(zones.zoned.format(time), zoneLabel(zones.zoneName, time)),
      status,
    };
  });
}

export function quotaViewModel(data, { now = Date.now(), timeZone = localTimeZone() } = {}) {
  const { quota, schedule, checks = {}, routes, settings } = data;
  const active = new Set(data.active?.map(entry => entry.provider));
  const zones = formatters(timeZone);
  const built = quota.map(row => rowModel(row, settings, active, zones.clock));
  const alerts = built.flatMap(entry => entry.alerts).sort((first, second) => severity[second.level] - severity[first.level]);
  const anyLive = quota.some(row => row.windows.some(window => window.state === 'live'));
  const details = alerts.map(alert => format.alertLine(alert.provider, alert.short, displayQuotaPercent(alert.remaining), alert.level));
  if (data.notificationError) details.push(text.notificationFailed);
  const directions = Object.entries(routeNames).map(([key, label]) => {
    const decision = routes[key];
    return { label, status: decision.routeStatus ?? routeStatus(decision, settings.autoRoute), reason: decision.reason };
  });
  return {
    hasProviders: quota.length > 0,
    legend: ['watch', 'low', 'critical'].map(level => ({ level, text: format.legend(level, settings[level]) })),
    rows: built.map(entry => entry.row),
    routes: directions,
    noticeLevel: alerts[0]?.level ?? (anyLive ? 'healthy' : 'unknown'),
    alertTitle: quota.length === 0 ? text.noProviders
      : alerts.length ? format.alertTitle(alerts.length)
      : anyLive ? text.noActiveAlerts : text.waitingForQuota,
    alertDetails: details.join('  /  '),
    estimateNote: quota.length ? format.estimateNote(settings.cost, settings.refreshMinutes) : text.enableProvider,
    credits: creditRows(quota, now),
    schedule: scheduleRows(schedule, checks, zones),
  };
}

const settingsSections = { general: 'general', notifications: 'notifications', accounts: 'accounts', 'auto-route': 'route' };

// '#settings' -> { tab: null } (open on the first tab); '#settings/accounts' -> { tab: 'accounts' }; anything else -> null.
export function parseSettingsHash(hash) {
  const match = /^#settings(?:\/([a-z-]+))?$/.exec(hash ?? '');
  if (!match) return null;
  return { tab: match[1] === undefined ? null : settingsSections[match[1]] ?? null };
}
