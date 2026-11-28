import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  changedFiles,
  detectVerifyCommand,
  HANDOFF_STATUS,
  hashFiles,
  parseTestList,
  runHandoffLoop
} from "../plugins/cc-for-agy/scripts/lib/handoff.mjs";
import { appendUsageLog, formatUsage, listJobs, resolveStateDir, sumUsage, upsertJob } from "../plugins/cc-for-agy/scripts/lib/state.mjs";

const COMPANION = path.resolve("plugins/cc-for-agy/scripts/claude-companion.mjs");

function makeTempGitRepo(branch = "feat/test") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-agy-repo-"));
  execFileSync("git", ["init", "-b", branch], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tmp", scripts: { test: "echo ok" } }));
  execFileSync("git", ["add", "package.json"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

test("[TC-CFA-06][BE-UT] handoff helpers detect verify commands, parse test lists, and detect hash changes", () => {
  assert.equal(detectVerifyCommand("/repo", (p) => p.endsWith("package.json")), "npm test");
  assert.equal(detectVerifyCommand("/repo", (p) => p.endsWith("pyproject.toml")), "pytest");
  assert.equal(detectVerifyCommand("/repo", () => false), null);
  assert.deepEqual(parseTestList(["a.test.mjs, b.test.mjs", "c.test.mjs"]), ["a.test.mjs", "b.test.mjs", "c.test.mjs"]);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hash-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.test.mjs"), "v1");
    const before = hashFiles(tmp, ["a.test.mjs", "missing.test.mjs"]);
    fs.writeFileSync(path.join(tmp, "a.test.mjs"), "v2");
    const after = hashFiles(tmp, ["a.test.mjs", "missing.test.mjs"]);
    assert.deepEqual(changedFiles(before, after), ["a.test.mjs"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("[TC-CFA-07][BE-BL] runHandoffLoop handles PASS, fixup resume->PASS, FAIL, TEST_FILES_MODIFIED, and CLAUDE_FAILED", async () => {
  const baseHashes = { "a.test.mjs": "h1" };

  // 1. PASS on first try
  const passRes = await runHandoffLoop({
    prompt: "do it",
    verifyCommand: "npm test",
    maxFixups: 1,
    testHashes: baseHashes,
    runClaude: async () => ({ exitCode: 0, sessionId: "s1", text: "done", usage: { tokens: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 15 } } }),
    runVerify: async () => ({ exitCode: 0, output: "ok" }),
    rehash: () => baseHashes
  });
  assert.equal(passRes.status, HANDOFF_STATUS.PASS);
  assert.equal(passRes.rounds.length, 1);

  // 2. Fixup resumes sessionId and passes
  let calls = 0;
  let resumedWith = null;
  const fixupRes = await runHandoffLoop({
    prompt: "do it",
    verifyCommand: "npm test",
    maxFixups: 1,
    testHashes: baseHashes,
    runClaude: async (_p, opts) => {
      calls += 1;
      resumedWith = opts.resume;
      return { exitCode: 0, sessionId: "s-fix", text: "fixed" };
    },
    runVerify: async () => ({ exitCode: calls === 1 ? 1 : 0, output: calls === 1 ? "fail" : "ok" }),
    rehash: () => baseHashes
  });
  assert.equal(fixupRes.status, HANDOFF_STATUS.PASS);
  assert.equal(resumedWith, "s-fix");
  assert.equal(fixupRes.rounds.length, 2);

  // 3. Still red -> FAIL
  const failRes = await runHandoffLoop({
    prompt: "do it",
    verifyCommand: "npm test",
    maxFixups: 0,
    testHashes: baseHashes,
    runClaude: async () => ({ exitCode: 0, sessionId: "s2", text: "tried" }),
    runVerify: async () => ({ exitCode: 1, output: "still failing" }),
    rehash: () => baseHashes
  });
  assert.equal(failRes.status, HANDOFF_STATUS.FAIL);

  // 4. Test file tampered -> TEST_FILES_MODIFIED
  const tamperRes = await runHandoffLoop({
    prompt: "do it",
    verifyCommand: "npm test",
    maxFixups: 0,
    testHashes: baseHashes,
    runClaude: async () => ({ exitCode: 0, sessionId: "s3", text: "edited test" }),
    runVerify: async () => ({ exitCode: 0, output: "ok" }),
    rehash: () => ({ "a.test.mjs": "h2" })
  });
  assert.equal(tamperRes.status, HANDOFF_STATUS.TEST_FILES_MODIFIED);

  // 5. Claude failed -> CLAUDE_FAILED
  const claudeFailRes = await runHandoffLoop({
    prompt: "do it",
    verifyCommand: "npm test",
    maxFixups: 1,
    testHashes: baseHashes,
    runClaude: async () => ({ exitCode: 1, text: "error" }),
    runVerify: async () => ({ exitCode: 0, output: "ok" }),
    rehash: () => baseHashes
  });
  assert.equal(claudeFailRes.status, HANDOFF_STATUS.CLAUDE_FAILED);
});

test("[TC-CFA-08][BE-IT] state.mjs manages jobs, dead-PID detection, usage.jsonl, sumUsage, and formatUsage", () => {
  const repo = makeTempGitRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-data-"));
  const env = { PLUGIN_DATA: dataDir };

  try {
    upsertJob(repo, { id: "job-1", kind: "ask", status: "running", pid: 999999 }, env);
    const jobs = listJobs(repo, env);
    assert.equal(jobs[0].status, "failed"); // dead PID marked failed

    const u1 = { model: "sonnet", durationSeconds: 1.5, numTurns: 1, tokens: { input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 120 } };
    const u2 = { model: "sonnet", durationSeconds: 2.0, numTurns: 2, tokens: { input_tokens: 50, output_tokens: 10, cache_read_tokens: 10, cache_creation_tokens: 0, total_tokens: 70 } };
    appendUsageLog(repo, u1, env);
    const usageFile = path.join(resolveStateDir(repo, env), "usage.jsonl");
    assert.ok(fs.existsSync(usageFile));

    const summed = sumUsage([u1, u2]);
    assert.equal(summed.calls, 2);
    assert.equal(summed.tokens.total_tokens, 190);
    assert.ok(formatUsage(summed).includes("2 claude calls"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("[TC-CFA-09][BE-IT] CLI integration: transfer, handoff guards, and status --json", () => {
  const mainRepo = makeTempGitRepo("main");
  const featRepo = makeTempGitRepo("feat/work");

  try {
    // transfer writes .tmp/claude-transfer-*.md
    const tr = spawnSync(process.execPath, [COMPANION, "transfer", "--cwd", featRepo, "--notes", "Continue auth fix", "--json"], {
      encoding: "utf8"
    });
    assert.equal(tr.status, 0);
    const trOut = JSON.parse(tr.stdout);
    assert.ok(fs.existsSync(trOut.file));
    assert.ok(fs.readFileSync(trOut.file, "utf8").includes("Continue auth fix"));

    // handoff refuses main branch
    const onMain = spawnSync(process.execPath, [COMPANION, "handoff", "--cwd", mainRepo, "fix bug"], { encoding: "utf8" });
    assert.notEqual(onMain.status, 0);
    assert.ok(onMain.stderr.includes("protected branch"));

    // handoff refuses dirty tree
    fs.writeFileSync(path.join(featRepo, "dirty.txt"), "x");
    const dirty = spawnSync(process.execPath, [COMPANION, "handoff", "--cwd", featRepo, "fix bug"], { encoding: "utf8" });
    assert.notEqual(dirty.status, 0);
    assert.ok(dirty.stderr.includes("dirty working tree"));

    // status --json returns quota & jobs
    const st = spawnSync(process.execPath, [COMPANION, "status", "--cwd", featRepo, "--json"], { encoding: "utf8" });
    assert.equal(st.status, 0);
    const stOut = JSON.parse(st.stdout);
    assert.ok(stOut.quota);
    assert.ok(Array.isArray(stOut.jobs));
  } finally {
    fs.rmSync(mainRepo, { recursive: true, force: true });
    fs.rmSync(featRepo, { recursive: true, force: true });
  }
});
