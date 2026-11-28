import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildClaudeArgs, parseClaudeJsonOutput, RECURSION_GUARD_ENV, runClaudePrompt, selectClaudeModel } from "../plugins/cc-for-agy/scripts/lib/claude.mjs";
import { handlePreInvocation, handleStop } from "../plugins/cc-for-agy/scripts/quota-hook.mjs";
import { resolveStateDir } from "../plugins/cc-for-agy/scripts/lib/state.mjs";
import { readAllQuota } from "../plugins/cc-for-agy/scripts/lib/quota-state.mjs";

test("buildClaudeArgs supports default no-persistence, persist, resume, noTools, and edit", () => {
  const args = buildClaudeArgs({});
  assert.ok(args.includes("-p"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Grep,Glob");

  const persistArgs = buildClaudeArgs({ persist: true });
  assert.equal(persistArgs.includes("--no-session-persistence"), false);

  const resumeArgs = buildClaudeArgs({ resume: "sess-123", model: "sonnet" });
  assert.equal(resumeArgs.includes("--no-session-persistence"), false);
  assert.equal(resumeArgs[resumeArgs.indexOf("--resume") + 1], "sess-123");
  assert.equal(resumeArgs[resumeArgs.indexOf("--model") + 1], "sonnet");

  const noToolArgs = buildClaudeArgs({ noTools: true });
  assert.equal(noToolArgs[noToolArgs.indexOf("--tools") + 1], "");

  const editArgs = buildClaudeArgs({ edit: true });
  assert.equal(editArgs[editArgs.indexOf("--permission-mode") + 1], "acceptEdits");
});

test("parseClaudeJsonOutput extracts result, sessionId, and normalized usage", () => {
  const parsed = parseClaudeJsonOutput(
    JSON.stringify({
      result: "LGTM",
      is_error: false,
      session_id: "sess-abc",
      duration_ms: 1500,
      num_turns: 2,
      total_cost_usd: 0.012,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 }
    }),
    { model: "sonnet" }
  );
  assert.equal(parsed.result, "LGTM");
  assert.equal(parsed.isError, false);
  assert.equal(parsed.sessionId, "sess-abc");
  assert.equal(parsed.usage.model, "sonnet");
  assert.equal(parsed.usage.durationSeconds, 1.5);
  assert.equal(parsed.usage.tokens.total_tokens, 170);
});

test("runClaudePrompt blocks recursive calls when CC_PLUGIN_AGY_ACTIVE=1", async () => {
  await assert.rejects(
    () => runClaudePrompt("hello", { env: { ...process.env, [RECURSION_GUARD_ENV]: "1" } }),
    /Blocked recursive/
  );
});

test("[TC-QAR-04][BE-IT] PreInvocation never blocks ordinary agy prompts; it only diverts Claude delegations", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-agy-hook-"));
  const env = { AI_QUOTA_DIR: dir, AGENT_USAGE_STATE_DIR: dir, PLUGIN_DATA: dir };
  const now = 1_800_000_000;
  const opts = { env, nowSec: now };
  const seed = (agy, claude) => {
    for (const [provider, pool, remaining] of [["agy", "gemini", agy], ["claude", "default", claude]]) {
      const window = { remaining_pct: remaining, resets_at: now + 1000 };
      fs.writeFileSync(path.join(dir, `${provider}.json`), JSON.stringify({
        captured_at: now - 10, pools: { [pool]: { "5h": window, "7d": window } }
      }));
    }
  };

  try {
    // agy critical, Claude healthy: ordinary prompts must still run.
    seed(10, 80);
    const request = { lastUserInput: "Review the changes", modelName: "gemini-flash", workspacePaths: [dir] };
    assert.deepEqual(handlePreInvocation(request, opts), {});
    assert.deepEqual(handlePreInvocation({ ...request, lastUserInput: "ask claude to review this" }, opts), {});

    // Claude critical, agy healthy: a delegation to Claude is short-circuited, ordinary prompts and slash commands are not.
    seed(80, 10);
    const delegation = { ...request, lastUserInput: "ask claude to review the changes" };
    const outcome = handlePreInvocation(delegation, opts);
    assert.equal(outcome.terminationBehavior, "terminate");
    const message = outcome.injectSteps[0].errorMessage.userMessage;
    assert.match(message, /diverted to agy.*claude 5h quota is critical/);
    assert.deepEqual(handlePreInvocation(request, opts), {});
    assert.deepEqual(handlePreInvocation({ ...delegation, lastUserInput: "/usage" }, opts), {});
    assert.deepEqual(handlePreInvocation(delegation, { ...opts, env: { ...env, CC_PLUGIN_AGY_ROUTE: "off" } }), {});
    const entry = JSON.parse(fs.readFileSync(path.join(resolveStateDir(dir, env), "usage.jsonl"), "utf8"));
    assert.equal(entry.kind, "hook:PreInvocation");
    assert.equal(entry.status, "diverted");

    // Persistent off-switch works without the launch-time env var.
    fs.writeFileSync(path.join(dir, "route-off"), "");
    assert.deepEqual(handlePreInvocation(delegation, opts), {});
    fs.rmSync(path.join(dir, "route-off"));
    assert.equal(handlePreInvocation(delegation, opts).terminationBehavior, "terminate");

    handleStop({ terminationReason: "error", error: message }, opts);
    assert.equal(readAllQuota(opts).agy.pools.gemini["5h"].state, "live");
    handleStop({ terminationReason: "error", error: "429 quota exhausted" }, opts);
    assert.equal(readAllQuota(opts).agy.pools.gemini["5h"].state, "exhausted");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ask-claude-mcp responds to initialize and tools/list including resume and persist", async () => {
  const mcpPath = path.resolve("plugins/cc-for-agy/scripts/ask-claude-mcp.mjs");
  const child = spawn(process.execPath, [mcpPath], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => {
    out += d.toString();
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  child.stdin.end();

  await new Promise((resolve) => child.on("close", resolve));
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].result.serverInfo.name, "cc-plugin-agy");
  const tool = lines[1].result.tools[0];
  assert.equal(tool.name, "ask_claude");
  assert.ok(tool.inputSchema.properties.resume);
  assert.ok(tool.inputSchema.properties.persist);
  assert.deepEqual(tool.inputSchema.properties.route.enum, ["auto", "off"]);
});

test("selectClaudeModel picks by task size when model is omitted and respects explicit/env overrides", () => {
  assert.deepEqual(selectClaudeModel({ kind: "ask", promptLength: 100 }), {
    model: "haiku",
    effort: "low",
    tier: "small",
    auto: true
  });
  assert.deepEqual(selectClaudeModel({ kind: "review", promptLength: 3000 }), {
    model: "sonnet",
    effort: "medium",
    tier: "medium",
    auto: true
  });
  assert.deepEqual(selectClaudeModel({ kind: "adversarial-review", promptLength: 500 }), {
    model: "opus",
    effort: "high",
    tier: "large",
    auto: true
  });
  assert.deepEqual(selectClaudeModel({ kind: "ask", promptLength: 100, model: "sonnet" }), {
    model: "sonnet",
    effort: null,
    tier: "explicit",
    auto: false
  });
  assert.equal(
    selectClaudeModel({ kind: "ask", promptLength: 100, env: { CC_MODEL_SMALL: "claude-haiku-custom" } }).model,
    "claude-haiku-custom"
  );
});
