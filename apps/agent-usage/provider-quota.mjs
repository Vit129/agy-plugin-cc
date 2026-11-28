import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const maxOutput = 512 * 1024;
const agyBuckets = { 'gemini-5h': '5h', 'gemini-weekly': '7d' };

export function executable(name, env) {
  return env[`AGENT_USAGE_${name.toUpperCase()}_BIN`] || [
    path.join(os.homedir(), '.local', 'bin', name),
    path.join(os.homedir(), '.volta', 'bin', name),
    `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`,
  ].find(existsSync) || name;
}

function windowValue(remaining, reset, now) {
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
  const resetMs = Date.parse(reset);
  if (Number.isFinite(resetMs) && resetMs <= now) return null;
  return { remaining, resetsAt: Number.isFinite(resetMs) ? Math.floor(resetMs / 1000) : null };
}

export function parseAgyQuota(report, now) {
  if (report?.status !== 'SUCCESS' || report.command?.name !== 'usage') return null;
  const windows = {};
  for (const group of report.command.data?.groups ?? []) {
    for (const bucket of group.buckets ?? []) {
      const window = agyBuckets[bucket.id];
      if (!window || bucket.disabled || !Number.isFinite(bucket.remaining_fraction)) continue;
      windows[window] = windowValue(bucket.remaining_fraction * 100, bucket.reset_time, now);
    }
  }
  return Object.values(windows).some(Boolean) ? { captured: now, windows } : null;
}

export function parseCopilotQuota(report, now) {
  const quota = report?.quotaSnapshots?.premium_interactions;
  if (!quota || quota.isUnlimitedEntitlement) return null;
  const reported = Date.parse(quota.resetDate);
  // Current Copilot CLI builds can return an observation time in resetDate.
  const reset = reported > now + 60_000 ? quota.resetDate : null;
  const monthly = windowValue(quota.remainingPercentage, reset, now);
  if (!monthly) return null;
  const captured = Number.isFinite(reported) && reported <= now ? reported : now;
  const cycle = new Date(now).toISOString().slice(0, 7);
  return { captured, windows: { monthly: { ...monthly, cycle } } };
}

export function parseCodexQuota(report, now) {
  const quota = report?.rateLimitsByLimitId?.codex ?? report?.rateLimits;
  const windows = {};
  for (const window of [quota?.primary, quota?.secondary]) {
    const key = { 300: '5h', 10080: '7d' }[window?.windowDurationMins];
    if (!key || !Number.isFinite(window.usedPercent) || window.usedPercent < 0) continue;
    const resetsAt = Number.isFinite(window.resetsAt) && window.resetsAt > 0 ? window.resetsAt : null;
    if (resetsAt !== null && resetsAt * 1000 <= now) continue;
    windows[key] = { remaining: Math.max(0, 100 - window.usedPercent), resetsAt };
  }
  const summary = report?.rateLimitResetCredits;
  if (Number.isSafeInteger(summary?.availableCount) && summary.availableCount >= 0) {
    const text = value => typeof value === 'string' ? value : null;
    const credits = Array.isArray(summary.credits) ? summary.credits
      .filter(credit => typeof credit?.id === 'string' && credit.id.length &&
        (credit.expiresAt === null || (Number.isSafeInteger(credit.expiresAt) && credit.expiresAt >= 0 && credit.expiresAt <= 8.64e12)))
      .map(({ id, resetType, status, grantedAt, expiresAt, title, description }) => ({
        id, resetType: text(resetType), status: text(status) ?? 'unknown',
        grantedAt: Number.isFinite(grantedAt) ? grantedAt : null, expiresAt,
        title: text(title), description: text(description),
      })) : null;
    return { captured: now, windows, rateLimitResetCredits: { availableCount: summary.availableCount, credits } };
  }
  return Object.keys(windows).length ? { captured: now, windows } : null;
}

async function readAgy(env) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-agy-'));
  try {
    for (const tool of ['open', 'xdg-open']) await writeFile(path.join(directory, tool), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    const commandEnv = { ...env, AGY_CLI_DISABLE_AUTO_UPDATE: 'true', BROWSER: path.join(directory, 'open'), PATH: `${directory}${path.delimiter}${env.PATH ?? '/usr/bin:/bin'}` };
    const result = await run(executable('agy', env), ['-p', '/usage', '--output-format', 'json'], { cwd: directory, env: commandEnv, timeout: 18_000, maxBuffer: maxOutput });
    return JSON.parse(result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readCopilot(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable('copilot', env), ['--headless', '--no-auto-update', '--stdio', '--disable-client-telemetry', '--disable-builtin-mcps'], { cwd: root, env, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = Buffer.alloc(0);
    let finished = false;
    function done(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(value);
    }
    function send(id, method, params) {
      if (finished) return;
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
    }
    const timeout = setTimeout(() => done(new Error('Copilot quota timed out')), 18_000);
    child.on('error', done);
    child.stdin.on('error', done);
    child.on('close', () => done(new Error('Copilot quota connection closed')));
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        if (buffer.length > maxOutput) throw new Error('Copilot quota response too large');
        while (!finished) {
          const end = buffer.indexOf('\r\n\r\n');
          if (end < 0) return;
          const match = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString());
          if (!match || Number(match[1]) > maxOutput) throw new Error('Invalid Copilot quota response');
          const next = end + 4 + Number(match[1]);
          if (buffer.length < next) return;
          const message = JSON.parse(buffer.subarray(end + 4, next));
          buffer = buffer.subarray(next);
          if (message.id !== 1 && message.id !== 2) continue;
          if (!message.result) throw new Error(`Copilot quota RPC failed (${message.error?.code ?? 'no result'})`);
          if (message.id === 1) send(2, 'account.getQuota', {});
          if (message.id === 2) done(null, message.result);
        }
      } catch (error) { done(error); }
    });
    send(1, 'connect', { supportedTaskKinds: ['agent', 'client', 'shell'] });
  });
}

function readCodex(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable('codex', env), ['app-server', '--listen', 'stdio://'], { cwd: root, env, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let finished = false;
    let bytes = 0;
    const timeout = setTimeout(() => finish(new Error('Codex quota timed out')), 18_000);
    function finish(error, result) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      lines.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(result);
    }
    function send(body) {
      if (!finished) child.stdin.write(JSON.stringify(body) + '\n');
    }
    child.on('error', finish);
    child.stdin.on('error', finish);
    child.on('close', () => finish(new Error('Codex quota connection closed')));
    child.stdout.prependListener('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxOutput) finish(new Error('Codex quota response too large'));
    });
    lines.on('line', line => {
      if (finished) return;
      try {
        const response = JSON.parse(line);
        if (response.id !== 1 && response.id !== 2) return;
        if (!response.result) throw new Error(`Codex quota RPC failed (${response.error?.code ?? 'no result'})`);
        if (response.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read' });
        } else {
          finish(null, response.result);
        }
      } catch (error) {
        finish(error);
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agent_usage', version: '1' } } });
  });
}

export async function probeNativeQuota(provider, env, now = Date.now) {
  if (provider === 'agy') {
    const report = await readAgy(env);
    return parseAgyQuota(report, now());
  }
  if (provider === 'copilot') {
    const report = await readCopilot(env);
    return parseCopilotQuota(report, now());
  }
  if (provider === 'codex') {
    const report = await readCodex(env);
    return parseCodexQuota(report, now());
  }
  const helper = fileURLToPath(new URL('./claude-usage.py', import.meta.url));
  const result = await run(executable('python3', env), [helper, executable('claude', env)], { cwd: root, env, timeout: 20_000, maxBuffer: maxOutput });
  const data = JSON.parse(result.stdout);
  if (data.error) throw Object.assign(new Error(`Claude /usage: ${data.error}`), { code: data.error });
  const captured = now();
  const windows = Object.fromEntries(['5h', '7d'].map(key => [key, windowValue(data[key]?.remaining, data[key]?.reset, captured)]));
  return Object.values(windows).some(Boolean) ? { captured, windows } : null;
}
