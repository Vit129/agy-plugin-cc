import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { chooseRoute, isRouteOffPersisted } from '../../plugins/agy/scripts/lib/quota-route.mjs';
import { readAllQuota, writeNativeQuota } from '../../plugins/agy/scripts/lib/quota-state.mjs';
import { accountEnvironment, accountHomeVariables, accountsForProvider, cliHome, normalizeAccounts } from './accounts.mjs';
import { discoverAccounts } from './account-identity.mjs';
import { addClaudeFullReset, claudeFullResetAccounts, normalizeClaudeFullResets } from './claude-reset-credit.mjs';
import { createManagedHome, isManagedId, isManagedProvider, managedHomes, openAgySignIn, openTerminalLogin, removeManagedHome } from './managed-accounts.mjs';
import { buildMenuModel } from './menu-model.mjs';
import { defaultSettings, enabledProviders, loadSettings, planQuotaAlerts, providerLabel, validSettings } from './quota.mjs';
import { createLiveQuotaReader } from './live-quota.mjs';
import { claudeCreditReminderPrefix, creditReminderPrefix, planResetCreditAlerts } from './reset-credits.mjs';
import { aggregateCalls, readModelCalls, recentProviderActivity } from './usage.mjs';
import { readState, stateDirectory, writeState } from './state.mjs';

export const defaultPort = 43127;
const run = promisify(execFile);
const assets = {
  '/': ['ui/index.html', 'text/html; charset=utf-8'],
  '/dashboard.mjs': ['ui/dashboard.mjs', 'text/javascript; charset=utf-8'],
  '/provider-icons.mjs': ['ui/provider-icons.mjs', 'text/javascript; charset=utf-8'],
  '/styles.css': ['ui/styles.css', 'text/css; charset=utf-8'],
  '/reset-credits.mjs': ['reset-credits.mjs', 'text/javascript; charset=utf-8'],
};

async function notifyMacOS(alert) {
  if (process.platform !== 'darwin') throw new Error('macOS notifications require macOS.');
  const message = alert.message ?? `${alert.provider} ${alert.short}: ${Math.floor(alert.remaining)}% remaining (${alert.level})`;
  const sound = alert.sound ? ' sound name "Glass"' : '';
  await run('/usr/bin/osascript', ['-e', `on run argv\n display notification (item 1 of argv) with title "Agent Usage"${sound}\nend run`, message], { timeout: 5000 });
}

const percent = value => `${Math.floor(value)}%`;

function resetLabel(seconds) {
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null;
}

export function quotaSummary(rows) {
  if (!rows.length) return 'No quota data yet.';
  return rows.map(row => {
    const known = row.windows.filter(window => Number.isFinite(window.remaining)).map(window => `${window.short} ${percent(window.remaining)}`);
    return `${row.accountId ? row.label : row.label.split(' · ')[0]} ${known.join(' · ') || 'no data'}`;
  }).join(' | ');
}

export function alertMessage(alert, routes) {
  const parts = [`${alert.provider} ${alert.short}: ${percent(alert.remaining)} remaining (${alert.level})`];
  const reset = resetLabel(alert.resetsAt);
  if (reset) parts.push(`resets ${reset}`);
  const route = { 'Claude Code': routes?.agyToClaude, 'Antigravity · Gemini': routes?.claudeToAgy }[alert.provider];
  if (route) parts.push(`route: ${route.target === route.requested ? 'no diversion' : `work goes to ${route.target}`}`);
  return parts.join(' · ');
}

function sendJSON(response, status, object) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(object));
}

async function parseJSON(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') return null;
  request.setEncoding('utf8');
  let text = '';
  for await (const part of request) {
    text += part;
    if (Buffer.byteLength(text) > 65_536) return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function parseSettings(request) {
  const parsed = await parseJSON(request);
  if (!parsed) return null;
  if (Object.hasOwn(parsed, 'claudeFullReset')) {
    parsed.claudeFullReset = normalizeClaudeFullResets(parsed.claudeFullReset);
    if (parsed.claudeFullReset === null) return null;
    if (Object.keys(parsed).length === 1) return parsed;
  }
  if (!validSettings(parsed)) return null;
  if (Object.hasOwn(parsed, 'accounts')) parsed.accounts = normalizeAccounts(parsed.accounts);
  return Object.fromEntries(Object.keys(defaultSettings).filter(key => Object.hasOwn(parsed, key)).map(key => [key, parsed[key]]));
}

const accountProviders = [...Object.keys(accountHomeVariables), 'agy'];

export async function startServer({ port = defaultPort, env = process.env, notify = notifyMacOS, now = Date.now,
  probeQuota, openLogin = openTerminalLogin } = {}) {
  const directory = path.resolve(stateDirectory(env));
  let settings = loadSettings(directory);
  const dispatchNotification = alert => notify({ ...alert, ...(settings.notificationSound ? { sound: true } : {}) });
  let observed = readState(directory, 'alerts.json', {}) ?? {};
  const readLiveQuota = createLiveQuotaReader({ env, now, probe: probeQuota, publish: writeNativeQuota, log: message => {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      appendFileSync(path.join(directory, 'server.log'), `${message}\n`, { mode: 0o600 });
    } catch {
      process.stderr.write(`${message}\n`);
    }
  } });
  let quota = [];
  let notificationError = null;
  let refreshQueue = Promise.resolve();
  let loadingModels;

  async function getAccounts(configured = settings.accounts) {
    return Object.fromEntries(await Promise.all(accountProviders.map(async provider => {
      const manual = configured?.[provider] ?? [];
      const managed = managedHomes(directory, provider).map(profile => ({ ...profile, label: 'Managed account' }));
      return [provider, await discoverAccounts(provider, manual, managed, env)];
    })));
  }

  function quotaSettings(accounts) {
    const managedAccounts = Object.fromEntries(accountProviders.map(provider => {
      const manual = settings.accounts?.[provider] ?? [];
      const excluded = new Set([...manual.map(account => account.home), cliHome(provider, env)]);
      return [provider, accounts[provider].profiles.filter(profile =>
        profile.kind === 'managed' && profile.login && !excluded.has(profile.home) &&
        !manual.some(account => account.id === profile.id))];
    }));
    return { ...settings, managedAccounts };
  }

  async function getActivity(effectiveSettings, providers, time) {
    const results = await Promise.all(providers.map(async provider => {
      const namedHomes = accountsForProvider(effectiveSettings, provider).filter(Boolean).map(account => account.home);
      const homes = new Set([cliHome(provider, env), ...namedHomes]);
      const timestamps = await Promise.all([...homes].map(home => recentProviderActivity(provider, home, time)));
      const lastActivity = Math.max(0, ...timestamps.filter(Number.isFinite));
      return lastActivity ? { provider, lastActivity } : null;
    }));
    return results.filter(Boolean).sort((a, b) => b.lastActivity - a.lastActivity);
  }

  function refresh({ settingsUpdate } = {}) {
    const action = refreshQueue.then(async () => {
      const accounts = await getAccounts(settingsUpdate?.accounts ?? settings.accounts);
      if (settingsUpdate) {
        const { claudeFullReset, autoRoute, ...quotaUpdate } = settingsUpdate;
        const signedIn = new Set(accounts.claude.profiles.map(profile => profile.accountUuid));
        if (Object.keys(claudeFullReset ?? {}).some(uuid => !signedIn.has(uuid))) return null;
        const { autoRoute: _routeState, ...storedSettings } = settings;
        const updated = {
          ...storedSettings, ...quotaUpdate, claudeFullReset: { ...settings.claudeFullReset, ...claudeFullReset },
        };
        writeState(directory, 'settings.json', updated);
        settings = updated;
        const routeWasEnabled = !isRouteOffPersisted(env);
        if (autoRoute !== undefined && autoRoute !== routeWasEnabled) {
          const marker = path.join(directory, 'route-off');
          if (autoRoute) rmSync(marker, { force: true });
          else writeFileSync(marker, '', { mode: 0o600, flag: 'wx' });
        }
      }
      const effectiveSettings = quotaSettings(accounts);
      const providers = enabledProviders(settings);
      quota = await readLiveQuota(effectiveSettings);
      const time = now();
      const claudeCredits = claudeFullResetAccounts(accounts.claude.profiles, settings.claudeFullReset, time);
      const accountForRow = row => row.accountId
        ? accounts[row.provider].profiles.find(profile => profile.id === row.accountId)
        : accounts[row.provider].current;
      quota = addClaudeFullReset(quota, accountForRow, claudeCredits, time);
      const shared = readAllQuota({ env, nowSec: Math.floor(time / 1000) });
      const autoRoute = !isRouteOffPersisted(env);
      const routeOptions = { ...settings, enabled: autoRoute };
      const routes = {
        claudeToAgy: { requested: 'agy', ...chooseRoute(shared, { ...routeOptions, requested: 'agy' }) },
        agyToClaude: { requested: 'claude', ...chooseRoute(shared, { ...routeOptions, requested: 'claude', agyPool: shared.agy.activePool || 'gemini' }) },
      };
      const enabledObservations = Object.fromEntries(Object.entries(observed).filter(([key]) =>
        key.startsWith(creditReminderPrefix) || key.startsWith(claudeCreditReminderPrefix) || providers.includes(key.split(':', 1)[0])));
      const quotaAlerts = planQuotaAlerts(quota, enabledObservations, { ...settings, baseline: Boolean(settingsUpdate), now: time });
      const next = settings.resetCreditReminders ? planResetCreditAlerts(quota, quotaAlerts.state, time) : { state: quotaAlerts.state, alerts: [] };
      next.alerts.unshift(...quotaAlerts.alerts);
      const previous = observed;
      if (next.alerts.length) notificationError = null;
      for (const alert of next.alerts) {
        try {
          await dispatchNotification({ ...alert, message: alert.message ?? alertMessage(alert, routes) });
        } catch (error) {
          notificationError = error.message;
          if (Object.hasOwn(previous, alert.key)) next.state[alert.key] = previous[alert.key];
          else delete next.state[alert.key];
          process.stderr.write(`Agent Usage · notification: ${error.message}\n`);
        }
      }
      if (JSON.stringify(next.state) !== JSON.stringify(observed)) writeState(directory, 'alerts.json', next.state);
      observed = next.state;
      const schedule = readState(directory, 'schedule.json', null);
      const checks = readState(directory, 'reset-checks.json', {});
      const due = (schedule?.times ?? []).filter(at => at <= time && !checks[at]);
      if (due.length) {
        const latest = due.at(-1);
        for (const at of due) {
          const isCurrent = at === latest && time - at < 5 * 60 * 1000;
          checks[at] = isCurrent && quota.length ? {
            checkedAt: time,
            windows: quota.map(row => ({
              provider: row.provider, ...(row.accountId ? { accountId: row.accountId } : {}),
              state: row.windows[0].state, resetsAt: row.windows[0].resetsAt,
            })),
          } : isCurrent ? { skippedAt: time } : { missedAt: time };
        }
        writeState(directory, 'reset-checks.json', checks);
      }
      for (const at of due) {
        if (!checks[at]?.checkedAt) continue;
        try {
          const formatted = new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          await dispatchNotification({ message: `Scheduled quota check at ${formatted}. ${quotaSummary(quota)}` });
        } catch (error) {
          notificationError = error.message;
          process.stderr.write(`Agent Usage · scheduled notification: ${error.message}\n`);
        }
      }
      const rows = quota.map(({ creditsObservedAt, ...row }) => {
        const { login, plan } = accountForRow(row) ?? {};
        return { ...row, login, plan };
      });
      const active = await getActivity(effectiveSettings, providers, time);
      const menu = buildMenuModel(rows, active);
      const discovered = Object.fromEntries(accountProviders.map(provider => [
        provider, accounts[provider].profiles.map(({ accountUuid, resetCache, ...profile }) => profile),
      ]));
      const { claudeFullReset, ...publicSettings } = settings;
      return {
        quota: rows, accounts: discovered, claudeFullResetAccounts: [...claudeCredits.values()], active, menu,
        settings: { ...publicSettings, autoRoute }, schedule, checks, notificationError, routes,
      };
    });
    refreshQueue = action.catch(error => process.stderr.write(`Agent Usage · refresh: ${error.message}\n`));
    return action;
  }

  async function getModels(days) {
    const effective = quotaSettings(await getAccounts());
    const providers = enabledProviders(effective);
    const profiles = providers.flatMap(provider => accountsForProvider(effective, provider).map(account => ({ provider, account })));
    const key = JSON.stringify(profiles.map(({ provider, account }) => [provider, account?.id, account?.home, account?.label]));
    const time = now();
    if (!loadingModels || loadingModels.key !== key || time - loadingModels.at > 60_000) {
      const promise = Promise.all(profiles.map(async ({ provider, account }) => {
        const calls = await readModelCalls({ env: accountEnvironment(provider, account, env), now: time, providers: [provider] });
        if (!account) return calls;
        return calls.map(call => ({
          ...call, id: JSON.stringify([account.id, call.id]),
          accountId: account.id, label: providerLabel(provider, account),
        }));
      })).then(results => results.flat()).catch(error => {
        if (loadingModels?.promise === promise) loadingModels = null;
        throw error;
      });
      loadingModels = { key, at: time, promise };
    }
    return loadingModels.promise.then(calls => aggregateCalls(calls, days, now()));
  }

  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) {
      sendJSON(response, 403, { error: 'Local requests only.' });
      return;
    }
    try {
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJSON(response, 200, { service: 'agent-usage', status: 'ready' });
      } else if (request.method === 'GET' && ['/api/quota', '/api/settings'].includes(url.pathname)) {
        sendJSON(response, 200, await refresh());
      } else if (request.method === 'GET' && url.pathname === '/api/models') {
        const days = Number(url.searchParams.get('days') ?? 7);
        if (![7, 30].includes(days)) { sendJSON(response, 400, { error: 'Expected 7 or 30 days.' }); return; }
        sendJSON(response, 200, { days, models: await getModels(days) });
      } else if (request.method === 'PUT' && url.pathname === '/api/settings') {
        const candidate = await parseSettings(request);
        if (!candidate) { sendJSON(response, 400, { error: 'Invalid quota settings.' }); return; }
        const updated = await refresh({ settingsUpdate: candidate });
        if (!updated) { sendJSON(response, 400, { error: 'Claude account is no longer signed in.' }); return; }
        sendJSON(response, 200, updated);
      } else if (request.method === 'POST' && ['/api/accounts/sign-in', '/api/accounts/remove'].includes(url.pathname)) {
        const body = await parseJSON(request);
        const removing = url.pathname === '/api/accounts/remove';
        const agySignIn = !removing && body?.provider === 'agy';
        if ((!agySignIn && !isManagedProvider(body?.provider)) || Object.keys(body).length !== (removing ? 3 : 1) ||
            (removing && (!isManagedId(body.id) || body.confirm !== true))) {
          sendJSON(response, 400, { error: 'Invalid account request.' });
          return;
        }
        if (removing) {
          const removed = removeManagedHome(directory, body.provider, body.id);
          sendJSON(response, removed ? 200 : 404, removed ? { removed: true } : { error: 'Managed account not found.' });
        } else {
          const { status, ...result } = agySignIn
            ? await openAgySignIn(env, openLogin)
            : await createManagedHome(directory, body.provider, env, openLogin);
          sendJSON(response, status, result);
        }
      } else if (request.method === 'POST' && url.pathname === '/api/notifications/test' && request.headers['content-type'] === 'application/json') {
        await dispatchNotification({ message: `Test notification · ${quotaSummary(quota)}` });
        sendJSON(response, 200, { sent: true });
      } else if (request.method === 'GET' && assets[url.pathname]) {
        const [file, contentType] = assets[url.pathname];
        const bytes = await readFile(new URL(`./${file}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': contentType });
        response.end(bytes);
      } else {
        sendJSON(response, 404, { error: 'Route not found.' });
      }
    } catch (error) {
      process.stderr.write(`Agent Usage · request: ${error.message}\n`);
      if (!response.headersSent) sendJSON(response, 500, { error: 'Could not read local usage data.' });
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const interval = setInterval(() => { void refresh().catch(() => {}); }, 15_000);
  server.once('close', () => clearInterval(interval));
  void refresh().catch(() => {});
  return server;
}
