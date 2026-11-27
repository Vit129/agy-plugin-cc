import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQuotaRows, forecastResetChecks, planQuotaAlerts, levelFor, defaultSettings } from '../apps/agent-usage/quota.mjs';
import { aggregateCalls, normalizeAgyCall, normalizeClaudeCall } from '../apps/agent-usage/usage.mjs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../apps/agent-usage/server.mjs';
import { createLiveQuotaReader, parseCodexBarQuota } from '../apps/agent-usage/live-quota.mjs';

const resetAt = 1795791300;
const live = remaining => ({ state: 'live', resetsAt: resetAt, effectiveRemainingPct: remaining });
const sample = (five, week) => buildQuotaRows({
  claude: { pools: { default: { '5h': five, '7d': week } } },
}, defaultSettings);

test('[TC-AGU-01][BE-UT] forecasts the next six five-hour checks across midnight', () => {
  const anchor = Date.parse('2026-11-27T20:55:00+07:00');
  const actual = forecastResetChecks(anchor, 6).map(value => new Date(value).toISOString());
  assert.deepEqual(actual, [1, 2, 3, 4, 5, 6].map(n => new Date(anchor + n * 18_000_000).toISOString()));
  assert.equal(actual[0], '2026-11-27T18:55:00.000Z');
});

test('[TC-AGU-02][BE-BL] labels inclusive quota thresholds and bases capacity on the tighter fresh window', () => {
  assert.deepEqual([81, 80, 61, 60, 31, 30, null].map(value => levelFor(value, defaultSettings)), ['healthy', 'watch', 'watch', 'low', 'low', 'critical', 'unknown']);
  assert.equal(sample(live(72), live(26))[0].capacity, 5);
  assert.equal(sample(live(72), { ...live(26), state: 'aging' })[0].capacity, null);
});

test('[TC-AGU-03][BE-BL] sends one alert for the highest crossed level per confirmed window cycle', () => {
  const baseline = planQuotaAlerts(sample(live(90), live(90)), {});
  assert.equal(baseline.alerts.length, 0);
  const crossing = planQuotaAlerts(sample(live(30), live(60)), baseline.state);
  assert.deepEqual(crossing.alerts.map(alert => alert.level), ['critical', 'low']);
  const duplicate = planQuotaAlerts(sample(live(29), live(59)), crossing.state);
  assert.equal(duplicate.alerts.length, 0);
  const stale = planQuotaAlerts(sample(live(28), { ...live(30), state: 'aging' }), duplicate.state);
  assert.equal(stale.alerts.length, 0);
  const newCycle = planQuotaAlerts(sample({ ...live(95), resetsAt: resetAt + 18_000 }, live(59)), stale.state);
  assert.equal(planQuotaAlerts(sample({ ...live(79), resetsAt: resetAt + 18_000 }, live(59)), newCycle.state).alerts[0].level, 'watch');
});

test('[TC-AGU-04][BE-BL] counts transcript calls once, filters time windows and keeps unavailable timing unknown', () => {
  const now = Date.parse('2026-11-27T21:00:00+07:00');
  const claude = normalizeClaudeCall({ type: 'assistant', timestamp: new Date(now).toISOString(), requestId: 'test', message: { model: 'claude-test', id: 'msg-test', usage: { input_tokens: 3, cache_read_input_tokens: 10, output_tokens: 2 } } });
  const agy = normalizeAgyCall({ type: 'PLANNER_RESPONSE', created_at: new Date(now - 15 * 86_400_000).toISOString(), status: 'DONE', step_index: 10, model: 'gemini-test', input_tokens: 9, output_tokens: 1 }, 'conversation-test');
  assert.equal(aggregateCalls([claude, claude, agy], 7, now)[0].tokens, 15);
  const monthly = aggregateCalls([claude, claude, agy], 30, now);
  assert.equal(monthly.length, 2);
  assert.equal(monthly[0].calls, 1);
  assert.equal(monthly[0].avgMs, null);
});

test('[TC-AGU-05][BE-IT] serves local quota, persists notification state and records a due reset check without a browser', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-test-'));
  const directory = path.join(root, 'state');
  const quotaDirectory = path.join(root, 'quota');
  await mkdir(quotaDirectory);
  await mkdir(directory);
  const time = Date.parse('2026-11-28T01:55:00+07:00');
  const expires = time / 1000 + 18_000;
  const fixture = remaining => writeFile(path.join(quotaDirectory, 'claude.json'), JSON.stringify({
    captured_at: time / 1000,
    pools: { default: { '5h': { remaining_pct: remaining, resets_at: expires }, '7d': { remaining_pct: 84, resets_at: expires + 86_400 } } },
  }));
  const options = {
    port: 0,
    env: { AGENT_USAGE_STATE_DIR: directory, AI_QUOTA_DIR: quotaDirectory },
    now: () => time,
    probeQuota: async () => null,
  };
  const events = [];
  options.notify = async alert => { events.push(alert); };
  let server;
  const close = () => new Promise(resolve => {
    if (!server) { resolve(); return; }
    server.close(resolve);
    server.closeAllConnections?.();
  });
  try {
    await fixture(95);
    await writeFile(path.join(directory, 'schedule.json'), JSON.stringify({ anchor: time - 18_000_000, times: [time] }));
    server = await startServer(options);
    const base = () => `http://127.0.0.1:${server.address().port}`;
    const quota = () => fetch(`${base()}/api/quota`).then(response => response.json());
    assert.equal((await quota()).checks[time].checkedAt, time);
    await fixture(28);
    assert.equal((await quota()).quota[0].windows[0].level, 'critical');
    assert.equal(events.length, 1);
    assert.equal(events[0].short, '5h');
    assert.equal((await fetch(`${base()}/health`, { headers: { Origin: 'https://example.invalid' } })).status, 403);
    await close();
    server = await startServer(options);
    await quota();
    assert.equal(events.length, 1);
    const settings = await fetch(`${base()}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultSettings, target: 9 }),
    });
    assert.equal((await settings.json()).settings.target, 9);
    assert.equal(events.length, 1);
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
});

test('[TC-AGU-06][BE-UT] maps exact live Claude and Gemini windows without treating an unmeasured limit as available', () => {
  const now = Date.parse('2026-11-27T21:00:00+07:00');
  const updatedAt = new Date(now).toISOString();
  const resetsAt = new Date(now + 60_000).toISOString();
  const gemini = parseCodexBarQuota([{ provider: 'antigravity', source: 'cli', usage: { updatedAt,
    primary: { usedPercent: 51, windowMinutes: 10080, resetsAt },
    secondary: { usedPercent: 100, windowMinutes: 300, resetsAt },
    extraRateWindows: [
      { id: 'antigravity-quota-summary-gemini-5h', window: { usedPercent: 0, windowMinutes: 300, resetsAt } },
      { id: 'antigravity-quota-summary-gemini-weekly', window: { usedPercent: 51, windowMinutes: 10080, resetsAt } },
      { id: 'antigravity-quota-summary-3p-5h', window: { usedPercent: 100, windowMinutes: 300, resetsAt } },
    ],
  } }], 'agy', now);
  assert.equal(gemini.windows['5h'].remaining, 100);
  assert.equal(gemini.windows['7d'].remaining, 49);
  const claude = parseCodexBarQuota([{ provider: 'claude', source: 'claude', usage: { updatedAt,
    primary: { usedPercent: 0, windowMinutes: 300, resetsAt }, secondary: { usedPercent: 100, windowMinutes: 10080, usageKnown: false, resetsAt },
  } }], 'claude', now);
  assert.equal(claude.windows['5h'].remaining, 100);
  assert.equal(claude.windows['7d'], null);
});

test('[TC-AGU-07][BE-IT] fills missing quota from a throttled CLI probe and marks expired windows unavailable', async () => {
  let now = Date.parse('2026-11-27T21:00:00+07:00');
  let calls = 0;
  const read = createLiveQuotaReader({ now: () => now, env: { AI_QUOTA_DIR: '/path-that-does-not-exist-for-agent-usage-test' }, probe: async () => {
    calls++;
    const resetsAt = new Date(now + 240_000).toISOString();
    return { provider: 'claude', source: 'claude', usage: { updatedAt: new Date(now).toISOString(),
      primary: { usedPercent: 20, windowMinutes: 300, resetsAt }, secondary: { usedPercent: 50, windowMinutes: 10080, resetsAt },
    } };
  } });
  const initial = await read(defaultSettings);
  assert.equal(initial[0].windows[0].remaining, 80);
  assert.equal(initial[0].windows[1].source, 'codexbar');
  assert.equal(initial[0].capacity, 10);
  assert.equal(initial[1].capacity, null);
  assert.equal(calls, 2);
  now += 15_000;
  await read(defaultSettings);
  assert.equal(calls, 2);
  const expired = parseCodexBarQuota({ provider: 'claude', source: 'claude', usage: { primary: { usedPercent: 20, windowMinutes: 300, resetsAt: '2026-11-27T00:00:00Z' } } }, 'claude', now);
  assert.equal(expired, null);
});
