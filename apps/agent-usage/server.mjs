import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { defaultSettings, planQuotaAlerts, validSettings } from './quota.mjs';
import { createLiveQuotaReader } from './live-quota.mjs';
import { aggregateCalls, readModelCalls } from './usage.mjs';
import { readState, stateDirectory, writeState } from './state.mjs';

export const defaultPort = 43127;
const run = promisify(execFile);
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/dashboard.mjs': ['dashboard.mjs', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

async function notifyMacOS(alert) {
  if (process.platform !== 'darwin') throw new Error('macOS notifications require macOS.');
  await run('/usr/bin/osascript', ['-e', 'on run argv\n display notification (item 1 of argv) with title "Agent Usage"\nend run', `${alert.provider} ${alert.short}: ${Math.floor(alert.remaining)}% remaining (${alert.level})`], { timeout: 5000 });
}

function sendJSON(response, status, object) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(object));
}

async function parseSettings(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') return null;
  let text = '';
  for await (const part of request) {
    text += part;
    if (Buffer.byteLength(text) > 2048) return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (!validSettings(parsed)) return null;
    return Object.fromEntries(Object.keys(defaultSettings).map(key => [key, parsed[key]]));
  } catch {
    return null;
  }
}

export async function startServer({ port = defaultPort, env = process.env, notify = notifyMacOS, now = Date.now, probeQuota } = {}) {
  const directory = stateDirectory(env);
  const savedSettings = readState(directory, 'settings.json', defaultSettings);
  let settings = validSettings(savedSettings) ? savedSettings : defaultSettings;
  let observed = readState(directory, 'alerts.json', {}) ?? {};
  const readLiveQuota = createLiveQuotaReader({ env, now, probe: probeQuota });
  let quota = [];
  let notificationError = null;
  let refreshQueue = Promise.resolve();
  let modelsLoadedAt = 0;
  let loadingModels;

  function refresh({ settingsUpdate } = {}) {
    const action = refreshQueue.then(async () => {
      if (settingsUpdate) {
        writeState(directory, 'settings.json', settingsUpdate);
        settings = settingsUpdate;
      }
      quota = await readLiveQuota(settings);
      const time = now();
      const next = planQuotaAlerts(quota, observed, { baseline: Boolean(settingsUpdate) });
      const previous = observed;
      if (next.alerts.length) notificationError = null;
      for (const alert of next.alerts) {
        try {
          await notify(alert);
        } catch (error) {
          notificationError = error.message;
          next.state[alert.key] = previous[alert.key];
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
          checks[at] = isCurrent ? {
            checkedAt: time,
            windows: quota.map(row => ({ provider: row.provider, state: row.windows[0].state, resetsAt: row.windows[0].resetsAt })),
          } : { missedAt: time };
        }
        writeState(directory, 'reset-checks.json', checks);
      }
      return { quota, settings, schedule, checks, notificationError };
    });
    refreshQueue = action.catch(error => process.stderr.write(`Agent Usage · refresh: ${error.message}\n`));
    return action;
  }

  function getModels(days) {
    if (!loadingModels || now() - modelsLoadedAt > 60_000) {
      modelsLoadedAt = now();
      loadingModels = readModelCalls({ env, now: modelsLoadedAt }).catch(error => {
        loadingModels = null;
        throw error;
      });
    }
    return loadingModels.then(calls => aggregateCalls(calls, days, now()));
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
      } else if (request.method === 'GET' && url.pathname === '/api/quota') {
        sendJSON(response, 200, await refresh());
      } else if (request.method === 'GET' && url.pathname === '/api/models') {
        const days = Number(url.searchParams.get('days') ?? 7);
        if (![7, 30].includes(days)) { sendJSON(response, 400, { error: 'Expected 7 or 30 days.' }); return; }
        sendJSON(response, 200, { days, models: await getModels(days) });
      } else if (request.method === 'PUT' && url.pathname === '/api/settings') {
        const candidate = await parseSettings(request);
        if (!candidate) { sendJSON(response, 400, { error: 'Invalid quota settings.' }); return; }
        sendJSON(response, 200, await refresh({ settingsUpdate: candidate }));
      } else if (request.method === 'GET' && assets[url.pathname]) {
        const [file, contentType] = assets[url.pathname];
        const bytes = await readFile(new URL(`./ui/${file}`, import.meta.url));
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
