import fs from "node:fs";
import path from "node:path";

const USAGE_FIELDS = ["input_tokens", "output_tokens", "thinking_tokens", "cache_read_tokens", "total_tokens"];

// `agy --output-format stream-json` prints one JSON event per line (verified on
// agy 1.5.16): `init`, `step_update`..., then `result`, whose body matches the
// `--output-format json` envelope. Both shapes are accepted. A stream cut off
// before `result` still yields the reply and token counts seen so far. Anything
// else, e.g. an older agy printing plain text, returns null so callers fall back
// to the raw output.
export function parseAgyJsonOutput(stdout) {
  const text = String(stdout ?? "").trim();
  const events = text.split("\n").map(parseJsonLine).filter(Boolean);
  const result = events.findLast((e) => e.event === "result" && e.result && typeof e.result === "object");
  if (result) return fromEnvelope(result.result);
  const partial = fromPartialStream(events);
  if (partial) return partial;

  const start = text.lastIndexOf("\n{");
  const candidate = start >= 0 ? text.slice(start + 1) : text;
  const parsed = parseJsonLine(candidate);
  if (!parsed || !("response" in parsed || "status" in parsed)) return null;
  return fromEnvelope(parsed);
}

function parseJsonLine(line) {
  const candidate = line.trim();
  if (!candidate.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function fromEnvelope(parsed) {
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

function fromPartialStream(events) {
  const init = events.find((e) => e.event === "init");
  const steps = events.filter((e) => e.event === "step_update" && e.step_update).map((e) => e.step_update);
  if (!init && steps.length === 0) return null;
  const tokens = normalizeTokens(null);
  let response = "";
  for (const step of steps) {
    if (step.step_type === "agent_response" && typeof step.text_delta === "string") response += step.text_delta;
    if (step.usage) for (const field of USAGE_FIELDS) tokens[field] += Number(step.usage[field]) || 0;
  }
  return {
    response,
    status: null,
    error: "agy stopped before reporting a result",
    finishedReason: null,
    conversationId: init?.conversation_id ?? steps[0]?.conversation_id ?? null,
    durationSeconds: 0,
    numTurns: 0,
    tokens
  };
}

// A one-line progress note for a stream-json line, or null when the line is
// not a tool starting.
export function progressFromStreamLine(line) {
  const step = parseJsonLine(line)?.step_update;
  if (!step || step.step_type !== "tool" || step.state !== "ACTIVE") return null;
  const name = step.tool_info?.name ?? step.tool_name ?? "tool";
  const params = step.tool_info?.parameters ?? {};
  const detail = params.CommandLine ?? Object.values(params).find((v) => typeof v === "string") ?? "";
  return detail ? `${name}: ${String(detail).split("\n")[0].slice(0, 120)}` : name;
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
