import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
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
  const env = { HOME: directory, AGENT_USAGE_STATE_DIR: directory, AI_QUOTA_DIR: directory };
  const request = (pathname, init) => fetch(`http://127.0.0.1:${server.address().port}${pathname}`, init);
  return {
    directory, env, close, request,
    post: (pathname, data, headers) => request(pathname, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data),
    }),
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

const claudeProviders = { ...off, claude: true };
const claudeAccount = '11111111-1111-4111-8111-111111111111';
const otherClaudeAccount = '22222222-2222-4222-8222-222222222222';
const claudeExpiry = '2026-12-14T05:00:00+07:00';
const claudeExpiryMs = Date.parse(claudeExpiry);

function claudeConfig(home, accountUuid, cache) {
  return writeFile(path.join(home, '.claude.json'), JSON.stringify({
    oauthAccount: { accountUuid, emailAddress: 'claude@example.test' },
    unusedLimitResetStatusCache: cache,
  }));
}

function claudeCredit(snapshot, accountId) {
  return snapshot.quota.find(row => row.provider === 'claude' && row.accountId === accountId)
    ?.rateLimitResetCredits?.credits?.[0];
}

test('[TC-AGU-41][BE-IT] validates and saves a timezone-qualified Claude expiry for the detected account', async t => {
  const app = await fixture(t, { now: () => timestamp, probeQuota: async () => null });
  await claudeConfig(app.directory, claudeAccount);
  await app.start();
  const save = (expiresAt, accountUuid = claudeAccount) => app.save({
    providers: claudeProviders, claudeFullReset: { [accountUuid]: { expiresAt, used: false } },
  });
  for (const invalid of ['2026-12-14T05:00:00', '2026-02-30T05:00:00+07:00', '2026-12-14T24:00:00Z', 'tomorrow', 1796930400000]) {
    assert.equal((await save(invalid)).status, 400, String(invalid));
  }
  assert.equal((await save(claudeExpiry, otherClaudeAccount)).status, 400);

  const saved = await save(claudeExpiry);
  assert.equal(saved.status, 200);
  const snapshot = await saved.json();
  const { provider, title, label, expiresAt, status } = claudeCredit(snapshot);
  assert.deepEqual({ provider, title, label, expiresAt, status }, {
    provider: 'claude', title: 'Full reset', label: 'Full reset', expiresAt: claudeExpiryMs / 1000, status: 'unknown',
  });
  const response = await app.request('/api/settings');
  assert.equal(response.status, 200);
  const [account] = (await response.json()).claudeFullResetAccounts;
  assert.deepEqual([account.accountUuid, account.login, Date.parse(account.expiresAt), account.used, account.status],
    [claudeAccount, 'claude@example.test', claudeExpiryMs, false, 'unknown']);
  assert.equal((await app.save({ providers: claudeProviders, target: 9 })).status, 200);
  assert.equal(claudeCredit(await app.quota()).expiresAt, expiresAt);
  assert.equal((await save(null)).status, 200);
  assert.equal(claudeCredit(await app.quota()), undefined);
});

test('[TC-AGU-42][BE-IT] uses only fresh Claude cache entries for the signed-in account', async t => {
  let time = timestamp;
  const app = await fixture(t, { now: () => time, probeQuota: async () => null });
  const named = path.join(app.directory, 'named');
  await mkdir(named);
  await claudeConfig(app.directory, claudeAccount);
  await claudeConfig(named, otherClaudeAccount);
  await app.start();
  const response = await app.save({
    providers: claudeProviders,
    accounts: { claude: [{ id: 'named', label: 'Named', home: named }] },
    claudeFullReset: {
      [claudeAccount]: { expiresAt: claudeExpiry, used: false },
      [otherClaudeAccount]: { expiresAt: claudeExpiry, used: true },
    },
  });
  assert.equal(response.status, 200);
  const fresh = { accountUuid: otherClaudeAccount, holdsUnusedReset: true, checkedAt: time, validUntil: time + hour };
  await claudeConfig(named, otherClaudeAccount, fresh);
  const status = async () => claudeCredit(await app.quota(), 'named').status;
  assert.equal(await status(), 'available');
  await claudeConfig(named, otherClaudeAccount, { ...fresh, holdsUnusedReset: false });
  assert.equal(await status(), 'used');
  for (const ignored of [
    { ...fresh, checkedAt: time + 1 },
    { ...fresh, validUntil: time },
    { ...fresh, accountUuid: claudeAccount },
    { ...fresh, holdsUnusedReset: 'true' },
  ]) {
    await claudeConfig(named, otherClaudeAccount, ignored);
    assert.equal(await status(), 'used');
  }
  await claudeConfig(named, otherClaudeAccount, fresh);
  time = fresh.validUntil - 1;
  assert.equal(await status(), 'available');
  time = fresh.validUntil;
  assert.equal(await status(), 'used');
  await claudeConfig(named, claudeAccount);
  assert.equal(await status(), 'unknown');
});

test('[TC-AGU-43][BE-IT] reminds at 24 and 2 hours once and suppresses a used or expired Claude credit', async t => {
  let time = claudeExpiryMs - 24 * hour - 1;
  const alerts = [];
  const app = await fixture(t, {
    now: () => time, probeQuota: async () => null,
    notify: async alert => { alerts.push(alert); },
  });
  await claudeConfig(app.directory, claudeAccount);
  await app.start();
  const save = async (used, expiresAt = claudeExpiry, resetCreditReminders = true) => {
    const response = await app.save({ providers: claudeProviders, resetCreditReminders,
      claudeFullReset: { [claudeAccount]: { expiresAt, used } } });
    assert.equal(response.status, 200);
    return response.json();
  };
  await save(false);
  assert.equal(alerts.length, 0);
  time += 1;
  await app.quota();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /Full reset.+\(in 24h\)/);
  await app.close();
  await app.start();
  await app.quota();
  assert.equal(alerts.length, 1);
  time = claudeExpiryMs - 2 * hour - 1;
  await app.quota();
  assert.equal(alerts.length, 1);

  await claudeConfig(app.directory, claudeAccount, {
    accountUuid: claudeAccount, holdsUnusedReset: false, checkedAt: time, validUntil: time + hour,
  });
  time += 1;
  assert.equal(claudeCredit(await app.quota()).status, 'used');
  assert.equal(alerts.length, 1);
  await claudeConfig(app.directory, claudeAccount);
  const used = await save(true);
  assert.equal(claudeCredit(used).status, 'used');
  await app.close();
  await app.start();
  assert.equal(claudeCredit(await app.quota()).status, 'used');
  assert.equal(alerts.length, 1);

  await save(false);
  assert.equal(alerts.length, 2);
  assert.match(alerts[1].message, /Full reset.+\(in 2h\)/);
  await app.quota();
  assert.equal(alerts.length, 2);
  time = claudeExpiryMs;
  await app.quota();
  assert.equal(alerts.length, 2);
  await save(false, new Date(time + 24 * hour).toISOString(), false);
  assert.equal(alerts.length, 2);
  assert.equal(claudeCredit(await app.quota()).status, 'unknown');
  await app.save({ providers: claudeProviders, resetCreditReminders: true });
  assert.equal(alerts.length, 3);
  assert.match(alerts[2].message, /Full reset.+\(in 24h\)/);
});

test('[TC-AGU-44][BE-IT] keeps manual Claude credits and reminders independent across accounts', async t => {
  let time = claudeExpiryMs - 24 * hour - 1;
  const alerts = [];
  const app = await fixture(t, {
    now: () => time, probeQuota: async () => null,
    notify: async alert => { alerts.push(alert); },
  });
  const firstHome = path.join(app.directory, 'first');
  const secondHome = path.join(app.directory, 'second');
  await Promise.all([mkdir(firstHome), mkdir(secondHome)]);
  await Promise.all([claudeConfig(firstHome, claudeAccount), claudeConfig(secondHome, otherClaudeAccount)]);
  const accounts = { claude: [
    { id: 'first', label: 'First', home: firstHome },
    { id: 'second', label: 'Second', home: secondHome },
  ] };
  await app.start();
  assert.equal((await app.save({ providers: claudeProviders, accounts })).status, 200);
  const save = (accountUuid, used) => app.save({
    providers: claudeProviders, accounts, claudeFullReset: { [accountUuid]: { expiresAt: claudeExpiry, used } },
  });
  for (const result of await Promise.all([save(claudeAccount, false), save(otherClaudeAccount, false)])) {
    assert.equal(result.status, 200);
  }
  time += 1;
  const snapshot = await app.quota();
  assert.equal(claudeCredit(snapshot, 'first').status, 'unknown');
  assert.equal(claudeCredit(snapshot, 'second').status, 'unknown');
  assert.equal(alerts.length, 2);
  assert.notEqual(alerts[0].key, alerts[1].key);
  assert.ok(alerts.some(({ message }) => message.includes('First')));
  assert.ok(alerts.some(({ message }) => message.includes('Second')));

  assert.equal((await save(claudeAccount, true)).status, 200);
  time = claudeExpiryMs - 2 * hour;
  await app.quota();
  assert.equal(alerts.length, 3);
  assert.match(alerts[2].message, /Second.+\(in 2h\)/);
});

test('[TC-AGU-22][BE-IT] reads local account identities and ignores invalid credentials', async t => {
  const app = await fixture(t, { probeQuota: async () => null });
  async function identity(home, name, contents) {
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, name), contents);
  }
  const claude = path.join(app.directory, '.claude');
  const codex = path.join(app.directory, '.codex');
  const copilot = path.join(app.directory, '.copilot');
  const gemini = path.join(app.directory, '.gemini');
  const named = path.join(app.directory, 'named');
  const noLogin = path.join(app.directory, 'no-login');
  function auth(email) {
    const payload = { email, 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } };
    return JSON.stringify({ tokens: { id_token: `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature` } });
  }
  await identity(app.directory, '.claude.json', '{"oauthAccount":{"emailAddress":"default@example.test","organizationType":"claude_pro"}}');
  await identity(claude, '.claude.json', '{"mcpServers":{}}');
  await identity(named, '.claude.json', '{"oauthAccount":{"emailAddress":"named@example.test","seatTier":"max_5x"}}');
  await identity(codex, 'auth.json', auth('codex@example.test'));
  await identity(noLogin, 'auth.json', '{"tokens":{"id_token":"malformed"}}');
  await identity(copilot, 'config.json', '// managed by Copilot\n// CLI state\n{"lastLoggedInUser":{"login":"test-octocat","host":"https://github.com"},"loggedInUsers":[{"login":"older-account"}]}');
  await identity(gemini, 'google_accounts.json', '{"active":"agy@example.test","old":["previous@example.test"]}');
  Object.assign(app.env, { HOME: app.directory, CODEX_HOME: codex, COPILOT_HOME: copilot, AGY_HOME: path.join(gemini, 'antigravity-cli') });
  await app.start();
  const providers = Object.fromEntries(Object.keys(off).map(provider => [provider, true]));
  const response = await app.save({ providers });
  const result = await response.json();
  assert.deepEqual(result.quota.map(({ provider, login }) => [provider, login]), [
    ['claude', 'default@example.test'], ['agy', 'agy@example.test'], ['copilot', 'test-octocat'], ['codex', 'codex@example.test'],
  ]);
  assert.deepEqual(result.quota.map(({ plan }) => plan), ['Pro', undefined, undefined, 'Plus']);
  const namedResult = await app.save({ providers, accounts: {
    claude: [{ id: 'named', label: 'Named', home: named }],
    codex: [{ id: 'unknown', label: 'Unknown', home: noLogin }],
  } }).then(response => response.json());
  assert.deepEqual(namedResult.quota.map(({ login }) => login), ['named@example.test', 'agy@example.test', 'test-octocat', undefined]);
  assert.deepEqual(namedResult.quota.map(({ plan }) => plan), ['Max 5×', undefined, undefined, undefined]);
  assert.ok(namedResult.accounts.claude.some(({ login, kind }) => login === 'default@example.test' && kind === 'current'));
  assert.ok(namedResult.accounts.claude.some(({ login, kind }) => login === 'named@example.test' && kind === 'manual'));
  assert.doesNotMatch(JSON.stringify(namedResult), /id_token|signature|older-account|previous@example/);
  app.env.CLAUDE_CONFIG_DIR = named;
  const alternate = await app.save({ providers, accounts: {} }).then(response => response.json());
  assert.equal(alternate.quota[0].login, 'named@example.test');
  assert.deepEqual(alternate.accounts.claude.map(({ kind, login }) => [kind, login]), [
    ['current', 'named@example.test'], ['default', 'default@example.test'],
  ]);
});

test('[TC-AGU-23][BE-IT] launches provider login in private managed homes and discovers completed sign-ins', async t => {
  const launches = [];
  const app = await fixture(t, { probeQuota: async () => null,
    openLogin: async login => { launches.push(login); },
  });
  await app.start();
  const providers = { ...off, claude: true };
  await app.save({ providers });
  for (const [provider, variable, args] of [
    ['claude', 'CLAUDE_CONFIG_DIR', ['auth', 'login']], ['codex', 'CODEX_HOME', ['login']], ['copilot', 'COPILOT_HOME', ['login']],
  ]) {
    const response = await app.post('/api/accounts/sign-in', { provider });
    assert.equal(response.status, 201);
    const { id } = await response.json();
    const home = path.join(app.directory, 'accounts', provider, id);
    assert.equal((await stat(home)).mode & 0o777, 0o700);
    assert.equal(launches.at(-1).provider, provider);
    assert.equal(launches.at(-1).home, home);
    assert.equal(launches.at(-1).variable, variable);
    assert.deepEqual(launches.at(-1).args, args);
  }
  const agy = await app.post('/api/accounts/sign-in', { provider: 'agy' });
  assert.equal(agy.status, 200);
  assert.deepEqual(await agy.json(), { opened: true });
  assert.equal(launches.at(-1).provider, 'agy');
  assert.deepEqual(launches.at(-1).args, []);
  await assert.rejects(stat(path.join(app.directory, 'accounts', 'agy')), { code: 'ENOENT' });
  const { home } = launches[0];
  const pending = await app.quota();
  assert.deepEqual(pending.quota.map(row => row.accountId), [undefined]);
  assert.equal(pending.accounts.claude[0].kind, 'managed');
  assert.equal(pending.accounts.claude[0].login, undefined);
  await writeFile(path.join(home, '.claude.json'), '{"oauthAccount":{"emailAddress":"added@example.test"}}');
  const project = path.join(home, 'projects', 'fixture');
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, 'log.jsonl'), JSON.stringify({
    type: 'assistant', requestId: 'managed-turn', timestamp: new Date().toISOString(),
    message: { model: 'claude-test', usage: { input_tokens: 4 } },
  }));
  const signedIn = await app.quota();
  assert.deepEqual(signedIn.quota.map(row => row.login), [undefined, 'added@example.test']);
  assert.equal(signedIn.active[0].provider, 'claude');
  assert.deepEqual((await app.models()).models.map(row => [row.accountId, row.tokens]), [[signedIn.quota[1].accountId, 4]]);
  assert.deepEqual(signedIn.settings.accounts, {});
  await app.close();
  await app.start();
  assert.equal((await app.quota()).accounts.claude[0].login, 'added@example.test');
});

test('[TC-AGU-24][BE-IT] account mutations validate origin, method, provider and managed home ownership', async t => {
  const app = await fixture(t, { probeQuota: async () => null, openLogin: async () => {} });
  await app.start();
  const signIn = '/api/accounts/sign-in';
  const remove = '/api/accounts/remove';
  for (const endpoint of [signIn, remove]) {
    assert.equal((await app.request(endpoint)).status, 404);
    assert.equal((await app.post(endpoint, { provider: 'claude' }, { Origin: 'https://other.example.test' })).status, 403);
    assert.equal((await app.post(endpoint, { provider: 'claude' }, { 'Content-Type': 'text/plain' })).status, 400);
  }
  assert.equal((await app.post(signIn, { provider: 'agy', home: app.directory })).status, 400);
  assert.equal((await app.post(remove, { provider: 'agy', id: '12345678-1234-4123-8123-123456789abc', confirm: true })).status, 400);
  assert.equal((await app.post(signIn, { provider: 'claude', home: app.directory })).status, 400);
  assert.equal((await app.post(remove, { provider: 'claude', id: '../escape', confirm: true })).status, 400);
  const { id } = await app.post(signIn, { provider: 'claude' }).then(response => response.json());
  const parent = path.join(app.directory, 'accounts', 'claude');
  const home = path.join(parent, id);
  const otherHome = path.join(app.directory, 'manual');
  await mkdir(otherHome);
  await writeFile(path.join(otherHome, 'keep'), '');
  await symlink(otherHome, path.join(home, 'external'));
  const externalId = '12345678-1234-4123-8123-123456789abc';
  const unownedId = '23456789-1234-4123-8123-123456789abc';
  await symlink(otherHome, path.join(parent, externalId));
  await mkdir(path.join(parent, unownedId));
  assert.equal((await app.post(remove, { provider: 'claude', id })).status, 400);
  assert.equal((await app.post(remove, { provider: 'codex', id, confirm: true })).status, 404);
  for (const id of [externalId, unownedId]) {
    assert.equal((await app.post(remove, { provider: 'claude', id, confirm: true })).status, 404);
  }
  assert.equal((await app.post(remove, { provider: 'claude', id, confirm: true })).status, 200);
  await assert.rejects(stat(home), { code: 'ENOENT' });
  assert.ok((await stat(path.join(otherHome, 'keep'))).isFile());
  await mkdir(path.join(app.directory, 'external-accounts'));
  await symlink(path.join(app.directory, 'external-accounts'), path.join(app.directory, 'accounts', 'codex'));
  assert.equal((await app.post(signIn, { provider: 'codex' })).status, 409);
});

test('[TC-AGU-25][BE-IT] rolls back a managed home when Terminal cannot start', async t => {
  const app = await fixture(t, { probeQuota: async () => null,
    openLogin: async () => { throw new Error('fixture Terminal failure'); },
  });
  await app.start();
  assert.equal((await app.post('/api/accounts/sign-in', { provider: 'claude' })).status, 503);
  assert.deepEqual((await app.quota()).accounts.claude, []);
});

test('[TC-AGU-26][BE-IT] reports only recent transcript writes and expires activity without reading their contents', async t => {
  let time = timestamp;
  const app = await fixture(t, { now: () => time, probeQuota: async () => null });
  const files = [
    ['.claude/projects/project/session/subagents/agent.jsonl', 10],
    ['.codex/sessions/2026/12/01/rollout-fixture.jsonl', 80],
    ['.gemini/antigravity-cli/conversations/fixture.pb', 55],
    ['.gemini/antigravity-cli/brain/fixture/.system_generated/logs/transcript.jsonl', 50],
    ['.copilot/session-state/fixture/events.jsonl', 100],
    ['.copilot/session-state/stale/events.jsonl', 130],
    ['.copilot/session-state/fixture/workspace.yaml', 5],
  ];
  for (const [relative, ago] of files) {
    const file = path.join(app.directory, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'not a transcript payload');
    await utimes(file, time / 1000 - ago, time / 1000 - ago);
  }
  await app.start();
  const providers = Object.fromEntries(Object.keys(off).map(provider => [provider, true]));
  const { active } = await app.save({ providers }).then(response => response.json());
  assert.deepEqual(active, ['claude', 'agy', 'codex', 'copilot'].map((provider, i) => ({
    provider, lastActivity: time - [10, 50, 80, 100][i] * 1000,
  })));
  time += 110_001;
  assert.deepEqual((await app.quota()).active, []);
});
