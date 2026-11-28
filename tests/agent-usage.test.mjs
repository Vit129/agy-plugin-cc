import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildQuotaRows, forecastResetChecks, planQuotaAlerts, levelFor, defaultSettings } from '../apps/agent-usage/quota.mjs';
import { aggregateCalls, normalizeAgyCall, normalizeClaudeCall, normalizeCopilotCall, readModelCalls } from '../apps/agent-usage/usage.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../apps/agent-usage/server.mjs';
import { createLiveQuotaReader } from '../apps/agent-usage/live-quota.mjs';
import { parseAgyQuota, parseCodexQuota, parseCopilotQuota } from '../apps/agent-usage/provider-quota.mjs';

const resetAt = 1795791300;
const live = remaining => ({ state: 'live', resetsAt: resetAt, effectiveRemainingPct: remaining });
const sample = (five, week) => buildQuotaRows({
  claude: { pools: { default: { '5h': five, '7d': week } } },
}, defaultSettings);

test('[TC-AGU-12][BE-IT] checks the persisted switch before terminal startup for each provider', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-startup-'));
  const cli = fileURLToPath(new URL('../apps/agent-usage/cli.mjs', import.meta.url));
  const run = promisify(execFile);
  const providers = { claude: false, agy: false, copilot: false, codex: false };
  let checks = 0;
  const health = createServer((request, response) => {
    if (request.url === '/health') checks++;
    response.end(JSON.stringify({ service: 'agent-usage' }));
  });
  try {
    await new Promise(resolve => health.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, AGENT_USAGE_STATE_DIR: directory, AGENT_USAGE_PORT: String(health.address().port) };
    const save = selected => writeFile(path.join(directory, 'settings.json'), JSON.stringify({ ...defaultSettings, providers: selected }));
    const startup = provider => run(process.execPath, [cli, 'on-provider-start', provider], { env });
    await save(providers);
    for (const provider of Object.keys(providers)) {
      const { stdout } = await startup(provider);
      assert.equal(stdout, '');
    }
    assert.equal(checks, 0);
    for (const [index, provider] of Object.keys(providers).entries()) {
      await save({ ...providers, [provider]: true });
      await startup(provider);
      assert.equal(checks, index + 1);
    }
    await assert.rejects(startup('unrecognized'), /Unknown provider/);
    await save(providers);
    await run(process.execPath, [cli, 'ensure-running', '--quiet'], { env });
    assert.equal(checks, 5);
  } finally {
    await new Promise(resolve => health.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

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
    assert.equal(events.length, 2);
    assert.match(events[0].message, /Scheduled quota check/);
    assert.equal(events[1].short, '5h');
    assert.equal((await fetch(`${base()}/health`, { headers: { Origin: 'https://example.invalid' } })).status, 403);
    await close();
    server = await startServer(options);
    await quota();
    assert.equal(events.length, 2);
    const settings = await fetch(`${base()}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultSettings, target: 9 }),
    });
    assert.equal((await settings.json()).settings.target, 9);
    assert.equal(events.length, 2);
    const notify = await fetch(`${base()}/api/notifications/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    assert.deepEqual(await notify.json(), { sent: true });
    assert.match(events[2].message, /Test notification/);
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
});

test('[TC-AGU-06][BE-UT] selects native Gemini windows and leaves Copilot reset unknown when the CLI reports observation time', () => {
  const now = Date.parse('2026-11-27T21:00:00+07:00');
  const reset = new Date(now + 60_000).toISOString();
  const report = { status: 'SUCCESS', command: { name: 'usage', data: { groups: [{ buckets: [
    { id: 'gemini-5h', remaining_fraction: 0.8, reset_time: reset },
    { id: 'gemini-weekly', remaining_fraction: 0.49, reset_time: reset },
    { id: '3p-5h', remaining_fraction: 1 },
  ] }] } } };
  assert.equal(parseAgyQuota(report, now).windows['5h'].remaining, 80);
  assert.equal(parseAgyQuota(report, now).windows['7d'].remaining, 49);
  const copilot = parseCopilotQuota({ quotaSnapshots: { premium_interactions: { remainingPercentage: 21.2, resetDate: new Date(now).toISOString() } } }, now);
  assert.equal(copilot.windows.monthly.remaining, 21.2);
  assert.equal(copilot.windows.monthly.resetsAt, null);
  assert.equal(copilot.windows.monthly.cycle, '2026-11');
});

test('[TC-AGU-07][BE-IT] uses one configurable refresh interval for all providers and preserves the latest measured data', async () => {
  let now = Date.parse('2026-11-27T21:00:00+07:00');
  const attempts = [];
  const read = createLiveQuotaReader({ now: () => now, env: { AI_QUOTA_DIR: '/path-that-does-not-exist-for-agent-usage-test' }, probe: async provider => {
    attempts.push(provider);
    const resetsAt = (now + 600_000) / 1000;
    const windows = provider === 'copilot' ? { monthly: { remaining: 21, resetsAt: null } } : { '5h': { remaining: 80, resetsAt }, '7d': { remaining: 50, resetsAt } };
    return { captured: now, windows };
  } });
  const initial = await read(defaultSettings);
  assert.equal(initial[0].windows[0].remaining, 80);
  assert.equal(initial[0].windows[1].source, 'claude-cli');
  assert.equal(initial[2].windows[0].remaining, 21);
  assert.equal(initial[0].capacity, 10);
  assert.deepEqual(attempts, ['claude', 'agy', 'copilot']);
  now += 90_000;
  await read(defaultSettings);
  assert.equal(attempts.length, 3);
  await read({ ...defaultSettings, refreshMinutes: 1 });
  assert.deepEqual(attempts.slice(3), ['claude', 'agy', 'copilot']);
});

test('[TC-AGU-08][BE-UT] includes Copilot transcript model calls and recorded duration', () => {
  const now = Date.parse('2026-11-27T21:00:00+07:00');
  const record = { type: 'session.usage_record', timestamp: new Date(now).toISOString(), id: 'copilot-test', data: { usage: {
    model: 'claude-haiku-5.5', inputTokens: 10, outputTokens: 3, cacheReadTokens: 8, duration: 1200,
  } } };
  const models = aggregateCalls([normalizeCopilotCall(record)], 7, now);
  assert.deepEqual(models[0], { provider: 'copilot', model: 'claude-haiku-5.5', calls: 1, tokens: 13, okPct: null, avgMs: 1200 });
});

test('[TC-AGU-09][BE-IT] persists provider switches and skips quota, alerts and history for disabled providers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-providers-test-'));
  const time = Date.parse('2026-11-28T01:55:00+07:00');
  const sessions = path.join(root, 'copilot', 'session-state', 'example');
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, 'events.jsonl'), JSON.stringify({
    type: 'session.usage_record', timestamp: new Date(time).toISOString(), id: 'switch-test',
    data: { usage: { model: 'copilot-test', inputTokens: 32, outputTokens: 4 } },
  }));
  const attempts = [];
  const alerts = [];
  let now = time;
  let remaining = 95;
  const options = {
    port: 0,
    env: {
      AGENT_USAGE_STATE_DIR: root, AI_QUOTA_DIR: root, CLAUDE_CONFIG_DIR: root,
      AGY_HOME: root, COPILOT_HOME: path.join(root, 'copilot'), CODEX_HOME: root,
    },
    now: () => now,
    notify: async alert => { alerts.push(alert); },
    probeQuota: async provider => {
      attempts.push(provider);
      if (provider === 'copilot') return { captured: now, windows: { monthly: { remaining, resetsAt: null, cycle: '2026-11' } } };
      const window = { remaining, resetsAt: time / 1000 + 18_000 };
      return { captured: now, windows: { '5h': window, '7d': window } };
    },
  };
  let server;
  const close = async () => {
    if (!server) return;
    const closing = new Promise(resolve => server.close(resolve));
    server.closeAllConnections?.();
    await closing;
    server = undefined;
  };
  const request = (endpoint, data) => fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, data);
  const get = endpoint => request(endpoint).then(response => response.json());
  const save = providers => request('/api/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...defaultSettings, providers }),
  });
  const allOff = { claude: false, agy: false, copilot: false, codex: false };
  const mixed = { ...allOff, copilot: true, codex: true };
  try {
    await writeFile(path.join(root, 'settings.json'), JSON.stringify({ watch: 75, refreshMinutes: 7 }));
    server = await startServer(options);
    const initial = await get('/api/quota');
    assert.equal(initial.settings.watch, 75);
    assert.equal(initial.settings.refreshMinutes, 7);
    assert.deepEqual(initial.quota.map(row => row.provider), ['claude', 'agy', 'copilot']);
    assert.deepEqual((await get('/api/models?days=7')).models.map(row => row.provider), ['copilot']);
    assert.equal((await save({ ...allOff, copilot: 'false' })).status, 400);
    const disabled = await save(allOff);
    assert.equal(disabled.status, 200);
    assert.deepEqual((await disabled.json()).quota, []);
    assert.deepEqual((await get('/api/models?days=7')).models, []);
    remaining = 25;
    now += 600_000;
    await get('/api/quota');
    assert.deepEqual(attempts, ['claude', 'agy', 'copilot']);
    assert.deepEqual(alerts, []);
    assert.deepEqual((await get('/api/quota')).settings.providers, allOff);
    const enabled = await save(mixed);
    assert.equal(enabled.status, 200);
    assert.deepEqual((await enabled.json()).quota.map(row => row.provider), ['copilot', 'codex']);
    assert.deepEqual(attempts.slice(3), ['copilot', 'codex']);
    assert.deepEqual(alerts, []);
    assert.deepEqual((await get('/api/models?days=30')).models.map(row => row.provider), ['copilot']);
    await close();
    server = await startServer(options);
    assert.deepEqual((await get('/api/quota')).settings.providers, mixed);
    assert.deepEqual(attempts.slice(5), ['copilot', 'codex']);
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
});

test('[TC-AGU-10][BE-UT] maps Codex quota windows by duration and rejects unavailable or expired snapshots', () => {
  const now = Date.parse('2026-11-28T01:55:00+07:00');
  const resetsAt = now / 1000 + 1800;
  const windows = parseCodexQuota({ rateLimitsByLimitId: { codex: {
    primary: { usedPercent: 50, windowDurationMins: 10080, resetsAt: null },
    secondary: { usedPercent: 40, windowDurationMins: 300, resetsAt },
  } } }, now).windows;
  assert.deepEqual(windows, { '5h': { remaining: 60, resetsAt }, '7d': { remaining: 50, resetsAt: null } });
  assert.equal(parseCodexQuota({ rateLimits: { primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: now / 1000 } } }, now), null);
  assert.equal(parseCodexQuota(null, now), null);
});

test('[TC-AGU-11][BE-IT] aggregates recorded Codex turns without counting repeated cumulative usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-codex-history-'));
  try {
    const time = Date.parse('2026-11-28T01:55:00+07:00');
    const timeline = path.join(root, 'sessions', '2026', '11', '28');
    await mkdir(timeline, { recursive: true });
    const timestamp = new Date(time).toISOString();
    const record = (type, payload) => JSON.stringify({ timestamp, type, payload });
    const event = (type, extra) => record('event_msg', { type, ...extra });
    const usage = (total, last) => event('token_count', { info: {
      total_token_usage: { total_tokens: total }, last_token_usage: { total_tokens: last },
    } });
    await writeFile(path.join(timeline, 'rollout-example.jsonl'), [
      usage(100, 20),
      record('turn_context', { turn_id: 'one', model: 'codex-test' }),
      usage(110, 10), usage(110, 10), usage(130, 20),
      event('task_complete', { turn_id: 'one', duration_ms: 400 }),
      record('turn_context', { turn_id: 'two', model: 'codex-test' }),
      usage(135, 5),
      event('turn_aborted', { turn_id: 'two', duration_ms: 100 }),
    ].join('\n'));
    const calls = await readModelCalls({ env: { CODEX_HOME: root }, providers: ['codex'], now: time });
    assert.deepEqual(aggregateCalls(calls, 7, time), [
      { provider: 'codex', model: 'codex-test', calls: 2, tokens: 35, okPct: 50, avgMs: 250 },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('[TC-AGU-13][BE-IT] skips fresh cache and rate-limits probes for missing, expired and aging windows', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = 1_800_000_000_000;
  const settings = { ...defaultSettings, providers: { claude: true, agy: false, copilot: false, codex: false } };
  const attempts = [];
  const reader = createLiveQuotaReader({ env: { AI_QUOTA_DIR: directory }, now: () => time, probe: async provider => {
    attempts.push(provider);
    return null;
  } });
  const write = (other = { remaining_pct: 80, resets_at: time / 1000 + 600 }, age = 0) => {
    const windows = { '5h': { remaining_pct: 90, resets_at: time / 1000 + 600 }, '7d': other };
    return writeFile(path.join(directory, 'claude.json'), JSON.stringify({ captured_at: time / 1000 - age, pools: { default: windows } }));
  };
  await write();
  assert.ok((await reader(settings))[0].windows.every(window => window.state === 'live'));
  assert.deepEqual(attempts, []);
  await write(null);
  await reader(settings);
  await reader(settings);
  assert.deepEqual(attempts, ['claude']);
  time += 240_000;
  await write({ remaining_pct: 80, resets_at: time / 1000 });
  assert.equal((await reader(settings))[0].windows[1].state, 'reset_assumed');
  time += 240_000;
  await write(undefined, 301);
  assert.equal((await reader(settings))[0].windows[0].state, 'aging');
  assert.deepEqual(attempts, ['claude', 'claude', 'claude']);
});

test('[TC-AGU-14][BE-IT] parses a captured Claude panel and rejects changed layouts with one or zero windows', async () => {
  const helper = fileURLToPath(new URL('../apps/agent-usage/claude-usage.py', import.meta.url));
  const parse = text => {
    const parsed = spawnSync('python3', [helper, '--parse-panel'], { input: text, encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
    return JSON.parse(parsed.stdout);
  };
  const captured = await readFile(new URL('./fixtures/claude-usage-panel.txt', import.meta.url), 'utf8');
  const changed = await readFile(new URL('./fixtures/claude-usage-changed-panel.txt', import.meta.url), 'utf8');
  const original = parse(captured);
  assert.equal(original['5h'].remaining, 96);
  assert.equal(original['7d'].remaining, 42);
  assert.deepEqual(parse(changed), { error: 'parse-failed' });
  assert.deepEqual(parse(changed.replace('Current session', 'Short-term allowance')), { error: 'parse-failed' });
});

test('[TC-AGU-15][BE-IT] serves Claude probe errors and writes each reason change once to server.log', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-errors-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = 1_800_000_000_000;
  let reason = 'parse-failed';
  const settings = { ...defaultSettings, providers: { claude: true, agy: false, copilot: false, codex: false } };
  await writeFile(path.join(directory, 'settings.json'), JSON.stringify(settings));
  const server = await startServer({
    port: 0, env: { AI_QUOTA_DIR: directory, AGENT_USAGE_STATE_DIR: directory }, now: () => time,
    probeQuota: async () => { throw Object.assign(new Error(reason), { code: reason }); },
  });
  try {
    for (const expected of ['parse-failed', 'parse-failed', 'timeout', 'timeout', 'trust-required']) {
      reason = expected;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quota`);
      const { quota: [row] } = await response.json();
      assert.equal(row.state, 'error');
      assert.equal(row.error, expected);
      time += 240_000;
    }
    const logs = (await readFile(path.join(directory, 'server.log'), 'utf8')).trim().split('\n');
    assert.deepEqual(logs, ['parse-failed', 'timeout', 'trust-required'].map(error => `Agent Usage · claude quota probe: ${error}`));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('[TC-AGU-16][BE-IT] dashboard publishes native quota and shows both cache-only delegation decisions', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-route-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const time = 1_800_000_000_000;
  const settings = { ...defaultSettings, providers: { claude: true, agy: true, copilot: false, codex: false } };
  await writeFile(path.join(directory, 'settings.json'), JSON.stringify(settings));
  const server = await startServer({
    port: 0, env: { AI_QUOTA_DIR: directory, AGENT_USAGE_STATE_DIR: directory }, now: () => time,
    probeQuota: async provider => {
      const window = { remaining: provider === 'agy' ? 5 : 90, resetsAt: time / 1000 + 600 };
      return { captured: time, windows: { '5h': window, '7d': window } };
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quota`);
    assert.equal(response.status, 200);
    const { routes } = await response.json();
    assert.match(routes.claudeToAgy.reason, /agy 5h quota is critical/);
    assert.equal(routes.claudeToAgy.target, 'claude');
    assert.equal(routes.agyToClaude.target, 'claude');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
