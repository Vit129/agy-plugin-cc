// Run: npm test   (node:test, no dependencies)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { formatUsage, parseAgyJsonOutput, sumUsage } from "../plugins/agy/scripts/lib/usage.mjs";

const COMPANION = fileURLToPath(new URL("../plugins/agy/scripts/agy-companion.mjs", import.meta.url));

// Shape captured from agy 1.5.16 `--output-format json`.
const SUCCESS = '{"conversation_id":"c1","status":"SUCCESS","response":"ok\\n","duration_seconds":5.88,"num_turns":1,"usage":{"input_tokens":23692,"output_tokens":1,"thinking_tokens":0,"cache_read_tokens":100,"total_tokens":23693}}';
const TIMEOUT = '{"conversation_id":"c2","status":"ERROR","response":"","error":"print timeout after 1s","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0},"finished_reason":"print_timeout"}';

test("parseAgyJsonOutput: success envelope", () => {
  const parsed = parseAgyJsonOutput(SUCCESS);
  assert.equal(parsed.response, "ok\n");
  assert.equal(parsed.conversationId, "c1");
  assert.equal(parsed.tokens.input_tokens, 23692);
  assert.equal(parsed.tokens.cache_read_tokens, 100);
});

test("parseAgyJsonOutput: error envelope after log lines", () => {
  const parsed = parseAgyJsonOutput(`[agy] print timeout\n${TIMEOUT}\n`);
  assert.equal(parsed.status, "ERROR");
  assert.equal(parsed.finishedReason, "print_timeout");
  assert.equal(parsed.error, "print timeout after 1s");
});

test("parseAgyJsonOutput: plain text or foreign JSON falls back to null", () => {
  assert.equal(parseAgyJsonOutput("just text"), null);
  assert.equal(parseAgyJsonOutput('["--print","x"]'), null);
  assert.equal(parseAgyJsonOutput(""), null);
});

test("sumUsage and formatUsage: totals across calls", () => {
  const one = { model: "m", durationSeconds: 2, numTurns: 1, tokens: { input_tokens: 10, output_tokens: 2, thinking_tokens: 1, cache_read_tokens: 5, total_tokens: 13 } };
  const total = sumUsage([one, null, one]);
  assert.equal(total.calls, 2);
  assert.equal(total.tokens.input_tokens, 20);
  assert.equal(formatUsage(total), "20 in / 6 out · cache 10 · m · 4.0s · 2 agy calls");
  assert.equal(sumUsage([null]), null);
});

test("task command: records usage on the job and in usage.jsonl", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agy-usage-"));
  const bin = path.join(root, "bin");
  const data = path.join(root, "data");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "agy"), `#!/bin/sh\ncat <<'JSON'\n${SUCCESS}\nJSON\n`);
  fs.chmodSync(path.join(bin, "agy"), 0o755);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CLAUDE_PLUGIN_DATA: data };
  try {
    const run = spawnSync(process.execPath, [COMPANION, "task", "--cwd", root, "say ok"], { cwd: root, encoding: "utf8", env });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "ok\n");

    const status = spawnSync(process.execPath, [COMPANION, "status", "--cwd", root], { cwd: root, encoding: "utf8", env });
    assert.match(status.stdout, /Usage: 23,692 in \/ 1 out · cache 100/);

    const ledgers = fs.readdirSync(path.join(data, "state")).map((dir) => path.join(data, "state", dir, "usage.jsonl"));
    const entry = JSON.parse(fs.readFileSync(ledgers.find((file) => fs.existsSync(file)), "utf8").trim());
    assert.equal(entry.tokens.total_tokens, 23693);
    assert.equal(entry.status, "completed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
