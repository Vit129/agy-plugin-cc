import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSettingsHash, quotaViewModel, routeStatus } from '../apps/agent-usage/view-model.mjs';
import { NOW, checks, emptyQuotaResponse, quotaResponse, quotaRows, routes, schedule, settings } from './fixtures/agent-usage/quotaData.mjs';

const view = (data = quotaResponse(), timeZone = 'UTC') => quotaViewModel(data, { now: NOW, timeZone });
const rowWith = (override, index = 0) => quotaRows.map((row, at) => at === index ? { ...row, ...override } : row);

test('[TC-AGU-58][BE-BL][Success] collects live alerts, sorts by severity and titles the notice', () => {
  const model = view();
  assert.equal(model.alertTitle, '2 quota alerts');
  assert.equal(model.noticeLevel, 'critical');
  assert.equal(model.alertDetails, 'Antigravity · Gemini 5h · 8% critical  /  Claude Code 5h · 72% watch');
  const healthy = { ...quotaRows[0], windows: [{ ...quotaRows[0].windows[0], remaining: 90, level: 'healthy' }, quotaRows[0].windows[1]] };
  const calm = view(quotaResponse({ quota: [healthy] }));
  assert.deepEqual([calm.alertTitle, calm.noticeLevel], ['No active quota alerts', 'healthy']);
});

test('[TC-AGU-59][BE-UT][Edge] titles the notice when no provider is enabled or quota is not live', () => {
  assert.equal(view(emptyQuotaResponse).alertTitle, 'No providers enabled');
  assert.equal(view(emptyQuotaResponse).hasProviders, false);
  const stale = { ...quotaRows[0], windows: quotaRows[0].windows.map(window => ({ ...window, state: 'unknown', remaining: null, level: 'unknown' })) };
  const model = view(quotaResponse({ quota: [stale] }));
  assert.equal(model.alertTitle, 'Waiting for fresh quota');
  assert.equal(model.noticeLevel, 'unknown');
});

test('[TC-AGU-60][BE-BL][Edge] labels each window state and keeps unavailable values explicit', () => {
  const [fiveHour, sevenDay] = view().rows[1].windows;
  assert.deepEqual([fiveHour.amount, fiveHour.label, fiveHour.level], ['8%', 'Critical', 'critical']);
  assert.deepEqual([sevenDay.label, sevenDay.level], ['Stale', 'unknown']);
  const assumed = { short: '5h', state: 'reset_assumed', remaining: null, level: 'unknown', resetsAt: 1_800_000_000 };
  const odd = view(quotaResponse({ quota: [{ ...quotaRows[0], windows: [assumed, { short: '7d', state: 'unknown', remaining: null, level: 'unknown', resetsAt: null }] }] })).rows[0].windows;
  assert.equal(odd[0].label, 'Awaiting fresh quota');
  assert.match(odd[0].resetText, /^Last reported reset /);
  assert.equal(odd[0].amount, '—');
  assert.equal(odd[0].meter, null);
  assert.equal(odd[1].resetText, 'Reset time unavailable');
  assert.equal(view().rows[2].windows[0].mobileName, 'Monthly');
  assert.equal(view().rows[0].windows[0].meter.label, 'Claude Code, 5-hour window remaining');
});

test('[TC-AGU-61][BE-BL][Success] compares capacity with the session target', () => {
  assert.deepEqual(view().rows.map(row => row.capacity.target), ['met', 'short', 'met']);
  assert.equal(view(quotaResponse({ quota: rowWith({ capacity: null }) })).rows[0].capacity.target, 'unknown');
  assert.equal(view(quotaResponse({ quota: rowWith({ capacity: null }) })).rows[0].capacity.value, '—');
});

test('[TC-AGU-62][BE-UT][Success] derives the route status and prefers the status the server sent', () => {
  assert.equal(routeStatus(routes.claudeToAgy, true), 'Diverted');
  assert.equal(routeStatus(routes.agyToClaude, true), 'Allowed');
  assert.equal(routeStatus(routes.claudeToAgy, false), 'Off');
  assert.deepEqual(view().routes.map(route => route.status), ['Diverted', 'Allowed']);
  assert.deepEqual(view(quotaResponse({ settings: { ...settings, autoRoute: false } })).routes.map(route => route.status), ['Off', 'Off']);
  const sent = { ...routes, agyToClaude: { ...routes.agyToClaude, routeStatus: 'Off' } };
  assert.equal(view(quotaResponse({ routes: sent })).routes[1].status, 'Off');
});

test('[TC-AGU-63][BE-UT][Edge] shows scheduled checks in the viewer time zone, not Bangkok (F2 regression)', () => {
  const bangkok = view(quotaResponse(), 'Asia/Bangkok').schedule[1];
  const london = view(quotaResponse(), 'Europe/London').schedule[1];
  assert.equal(bangkok.time, '28 Nov 2026, 17:00 GMT+7');
  assert.equal(london.time, '28 Nov 2026, 10:00 GMT');
  assert.equal(bangkok.iso, london.iso);
  assert.ok(!JSON.stringify(view(quotaResponse(), 'Europe/London').schedule).includes('ICT'));
  assert.match(quotaViewModel(quotaResponse(), { now: NOW }).schedule[1].time, /\d\d:\d\d \S+$/, 'defaults to the runtime time zone');
});

test('[TC-AGU-64][BE-BL][Success] reports each scheduled check as checked, missed, skipped or scheduled', () => {
  const [first, second, third, fourth] = schedule.times;
  const model = view(quotaResponse({ checks: {
    [first]: { checkedAt: first, windows: [{ state: 'reset_assumed' }] },
    [second]: { missedAt: second }, [third]: { skippedAt: third },
  } })).schedule;
  assert.deepEqual(model.map(row => row.status), ['Checked · waiting for fresh quota', 'Missed', 'Skipped · no providers enabled', 'Scheduled']);
  assert.equal(view(quotaResponse({ schedule: null, checks })).schedule.length, 0);
  assert.equal(fourth, schedule.times[3]);
});

test('[TC-AGU-65][BE-BL][Success] lists available reset credits by expiry and flags the Claude usage link', () => {
  const credits = view().credits;
  assert.equal(credits.showClaudeUsage, true);
  assert.deepEqual(credits.rows.map(row => [row.kind, row.account, row.title]), [['credit', 'Claude Code', 'Full reset']]);
  const summaryOnly = { ...quotaRows[2], rateLimitResetCredits: { availableCount: 2, credits: null } };
  const none = view(quotaResponse({ quota: [summaryOnly] })).credits;
  assert.deepEqual(none.rows, [{ kind: 'summary', label: 'GitHub Copilot', text: '2 available · expiry details unavailable' }]);
  assert.equal(none.showClaudeUsage, false);
  assert.deepEqual(view(quotaResponse({ quota: [quotaRows[2]] })).credits.rows, []);
});

test('[TC-AGU-66][BE-UT][Edge] appends the notification failure and the estimate note', () => {
  assert.match(view(quotaResponse({ notificationError: 'boom' })).alertDetails, /macOS notification delivery failed\. See the local server log\.$/);
  assert.equal(view().estimateNote, 'Estimates assume 5% of quota per session. Enabled providers refresh every 4 min.');
  assert.equal(view(emptyQuotaResponse).estimateNote, 'Enable a provider in Settings to show its quota.');
  assert.deepEqual(view().legend.map(entry => entry.text), ['Watch ≤80%', 'Low ≤25%', 'Critical ≤10%']);
});

test('[TC-AGU-67][BE-UT][Success] parses the settings deep link into a tab', () => {
  assert.deepEqual(parseSettingsHash('#settings'), { tab: null });
  assert.deepEqual(parseSettingsHash('#settings/notifications'), { tab: 'notifications' });
  assert.deepEqual(parseSettingsHash('#settings/general'), { tab: 'general' });
  assert.deepEqual(parseSettingsHash('#settings/accounts'), { tab: 'accounts' });
  assert.deepEqual(parseSettingsHash('#settings/auto-route'), { tab: 'route' });
  assert.deepEqual(parseSettingsHash('#settings/bogus'), { tab: null });
  for (const hash of ['', '#other', '#settingsx', '#settings/', undefined]) assert.equal(parseSettingsHash(hash), null, String(hash));
});
