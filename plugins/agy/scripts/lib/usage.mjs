import fs from "node:fs";
import path from "node:path";

const USAGE_FIELDS = ["input_tokens", "output_tokens", "thinking_tokens", "cache_read_tokens", "total_tokens"];

// `agy --output-format json` ends stdout with one JSON object (verified on agy
// 1.5.16). Anything else, e.g. an older agy printing plain text, returns null
// so callers fall back to the raw output.
export function parseAgyJsonOutput(stdout) {
  const text = String(stdout ?? "").trim();
  const start = text.lastIndexOf("\n{");
  const candidate = start >= 0 ? text.slice(start + 1) : text;
  if (!candidate.startsWith("{")) return null;
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("response" in parsed || "status" in parsed)) {
    return null;
  }
  return {
    response: typeof parsed.response === "string" ? parsed.response : "",
    status: parsed.status ?? null,
    error: parsed.error ?? null,
    finishedReason: parsed.finished_reason ?? null,
    conversationId: parsed.conversation_id ?? null,
    durationSeconds: Number(parsed.duration_seconds) || 0,
    numTurns: Number(parsed.num_turns) || 0,
    tokens: normalizeTokens(parsed.usage)
  };
}

function normalizeTokens(usage) {
  const tokens = {};
  for (const field of USAGE_FIELDS) {
    tokens[field] = Number(usage?.[field]) || 0;
  }
  return tokens;
}

// Hand-offs make several agy calls; the job records their sum.
export function sumUsage(entries) {
  const list = entries.filter(Boolean);
  if (list.length === 0) return null;
  const tokens = normalizeTokens(null);
  let durationSeconds = 0;
  let numTurns = 0;
  for (const entry of list) {
    for (const field of USAGE_FIELDS) tokens[field] += entry.tokens?.[field] ?? 0;
    durationSeconds += entry.durationSeconds ?? 0;
    numTurns += entry.numTurns ?? 0;
  }
  return { ...list.at(-1), tokens, durationSeconds, numTurns, calls: list.length };
}

export function formatUsage(usage) {
  if (!usage?.tokens) return "";
  const n = (value) => Number(value).toLocaleString("en-US");
  const t = usage.tokens;
  const parts = [
    `${n(t.input_tokens)} in / ${n(t.output_tokens + t.thinking_tokens)} out`,
    `cache ${n(t.cache_read_tokens)}`,
    `${usage.model ?? "default model"}`
  ];
  if (usage.durationSeconds) parts.push(`${usage.durationSeconds.toFixed(1)}s`);
  if (usage.calls > 1) parts.push(`${usage.calls} agy calls`);
  return parts.join(" · ");
}

export function appendUsageLog(stateDir, record) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(path.join(stateDir, "usage.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}
