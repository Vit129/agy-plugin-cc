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

export function normalizeCopilotCall(record) {
  if (record?.type !== 'session.usage_record') return null;
  const usage = record.data?.usage;
  if (!usage) return null;
  const call = modelCall({
    id: usage.providerCallId || usage.accounting?.usageId || record.id,
    provider: 'copilot',
    model: usage.model,
    timestamp: record.timestamp,
    tokens: count(usage.inputTokens) + count(usage.outputTokens),
    ok: usage.finishReason ? !['error', 'canceled', 'cancelled'].includes(usage.finishReason) : null,
  });
  if (call && Number.isFinite(usage.duration) && usage.duration >= 0) call.durationMs = usage.duration;
  return call;
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
    const key = JSON.stringify([call.provider, call.accountId, call.model]);
    const totals = models.get(key) ?? { provider: call.provider, accountId: call.accountId, label: call.label, model: call.model, calls: 0, finished: 0, success: 0, tokens: 0, times: 0, durationMs: 0 };
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
  return [...models.values()].map(({ provider, accountId, label, model, calls, finished, success, tokens, times, durationMs }) => ({
    provider, ...(accountId ? { accountId, label } : {}), model, calls, tokens,
    okPct: finished ? Math.round(100 * success / finished) : null, avgMs: times ? durationMs / times : null,
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

async function readCodexCalls(root, since, add) {
  let entries;
  try {
    entries = await readdir(root, { recursive: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries.filter(name => /^rollout-.*\.jsonl$/.test(path.basename(name)))) {
    let turn;
    let previousTotal;
    await readRecentLines(path.join(root, entry), since, record => {
      const payload = record?.payload;
      if (record?.type === 'turn_context' && payload?.turn_id) {
        if (turn?.id !== payload.turn_id) turn = { id: payload.turn_id, model: payload.model, tokens: 0 };
      } else if (record?.type === 'event_msg' && payload?.type === 'token_count') {
        const total = payload.info?.total_token_usage?.total_tokens;
        if (!Number.isFinite(total)) return;
        const tokens = total >= previousTotal ? total - previousTotal : count(payload.info?.last_token_usage?.total_tokens);
        previousTotal = total;
        if (turn) turn.tokens += tokens;
      } else if (record?.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(payload?.type) &&
        turn?.id === payload.turn_id && turn.tokens > 0) {
        const call = modelCall({
          ...turn, provider: 'codex', timestamp: record.timestamp,
          ok: payload.type === 'task_complete',
        });
        if (call && Number.isFinite(payload.duration_ms) && payload.duration_ms >= 0) call.durationMs = payload.duration_ms;
        add(call);
        turn = undefined;
      }
    });
  }
}

export async function readModelCalls({ env = process.env, now = Date.now(), providers = ['claude', 'agy', 'copilot', 'codex'] } = {}) {
  const since = now - 30 * DAY_MS;
  const userHome = os.homedir();
  const roots = {
    claude: path.join(env.CLAUDE_CONFIG_DIR || path.join(userHome, '.claude'), 'projects'),
    agy: path.join(env.AGY_HOME || path.join(userHome, '.gemini', 'antigravity-cli'), 'brain'),
    copilot: path.join(env.COPILOT_HOME || path.join(userHome, '.copilot'), 'session-state'),
    codex: path.join(env.CODEX_HOME || path.join(userHome, '.codex'), 'sessions'),
  };
  const calls = [];
  const add = call => { if (call && call.at >= since) calls.push(call); };
  await Promise.all([
    (async () => {
      if (!providers.includes('claude')) return;
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
      if (!providers.includes('agy')) return;
      for (const conversation of await directories(roots.agy)) {
        const transcript = path.join(roots.agy, conversation, '.system_generated', 'logs', 'transcript.jsonl');
        await readRecentLines(transcript, since, line => add(normalizeAgyCall(line, conversation)));
      }
    })(),
    (async () => {
      if (!providers.includes('copilot')) return;
      for (const session of await directories(roots.copilot)) {
        const events = path.join(roots.copilot, session, 'events.jsonl');
        await readRecentLines(events, since, line => add(normalizeCopilotCall(line)));
      }
    })(),
    providers.includes('codex') ? readCodexCalls(roots.codex, since, add) : undefined,
  ]);
  return calls;
}
