#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defaultPort, startServer } from './server.mjs';
import { defaultSettings, enabledProviders, forecastResetChecks, loadSettings } from './quota.mjs';
import { readState, stateDirectory, writeState } from './state.mjs';
import { installLaunchAgents, launchAgentPaths, startInstalledServer, uninstallUsage } from './launch-agents.mjs';
import { requirePersistentCheckout, serverCommand, stableNodePath, writeLauncher } from './launcher.mjs';

const [command = 'ensure-running', ...options] = process.argv.slice(2);
const [input, resetCount] = options.filter(option => option !== '--allow-worktree');
const allowWorktree = options.includes('--allow-worktree');
const port = Number(process.env.AGENT_USAGE_PORT || defaultPort);
const origin = `http://127.0.0.1:${port}`;
const directory = stateDirectory();

async function ready() {
  try {
    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(300) });
    return health.ok && (await health.json()).service === 'agent-usage';
  } catch {
    return false;
  }
}

async function ensureRunning() {
  requirePersistentCheckout({ allowWorktree });
  if (await ready()) return;
  const managed = startInstalledServer();
  if (!managed) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const log = openSync(path.join(directory, 'server.log'), 'a', 0o600);
    try {
      const { command, args } = serverCommand({ execPath: process.execPath, pathEnv: process.env.PATH, cli: fileURLToPath(import.meta.url) });
      const child = spawn(command, args, { detached: true, stdio: ['ignore', log, log] });
      child.unref();
    } finally {
      closeSync(log);
    }
  }
  for (let attempt = 0; attempt < (managed ? 100 : 24); attempt++) {
    if (await ready()) return;
    await delay(100);
  }
  throw new Error(`Agent Usage could not start on ${origin}. See ${path.join(directory, 'server.log')}.`);
}

try {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('AGENT_USAGE_PORT must be a valid TCP port.');
  switch (command) {
    case 'serve': {
      await startServer({ port });
      console.log(`Agent Usage listening on ${origin}`);
      break;
    }
    case 'ensure-running':
      await ensureRunning();
      if (input !== '--quiet') console.log(origin);
      break;
    case 'health':
      if (!await ready()) throw new Error(`Agent Usage health check failed at ${origin}/health.`);
      console.log(`Agent Usage is ready at ${origin}`);
      break;
    case 'on-provider-start':
      if (!Object.hasOwn(defaultSettings.providers, input)) throw new Error('Unknown provider. Use claude, agy, copilot, or codex.');
      if (enabledProviders(loadSettings(directory)).includes(input)) await ensureRunning();
      break;
    case 'install-launcher':
      requirePersistentCheckout({ allowWorktree });
      console.log(writeLauncher({
        file: launchAgentPaths().launcher,
        node: stableNodePath({ execPath: process.execPath, pathEnv: process.env.PATH }),
        cli: fileURLToPath(import.meta.url),
      }));
      break;
    case 'check-install-location':
      requirePersistentCheckout({ allowWorktree });
      break;
    case 'install-launch-agents':
    case 'install-menubar':
      requirePersistentCheckout({ allowWorktree });
      installLaunchAgents(command === 'install-menubar' ? ['menubar'] : ['server', 'reset'], { allowWorktree });
      break;
    case 'uninstall':
      uninstallUsage();
      console.log('Uninstalled Agent Usage. Settings and quota history are kept.');
      break;
    case 'schedule': {
      if (!input || !/(?:Z|[+-]\d\d:\d\d)$/.test(input)) throw new Error('Pass the observed reset as an ISO timestamp with a timezone.');
      const count = Number(resetCount ?? 6);
      const anchor = Date.parse(input);
      const times = forecastResetChecks(anchor, count);
      writeState(directory, 'schedule.json', { anchor, times });
      console.log(JSON.stringify(times.map(time => new Date(time).toISOString())));
      break;
    }
    case 'check-reset': {
      if (input === '--scheduled') {
        const times = readState(directory, 'schedule.json', null)?.times ?? [];
        const now = Date.now();
        if (!times.some(time => now >= time && now - time < 5 * 60 * 1000)) break;
      }
      await ensureRunning();
      const check = await fetch(`${origin}/api/quota`, { signal: AbortSignal.timeout(20_000) });
      if (!check.ok) throw new Error(`Quota check failed: HTTP ${check.status}`);
      const { quota } = await check.json();
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        windows: quota.map(row => ({
          provider: row.provider, ...(row.accountId ? { accountId: row.accountId } : {}),
          windows: row.windows.map(({ short, state, resetsAt }) => ({ short, state, resetsAt })),
        })),
      }));
      break;
    }
    default:
      throw new Error('Usage: agent-usage [ensure-running|health|on-provider-start <provider>|serve|schedule <reset-ISO> [rounds]|check-reset|install-launcher|uninstall]');
  }
} catch (error) {
  if (command === 'serve' && error.code === 'EADDRINUSE' && await ready()) process.exitCode = 0;
  else {
    console.error(error.message);
    process.exitCode = 1;
  }
}
