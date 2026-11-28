import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { classifyQuotaError, recordCooldown } from "./quota-state.mjs";

export const RECURSION_GUARD_ENV = "CC_PLUGIN_AGY_ACTIVE";
const DEFAULT_READONLY_TOOLS = "Read,Grep,Glob";

export function selectClaudeModel({
  kind = "ask",
  promptLength = 0,
  deep = false,
  edit = false,
  model = null,
  effort = null,
  env = process.env
} = {}) {
  if (model) {
    return { model, effort: effort ?? null, tier: "explicit", auto: false };
  }
  if (kind === "adversarial-review" || deep || promptLength > 10_000) {
    return {
      model: env.CC_MODEL_LARGE || "opus",
      effort: effort ?? "high",
      tier: "large",
      auto: true
    };
  }
  if (kind === "ask" && !edit && promptLength < 2_000) {
    return {
      model: env.CC_MODEL_SMALL || "haiku",
      effort: effort ?? "low",
      tier: "small",
      auto: true
    };
  }
  return {
    model: env.CC_MODEL_MEDIUM || "sonnet",
    effort: effort ?? "medium",
    tier: "medium",
    auto: true
  };
}

export function resolveClaudeBinary(env = process.env) {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude"
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "claude";
}

export function buildClaudeArgs(options = {}) {
  const args = ["-p", "--output-format", "json"];

  // Keep throwaway one-shots off disk unless resuming or explicitly persisting for multi-turn.
  if (options.resume) {
    args.push("--resume", String(options.resume));
  } else if (!options.persist) {
    args.push("--no-session-persistence");
  }

  if (!options.withMcp) {
    args.push("--strict-mcp-config");
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }

  if (options.noTools) {
    args.push("--tools", "");
  } else if (options.edit) {
    args.push("--permission-mode", "acceptEdits");
  } else {
    args.push("--tools", options.tools ?? DEFAULT_READONLY_TOOLS);
  }

  return args;
}

export function normalizeClaudeUsage(rawUsage, meta = {}) {
  if (!rawUsage && !meta.durationMs && !meta.totalCostUsd) return null;
  const u = rawUsage ?? {};
  const inputTokens = Number(u.input_tokens) || 0;
  const outputTokens = Number(u.output_tokens) || 0;
  const cacheReadTokens = Number(u.cache_read_input_tokens ?? u.cache_read_tokens) || 0;
  const cacheCreateTokens = Number(u.cache_creation_input_tokens ?? u.cache_creation_tokens) || 0;
  return {
    model: meta.model ?? null,
    effort: meta.effort ?? null,
    durationSeconds: meta.durationMs ? Number(meta.durationMs) / 1000 : 0,
    numTurns: Number(meta.numTurns) || 1,
    totalCostUsd: typeof meta.totalCostUsd === "number" ? meta.totalCostUsd : null,
    tokens: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_creation_tokens: cacheCreateTokens,
      total_tokens: inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens
    }
  };
}

export function parseClaudeJsonOutput(stdout = "", meta = {}) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    const resultText = typeof obj.result === "string" ? obj.result : "";
    const isError = Boolean(obj.is_error);
    return {
      result: resultText,
      isError,
      sessionId: obj.session_id ?? null,
      usage: normalizeClaudeUsage(obj.usage, {
        model: meta.model,
        effort: meta.effort,
        durationMs: obj.duration_ms,
        numTurns: obj.num_turns,
        totalCostUsd: obj.total_cost_usd
      }),
      totalCostUsd: obj.total_cost_usd ?? null,
      durationMs: obj.duration_ms ?? null,
      raw: obj
    };
  } catch {
    return null;
  }
}

export function runClaudeAvailability(env = process.env) {
  const bin = resolveClaudeBinary(env);
  const res = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000, env });
  return {
    available: res.status === 0,
    binary: bin,
    version: (res.stdout || "").trim() || null
  };
}

export async function runClaudePrompt(prompt, options = {}) {
  const env = options.env ?? process.env;
  if (env[RECURSION_GUARD_ENV] === "1") {
    throw new Error("Blocked recursive claude invocation (CC_PLUGIN_AGY_ACTIVE=1).");
  }
  const textPrompt = String(prompt ?? "");
  if (!textPrompt.trim()) {
    throw new Error("Prompt must not be empty.");
  }

  const bin = resolveClaudeBinary(env);
  const args = buildClaudeArgs(options);
  const childEnv = { ...env, [RECURSION_GUARD_ENV]: "1" };

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: options.cwd || process.cwd(),
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let stdinError;
    const timeoutMs = options.timeoutMs ?? 300_000;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.on("error", (err) => {
      // Wait for close so Claude's exit status and stderr are available.
      stdinError = err;
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: 1,
        text: "",
        stderr: err.message,
        sessionId: null,
        usage: null,
        quotaError: false
      });
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      const parsed = parseClaudeJsonOutput(stdout, { model: options.model, effort: options.effort });
      const exitCode = code ?? 1;
      const responseText = parsed ? parsed.result : stdout.trim();
      const combinedErr = `${stderr}\n${parsed?.isError ? responseText : ""}`.trim();
      const isQuotaErr = (exitCode !== 0 || stdinError || parsed?.isError) && classifyQuotaError(combinedErr);

      if (isQuotaErr) {
        try {
          recordCooldown("claude", "default", { reason: combinedErr, env });
        } catch {
          // Non-fatal
        }
      }

      let diagnostic = stderr.trim();
      if (stdinError) {
        const status = signal ? `signal ${signal}` : `code ${exitCode}`;
        const message = stdinError.code === "EPIPE"
          ? "claude exited before reading the prompt"
          : `could not write the prompt to claude: ${stdinError.message}`;
        diagnostic = `${message} (${status})${diagnostic ? `: ${diagnostic}` : ""}`;
      }

      resolve({
        exitCode: (stdinError || parsed?.isError) && exitCode === 0 ? 1 : exitCode,
        text: responseText,
        stderr: diagnostic,
        sessionId: parsed?.sessionId ?? null,
        usage: parsed?.usage ?? null,
        durationMs: parsed?.durationMs ?? null,
        quotaError: isQuotaErr
      });
    });

    // Always pass prompt via stdin so leading `---` never parses as a CLI flag.
    child.stdin.end(textPrompt);
  });
}
