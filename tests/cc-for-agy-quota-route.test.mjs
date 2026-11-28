import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chooseRoute } from "../plugins/cc-for-agy/scripts/lib/quota-route.mjs";
import { resolveStateDir } from "../plugins/cc-for-agy/scripts/lib/state.mjs";

const live = effectiveRemainingPct => ({ state: "live", effectiveRemainingPct });
const quota = (claude, agy) => ({
  claude: { pools: { default: { "5h": live(90), "7d": claude } } },
  agy: { pools: { gemini: { "5h": agy, "7d": live(90) } } }
});

test("[TC-QAR-01][BE-UT] diverts a critical destination only to a fresh provider above low", () => {
  const settings = { critical: 20, low: 40 };
  assert.deepEqual(chooseRoute(quota(live(41), live(20)), settings), {
    target: "claude",
    reason: "agy 5h quota is critical (20% remaining)."
  });
  assert.equal(chooseRoute(quota(live(40), live(20)), settings).target, "agy");
  assert.equal(chooseRoute(quota(live(20), live(21)), settings).target, "agy");
  assert.equal(chooseRoute(quota(live(20), live(80)), { ...settings, requested: "claude" }).target, "agy");
});

test("[TC-QAR-02][BE-UT] keeps the destination with unavailable, stale, reset or critical alternate quota", () => {
  const settings = { critical: 20, low: 40 };
  for (const alternate of [undefined, { state: "aging", effectiveRemainingPct: 100 }, { state: "reset_assumed", effectiveRemainingPct: 100 }, live(20)]) {
    assert.equal(chooseRoute(quota(alternate, live(0)), settings).target, "agy");
  }
  assert.equal(chooseRoute(quota(live(90), { state: "reset_assumed", effectiveRemainingPct: 100 }), settings).target, "agy");
  assert.equal(chooseRoute(quota(live(0), live(0)), { ...settings, requested: "claude" }).target, "claude");
});

test("[TC-QAR-03][BE-IT] companion and ask_claude refuse the critical destination before spawning Claude", t => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "claude-auto-route-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const binary = path.join(dir, "claude");
  const calls = path.join(dir, "calls");
  const env = {
    ...process.env, CC_PLUGIN_AGY_ACTIVE: "", AI_QUOTA_DIR: dir, AGENT_USAGE_STATE_DIR: dir,
    PLUGIN_DATA: dir, CLAUDE_BIN: binary, CLAUDE_STUB_LOG: calls
  };
  fs.writeFileSync(binary, '#!/bin/sh\nprintf "called\\n" >> "$CLAUDE_STUB_LOG"\nprintf \'%s\\n\' \'{"result":"ok"}\'\n', { mode: 0o755 });
  const now = Math.floor(Date.now() / 1000);
  for (const [file, pool, remaining] of [["claude", "default", 16], ["native-agy", "gemini", 94]]) {
    const window = { remaining_pct: remaining, resets_at: now + 600 };
    fs.writeFileSync(path.join(dir, file + ".json"), JSON.stringify({
      captured_at: now, pools: { [pool]: { "5h": window, "7d": window } }
    }));
  }
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ critical: 16, low: 65 }));
  const companion = fileURLToPath(new URL("../plugins/cc-for-agy/scripts/claude-companion.mjs", import.meta.url));
  const mcp = fileURLToPath(new URL("../plugins/cc-for-agy/scripts/ask-claude-mcp.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [companion, "ask", "--json", ...args, "Test delegation"], { cwd: dir, env, encoding: "utf8" });
  const ask = (route) => {
    const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: "ask_claude", arguments: { prompt: "Test MCP", route }
    } };
    const result = spawnSync(process.execPath, [mcp], { cwd: dir, env, input: JSON.stringify(request) + "\n", encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).result;
  };
  const refused = run("--background");
  assert.equal(refused.status, 1, refused.stderr);
  assert.equal(JSON.parse(refused.stdout).target, "agy");
  const reply = ask();
  assert.equal(reply.isError, true);
  assert.match(reply.content[0].text, /diverted to agy.*claude 5h quota is critical/);
  assert.equal(fs.existsSync(calls), false);

  const ledger = fs.readFileSync(path.join(resolveStateDir(dir, env), "usage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(ledger.map(({ kind, status, target }) => [kind, status, target]), [
    ["ask", "diverted", "agy"], ["mcp:ask_claude", "diverted", "agy"]
  ]);
  assert.equal(run("--route", "off").status, 0);
  assert.equal(ask("off").isError, false);
  assert.equal(fs.readFileSync(calls, "utf8"), "called\ncalled\n");
});

test("plugins/cc-for-agy shared libs match plugins/agy/scripts/lib/", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const file of ["quota-route.mjs", "quota-state.mjs"]) {
    const src = fs.readFileSync(path.join(root, "plugins/agy/scripts/lib", file), "utf8");
    const copy = fs.readFileSync(path.join(root, "plugins/cc-for-agy/scripts/lib", file), "utf8");
    assert.equal(copy, src, `${file} in plugins/cc-for-agy/scripts/lib/ is out of sync; run node scripts/build-cc-for-agy.mjs`);
  }
});
