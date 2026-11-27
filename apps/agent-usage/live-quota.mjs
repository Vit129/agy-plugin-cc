import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { estimateCapacity, levelFor, readQuota } from './quota.mjs';

const run = promisify(execFile);
const commands = { claude: 'claude', agy: 'antigravity' };
const windowsMinutes = { '5h': 300, '7d': 10080 };
const geminiIds = { '5h': 'antigravity-quota-summary-gemini-5h', '7d': 'antigravity-quota-summary-gemini-weekly' };
const freshFor = 5 * 60_000;
const normalInterval = 4 * 60_000;
const retryInterval = 60_000;

function normalizedWindow(raw, now) {
  if (!raw || raw.usageKnown === false || !Number.isFinite(raw.usedPercent) || raw.usedPercent < 0 || raw.usedPercent > 100) return null;
  const parsedReset = Date.parse(raw.resetsAt);
  if (Number.isFinite(parsedReset) && parsedReset <= now) return null;
  return { remaining: 100 - raw.usedPercent, resetsAt: Number.isFinite(parsedReset) ? parsedReset / 1000 : null };
}

export function parseCodexBarQuota(payload, provider, now = Date.now()) {
  const matching = (Array.isArray(payload) ? payload : [payload]).find(row => row?.provider === commands[provider] && row.usage);
  if (!matching) return null;
  const { usage } = matching;
  let captured = Date.parse(usage.updatedAt);
  if (Number.isFinite(matching.ageSeconds)) captured = now - matching.ageSeconds * 1000;
  if (!Number.isFinite(captured)) captured = now;
  captured = Math.min(captured, now);
  const windows = Object.fromEntries(Object.entries(windowsMinutes).map(([short, minutes]) => {
    const candidates = [usage.primary, usage.secondary];
    const group = (Array.isArray(usage.extraRateWindows) ? usage.extraRateWindows : []).find(extra => extra?.id === geminiIds[short]);
    const raw = provider === 'agy' ? group?.window : candidates.find(window => window?.windowMinutes === minutes);
    return [short, group?.usageKnown === false ? null : normalizedWindow(raw, now)];
  }));
  return Object.values(windows).some(Boolean) ? { captured, windows } : null;
}

async function probeCodexBar(provider, env) {
  const binary = env.AGENT_USAGE_CODEXBAR || ['/opt/homebrew/bin/codexbar', '/usr/local/bin/codexbar'].find(existsSync) || 'codexbar';
  const result = await run(binary, ['usage', '--provider', commands[provider], '--source', 'cli', '--json'], { env, timeout: 15_000, maxBuffer: 512 * 1024 });
  return JSON.parse(result.stdout);
}

export function createLiveQuotaReader({ env = process.env, now = Date.now, probe = probeCodexBar } = {}) {
  const cache = new Map();
  return async function readLiveQuota(settings) {
    const rows = readQuota(settings, { env, nowSec: Math.floor(now() / 1000) });
    return Promise.all(rows.map(async row => {
      if (row.windows.every(window => window.state === 'live')) return row;
      const prior = cache.get(row.provider);
      let sample = prior?.sample;
      const expired = Object.values(sample?.windows ?? {}).some(window => window?.resetsAt !== null && window?.resetsAt * 1000 <= now());
      const wait = prior?.complete && !expired ? normalInterval : retryInterval;
      if (!prior || now() - prior.attemptedAt >= wait) {
        let complete = false;
        try {
          const next = parseCodexBarQuota(await probe(row.provider, env), row.provider, now());
          if (next) {
            sample = next;
            complete = Object.values(next.windows).every(Boolean);
          }
        } catch (error) {
          const details = typeof error.code === 'number' ? `exit ${error.code}` : error.code || (error.killed ? 'timeout' : error.name);
          if (env === process.env) process.stderr.write(`Agent Usage · ${row.provider} quota probe: ${details}\n`);
        }
        cache.set(row.provider, { sample, complete, attemptedAt: now() });
      }
      if (!sample) return row;
      const time = now();
      const state = time - sample.captured <= freshFor ? 'live' : 'aging';
      let usedFallback = false;
      const windows = row.windows.map(window => {
        const replacement = sample.windows[window.short];
        if (window.state === 'live' || !replacement || (replacement.resetsAt !== null && replacement.resetsAt * 1000 <= time)) return window;
        if (state === 'aging' && window.remaining !== null && row.capturedAt * 1000 > sample.captured) return window;
        usedFallback = true;
        return { ...window, ...replacement, state, level: levelFor(replacement.remaining, settings), source: 'codexbar' };
      });
      if (!usedFallback) return row;
      return { ...row, windows, capturedAt: Math.max(row.capturedAt ?? 0, Math.floor(sample.captured / 1000)), capacity: estimateCapacity(windows, settings) };
    }));
  };
}
