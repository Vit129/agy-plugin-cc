import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseCodexQuota } from '../apps/agent-usage/provider-quota.mjs';
import { defaultSettings } from '../apps/agent-usage/quota.mjs';
import { createLiveQuotaReader } from '../apps/agent-usage/live-quota.mjs';
import { startServer } from '../apps/agent-usage/server.mjs';

const hour = 3_600_000;
const timestamp = Date.parse('2026-12-01T00:00:00Z');
const off = { claude: false, agy: false, copilot: false, codex: false };

async function fixture(t, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-profiles-'));
  let server;
  async function close() {
    if (!server) return;
    const closing = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closing;
    server = undefined;
  }
  t.after(async () => {
    await close();
    await rm(directory, { recursive: true, force: true });
  });
  const env = { AGENT_USAGE_STATE_DIR: directory, AI_QUOTA_DIR: directory };
  const request = (pathname, init) => fetch(`http://127.0.0.1:${server.address().port}${pathname}`, init);
  return {
    directory, env, close,
    async start() { server = await startServer({ port: 0, env, ...options }); },
    quota: () => request('/api/quota').then(response => response.json()),
    models: () => request('/api/models').then(response => response.json()),
    save: settings => request('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...defaultSettings, ...settings }),
    }),
  };
}

test('[TC-AGU-17][BE-IT] isolates named homes, model calls, alert keys and ambient routing', async t => {
  const alerts = [];
  let time = timestamp;
  const next = new Map();
  const probes = [];
  const app = await fixture(t, {
    now: () => time,
    notify: async alert => { alerts.push(alert); },
    probeQuota: async (provider, env) => {
      assert.equal(provider, 'claude');
      probes.push(env.CLAUDE_CONFIG_DIR);
      const window = { remaining: next.get(env.CLAUDE_CONFIG_DIR) ?? 92, resetsAt: timestamp / 1000 + 3600 };
      return { captured: time, windows: { '5h': window, '7d': window } };
    },
  });
  app.env.CLAUDE_CONFIG_DIR = path.join(app.directory, 'ambient');
  const one = { id: 'one', label: 'Personal', home: path.join(app.directory, 'personal') };
  const two = { id: 'two', label: 'Work', home: path.join(app.directory, 'work') };
  for (const [account, tokens] of [[one, 11], [two, 22]]) {
    const project = path.join(account.home, 'projects', 'fixture');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, 'log.jsonl'), JSON.stringify({
      type: 'assistant', timestamp: new Date(time).toISOString(), requestId: 'same-id',
      message: { model: 'claude-test', usage: { input_tokens: tokens } },
    }));
  }
  await writeFile(path.join(app.directory, 'settings.json'), JSON.stringify({ providers: off }));
  await app.start();
  const providers = { ...off, claude: true };
  for (const accounts of [
    null, { agy: [one] }, { claude: [one, { ...two, id: one.id }] },
    { claude: [one, { ...two, home: one.home + '/.' }] },
    { claude: [{ ...one, home: 'relative' }] }, { claude: [{ ...one, label: ' ' }] },
    { claude: [{ ...one, id: 'default' }] }, { claude: [{ ...one, extra: 1 }] },
  ]) assert.equal((await app.save({ providers, accounts })).status, 400);
  assert.deepEqual(probes, []);

  const accounts = { claude: [one, two] };
  const saved = await app.save({ providers, accounts });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).quota.map(row => [row.accountId, row.label]), [
    ['one', 'Claude Code · Personal'], ['two', 'Claude Code · Work'],
  ]);
  assert.deepEqual(new Set(probes), new Set([one.home, two.home, app.env.CLAUDE_CONFIG_DIR]));
  assert.deepEqual((await app.models()).models.map(({ accountId, tokens }) => [accountId, tokens]), [['two', 22], ['one', 11]]);

  next.set(one.home, 10);
  next.set(two.home, 50);
  time += 240_000;
  const result = await app.quota();
  assert.equal(result.routes.agyToClaude.target, 'claude');
  assert.deepEqual(result.quota.map(row => row.windows[0].remaining), [10, 50]);
  const state = JSON.parse(await readFile(path.join(app.directory, 'alerts.json')));
  assert.deepEqual(alerts.map(alert => alert.key).sort(), [
    'claude:one:default:5h', 'claude:one:default:7d', 'claude:two:default:5h', 'claude:two:default:7d',
  ]);
  assert.equal(state['claude:one:default:5h'].notified, 3);
  assert.equal(state['claude:two:default:5h'].notified, 2);
  const cached = JSON.parse(await readFile(path.join(app.directory, 'native-claude.json')));
  assert.equal(cached.pools.default['5h'].remaining_pct, 92);
  const reverted = await app.save({ providers, accounts: { claude: [] } });
  assert.deepEqual((await reverted.json()).quota.map(row => row.label), ['Claude Code']);
  assert.deepEqual((await app.models()).models, []);
});

const expiry = timestamp + 24 * hour;
const credit = (id, status = 'available', expiresAt = expiry / 1000) => ({
  id, resetType: 'codexRateLimits', status, grantedAt: timestamp / 1000,
  expiresAt, title: 'Full reset (Weekly + 5 hr)', description: null,
});
const withCredits = credits => ({ rateLimitResetCredits: { availableCount: credits?.length ?? 0, credits } });

test('[TC-AGU-18][BE-UT] preserves full reset credits with no usable rate-limit windows', () => {
  const payload = withCredits([credit('available'), credit('used', 'redeemed'), credit('none', 'available', null)]);
  assert.deepEqual(parseCodexQuota(payload, timestamp), { captured: timestamp, windows: {}, ...payload });
  const countOnly = { rateLimitResetCredits: { availableCount: 2, credits: null } };
  assert.deepEqual(parseCodexQuota(countOnly, timestamp), { captured: timestamp, windows: {}, ...countOnly });
});

test('[TC-AGU-19][BE-IT] rereads Codex at both reminder boundaries and persists per-credit delivery', async t => {
  let time = timestamp - 1000;
  let used = 'available';
  let failOnce = true;
  const delivered = [];
  const app = await fixture(t, {
    now: () => time,
    probeQuota: async (provider, env) => {
      assert.equal(provider, 'codex');
      const isPrimary = env.CODEX_HOME.endsWith('/primary');
      const credits = [credit('shared-id'), credit('no-expiry', 'available', null), credit('expired', 'available', timestamp / 1000 - 5)];
      if (isPrimary) credits.push(credit('consume', used));
      return parseCodexQuota(withCredits(credits), time);
    },
    notify: async alert => {
      if (failOnce) {
        failOnce = false;
        throw new Error('fixture delivery failed');
      }
      delivered.push(alert);
    },
  });
  const providers = { ...off, codex: true };
  const accounts = { codex: ['primary', 'other'].map(id => ({ id, label: id, home: path.join(app.directory, id) })) };
  const settings = { ...defaultSettings, providers, refreshMinutes: 60, accounts };
  await writeFile(path.join(app.directory, 'settings.json'), JSON.stringify(settings));
  await app.start();
  const initial = await app.quota();
  assert.equal(initial.quota[0].rateLimitResetCredits.credits[0].id, 'shared-id');
  assert.equal(delivered.length, 0);
  time = timestamp;
  await app.quota();
  assert.equal(delivered.length, 2);
  await app.quota();
  assert.equal(delivered.length, 3);
  assert.equal(new Set(delivered.map(alert => alert.key)).size, 3);
  assert.ok(delivered.every(alert => /expires .+ \(in 24h\)/.test(alert.message)));

  await app.save({ ...settings, providers: off });
  await app.close();
  await app.start();
  await app.save(settings);
  assert.equal(delivered.length, 3);
  used = 'redeemed';
  time = expiry - 2 * hour - 1000;
  await app.quota();
  time += 1000;
  await app.quota();
  assert.equal(delivered.length, 5);
  assert.ok(delivered.slice(-2).every(alert => /expires .+ \(in 2h\)/.test(alert.message)));
  await app.close();
  await app.start();
  await app.quota();
  time = expiry;
  await app.quota();
  assert.equal(delivered.length, 5);
  const state = JSON.parse(await readFile(path.join(app.directory, 'alerts.json')));
  assert.ok(delivered.every(alert => state[alert.key]));
});

test('[TC-AGU-20][BE-UT] drops malformed reset credits and coerces the fields the menu bar decodes', () => {
  const bad = { id: 'no-status', expiresAt: null, title: 7 };
  const payload = withCredits([credit('ok'), bad, { status: 'available' }, null]);
  const { credits } = parseCodexQuota(payload, timestamp).rateLimitResetCredits;
  assert.deepEqual(credits.map(item => item.id), ['ok', 'no-status']);
  assert.deepEqual(credits[1], { id: 'no-status', resetType: null, status: 'unknown', grantedAt: null, expiresAt: null, title: null, description: null });
});

test('[TC-AGU-21][BE-IT] a failed re-probe keeps the last good reset credits and their captured time', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-credits-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = timestamp;
  let fail = false;
  const read = createLiveQuotaReader({
    env: { ...process.env, AGENT_USAGE_STATE_DIR: directory, AI_QUOTA_DIR: directory },
    now: () => time, log: () => {},
    probe: async () => {
      if (fail) throw new Error('probe down');
      return parseCodexQuota(withCredits([credit('keep')]), time);
    },
  });
  const settings = { ...defaultSettings, providers: { ...off, codex: true }, refreshMinutes: 5 };
  const row = async () => (await read(settings)).find(item => item.provider === 'codex');
  const first = await row();
  assert.equal(first.rateLimitResetCredits.credits[0].id, 'keep');
  fail = true;
  time += 10 * 60_000;
  const second = await row();
  assert.equal(second.rateLimitResetCredits.credits[0].id, 'keep');
  assert.equal(second.creditsObservedAt, first.creditsObservedAt);
});
