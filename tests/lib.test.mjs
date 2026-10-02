// Run: npm test   (node:test, no dependencies)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseArgs, splitRawArgumentString } from "../plugins/agy/scripts/lib/args.mjs";

const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const state = await import("../plugins/agy/scripts/lib/state.mjs");

const config = {
  valueOptions: ["model", "tag"],
  booleanOptions: ["json", "wait"],
  repeatableOptions: ["tag"],
  aliasMap: { m: "model" }
};

test("parseArgs: value, boolean, alias, inline and repeatable options", () => {
  const { options, positionals } = parseArgs(
    ["--model", "fast", "--json", "-m", "slow", "--tag=a", "--tag", "b", "hello"],
    config
  );
  assert.equal(options.model, "slow");
  assert.equal(options.json, true);
  assert.deepEqual(options.tag, ["a", "b"]);
  assert.deepEqual(positionals, ["hello"]);
});

test("parseArgs: -- passes everything through as positionals", () => {
  const { options, positionals } = parseArgs(["--json", "--", "--model", "x"], config);
  assert.equal(options.json, true);
  assert.deepEqual(positionals, ["--model", "x"]);
});

test("parseArgs: boolean --flag=false, unknown flags stay positional, missing value throws", () => {
  assert.equal(parseArgs(["--json=false"], config).options.json, false);
  assert.deepEqual(parseArgs(["--unknown"], config).positionals, ["--unknown"]);
  assert.throws(() => parseArgs(["--model"], config), /Missing value for --model/);
});

test("splitRawArgumentString: quotes, escapes and whitespace", () => {
  assert.deepEqual(splitRawArgumentString(`a "b c" 'd e'  f\\ g`), ["a", "b c", "d e", "f g"]);
  assert.deepEqual(splitRawArgumentString("   "), []);
  assert.deepEqual(splitRawArgumentString("trailing\\"), ["trailing\\"]);
});

function withTempState(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agy-plugin-test-"));
  const previous = process.env[PLUGIN_DATA_ENV];
  process.env[PLUGIN_DATA_ENV] = path.join(root, "data");
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  try {
    return fn(cwd);
  } finally {
    if (previous === undefined) delete process.env[PLUGIN_DATA_ENV];
    else process.env[PLUGIN_DATA_ENV] = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("state: empty workspace yields the default state", () => {
  withTempState((cwd) => {
    const s = state.loadState(cwd);
    assert.deepEqual(s.jobs, []);
    assert.equal(s.config.stopReviewGate, false);
  });
});

test("state: state dir lives under the plugin data dir and is stable per workspace", () => {
  withTempState((cwd) => {
    const dir = state.resolveStateDir(cwd);
    assert.ok(dir.startsWith(process.env[PLUGIN_DATA_ENV]));
    assert.equal(dir, state.resolveStateDir(cwd));
  });
});

test("state: upsertJob inserts then merges by id, newest first", () => {
  withTempState((cwd) => {
    state.upsertJob(cwd, { id: "a", status: "running" });
    state.upsertJob(cwd, { id: "b", status: "running" });
    state.upsertJob(cwd, { id: "a", status: "done" });
    const jobs = state.listJobs(cwd);
    assert.equal(jobs.length, 2);
    assert.equal(jobs.find((j) => j.id === "a").status, "done");
  });
});

test("state: keeps at most 50 jobs", () => {
  withTempState((cwd) => {
    for (let i = 0; i < 55; i += 1) state.upsertJob(cwd, { id: `job-${i}` });
    assert.equal(state.listJobs(cwd).length, 50);
  });
});

test("state: a corrupt state file falls back to defaults", () => {
  withTempState((cwd) => {
    state.ensureStateDir(cwd);
    fs.writeFileSync(state.resolveStateFile(cwd), "{not json");
    assert.deepEqual(state.loadState(cwd).jobs, []);
  });
});

test("generateJobId: carries the prefix and is unique", () => {
  const a = state.generateJobId("review");
  assert.ok(a.startsWith("review-"));
  assert.notEqual(a, state.generateJobId("review"));
});
