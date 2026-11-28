import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chooseRoute } from "../plugins/agy/scripts/lib/quota-route.mjs";

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

test("[TC-QAR-03][BE-IT] Claude companion diverts before spawning agy and honors an explicit override", t => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "agy-auto-route-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, "calls");
  const data = path.join(dir, "data");
  const script = fileURLToPath(new URL("../plugins/agy/scripts/agy-companion.mjs", import.meta.url));
  const env = {
    ...process.env, CLAUDECODE: "1", CLAUDE_PLUGIN_DATA: data, AI_QUOTA_DIR: dir,
    AGENT_USAGE_STATE_DIR: dir, PATH: dir + path.delimiter + process.env.PATH, AGY_STUB_LOG: log
  };
  fs.writeFileSync(path.join(dir, "agy"),
    '#!/bin/sh\nprintf "%s\\n" "$1" >> "$AGY_STUB_LOG"\nprintf "%s\\n" ok\n', { mode: 0o755 });
  const writeQuota = (provider, pool, remaining, expired = false) => {
    const now = Math.floor(Date.now() / 1000);
    const window = { remaining_pct: remaining, resets_at: now + (expired ? -1 : 600) };
    fs.writeFileSync(path.join(dir, provider + ".json"), JSON.stringify({
      captured_at: now, pools: { [pool]: { "5h": window, "7d": window } }
    }));
  };
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ critical: 12, low: 65 }));
  writeQuota("agy", "gemini", 12);
  writeQuota("claude", "default", 90);
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, env, encoding: "utf8" });

  for (const command of ["task", "review", "adversarial-review"]) {
    const result = run(command, "--background", "--json", "Test delegation");
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stdout, result.stderr);
    const event = JSON.parse(result.stdout);
    assert.equal(event.status, "diverted");
    assert.equal(event.target, "claude");
    assert.match(event.message, /Run this job in Claude.*12% remaining/);
  }
  const rescue = run("task", "--route-check", "--json", "Test rescue");
  assert.equal(rescue.status, 1, rescue.stderr);
  assert.equal(JSON.parse(rescue.stdout).kind, "rescue");
  assert.equal(fs.existsSync(log), false, "even agy model/version discovery must be skipped");
  const [workspace] = fs.readdirSync(path.join(data, "state"));
  const ledgerPath = path.join(data, "state", workspace, "usage.jsonl");
  const events = fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map(({ kind, requested, target }) => [kind, requested, target]), [
    ["task", "agy", "claude"], ["review", "agy", "claude"], ["adversarial-review", "agy", "claude"], ["rescue", "agy", "claude"]
  ]);

  const bypass = run("task", "--route", "off", "Test override");
  assert.equal(bypass.status, 0, bypass.stderr);
  assert.match(fs.readFileSync(log, "utf8"), /--dangerously-skip-permissions/);
  assert.equal(run("task", "--route-check", "--route", "off", "Test rescue override").status, 0);

  writeQuota("agy", "gemini", 1, true);
  assert.equal(run("task", "Test post-reset").status, 0);
  writeQuota("agy", "gemini", 90);
  writeQuota("claude", "default", 10);
  const recommendation = run("task", "Test recommendation");
  assert.equal(recommendation.status, 0);
  assert.match(recommendation.stderr, /recommends delegating to agy.*claude 5h/);
});
