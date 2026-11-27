import fs from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const DAY_MS = 86_400_000;
const modelName = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const count = value => Number.isFinite(value) && value >= 0 ? value : 0;

function modelCall({ id, provider, model, timestamp, tokens, ok }) {
  const at = typeof timestamp === 'number' ? timestamp * (timestamp < 1e12 ? 1000 : 1) : Date.parse(timestamp);
  if (!id || typeof model !== 'string' || !modelName.test(model) || !Number.isFinite(at)) return null;
  return { id: `${provider}:${id}`, provider, model, at, tokens, ok, durationMs: null };
}

export function normalizeClaudeCall(record) {
  const usage = record?.message?.usage;
  if (record?.type !== 'assistant' || !usage) return null;
  return modelCall({
    id: record.requestId || record.message.id,
    provider: 'claude',
    model: record.message.model,
    timestamp: record.timestamp,
    tokens: count(usage.input_tokens) + count(usage.cache_read_input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.output_tokens),
    ok: !record.isApiErrorMessage,
  });
}

export function normalizeAgyCall(record, conversation) {
  if (record?.type !== 'PLANNER_RESPONSE' || !Number.isInteger(record.step_index)) return null;
  return modelCall({
    id: `${conversation}:${record.step_index}`,
    provider: 'agy',
    model: record.model,
    timestamp: record.created_at,
    tokens: count(record.input_tokens) + count(record.output_tokens),
    ok: record.status === 'DONE' ? true : ['ERROR', 'FAILED', 'CANCELED', 'CANCELLED'].includes(record.status) ? false : null,
  });
}

export function aggregateCalls(calls, days, now = Date.now()) {
  const since = now - days * DAY_MS;
  const unique = new Map();
  for (const call of calls) {
    if (!call || call.at < since || call.at > now) continue;
    const prior = unique.get(call.id);
    if (!prior || call.tokens >= prior.tokens) unique.set(call.id, call);
  }
  const models = new Map();
  for (const call of unique.values()) {
    const key = `${call.provider}:${call.model}`;
    const totals = models.get(key) ?? { provider: call.provider, model: call.model, calls: 0, finished: 0, success: 0, tokens: 0, times: 0, durationMs: 0 };
    totals.calls++;
    totals.tokens += call.tokens;
    if (typeof call.ok === 'boolean') totals.finished++;
    if (call.ok) totals.success++;
    if (Number.isFinite(call.durationMs)) {
      totals.times++;
      totals.durationMs += call.durationMs;
    }
    models.set(key, totals);
  }
  return [...models.values()].map(({ provider, model, calls, finished, success, tokens, times, durationMs }) => ({
    provider, model, calls, tokens, okPct: finished ? Math.round(100 * success / finished) : null, avgMs: times ? durationMs / times : null,
  })).sort((first, second) => second.tokens - first.tokens);
}

async function directories(root) {
  try {
    return (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readRecentLines(file, since, accept) {
  try {
    if ((await stat(file)).mtimeMs < since) return;
    const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      let data;
      try { data = JSON.parse(line); } catch { continue; }
      accept(data);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function readModelCalls({ env = process.env, now = Date.now() } = {}) {
  const since = now - 30 * DAY_MS;
  const userHome = os.homedir();
  const roots = {
    claude: path.join(env.CLAUDE_CONFIG_DIR || path.join(userHome, '.claude'), 'projects'),
    agy: path.join(env.AGY_HOME || path.join(userHome, '.gemini', 'antigravity-cli'), 'brain'),
  };
  const calls = [];
  const add = call => { if (call && call.at >= since) calls.push(call); };
  await Promise.all([
    (async () => {
      for (const folder of await directories(roots.claude)) {
        const project = path.join(roots.claude, folder);
        let entries;
        try { entries = await readdir(project, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
          await readRecentLines(path.join(project, entry.name), since, line => add(normalizeClaudeCall(line)));
        }
      }
    })(),
    (async () => {
      for (const conversation of await directories(roots.agy)) {
        const transcript = path.join(roots.agy, conversation, '.system_generated', 'logs', 'transcript.jsonl');
        await readRecentLines(transcript, since, line => add(normalizeAgyCall(line, conversation)));
      }
    })(),
  ]);
  return calls;
}
