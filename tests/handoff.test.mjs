// Run: npm test   (node:test, no dependencies)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  detectVerifyCommand,
  hashFiles,
  parseTestList,
  runHandoffLoop
} from "../plugins/agy/scripts/lib/handoff.mjs";

const COMPANION = fileURLToPath(new URL("../plugins/agy/scripts/agy-companion.mjs", import.meta.url));

function scripted(results) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return results[Math.min(calls.length - 1, results.length - 1)];
  };
  fn.calls = calls;
  return fn;
}

const ok = { exitCode: 0, stdout: "done" };
const green = { exitCode: 0, output: "" };
const red = { exitCode: 1, output: "1 failing" };

test("detectVerifyCommand: first known marker wins, unknown repo returns null", () => {
  const has = (names) => (file) => names.includes(path.basename(file));
  assert.equal(detectVerifyCommand("/r", has(["package.json", "go.mod"])), "npm test");
  assert.equal(detectVerifyCommand("/r", has(["Cargo.toml"])), "cargo test");
  assert.equal(detectVerifyCommand("/r", has([])), null);
});

test("parseTestList: comma lists and repeated flags", () => {
  assert.deepEqual(parseTestList(["a.js, b.js", "c.js"]), ["a.js", "b.js", "c.js"]);
  assert.deepEqual(parseTestList(undefined), []);
});

test("hashFiles: a deleted file hashes to null", () => {
  const read = (file) => {
    if (file.endsWith("gone.js")) throw new Error("ENOENT");
    return "x";
  };
  const hashes = hashFiles("/r", ["a.js", "gone.js"], read);
  assert.match(hashes["a.js"], /^[0-9a-f]{64}$/);
  assert.equal(hashes["gone.js"], null);
});

test("runHandoffLoop: green on first run needs no fix-up", async () => {
  const runAgy = scripted([ok]);
  const result = await runHandoffLoop({
    prompt: "p", verifyCommand: "t", maxFixups: 1, testHashes: {},
    runAgy, runVerify: scripted([green]), rehash: () => ({})
  });
  assert.equal(result.status.label, "PASS");
  assert.equal(runAgy.calls.length, 1);
});

test("runHandoffLoop: one fix-up resumes the conversation with the failing output", async () => {
  const runAgy = scripted([ok, ok]);
  const result = await runHandoffLoop({
    prompt: "p", verifyCommand: "npm test", maxFixups: 1, testHashes: {},
    runAgy, runVerify: scripted([red, green]), rehash: () => ({})
  });
  assert.equal(result.status.label, "PASS");
  assert.equal(runAgy.calls[1][1].resume, true);
  assert.match(runAgy.calls[1][0], /1 failing/);
});

test("runHandoffLoop: still red after the allowed fix-ups is FAIL", async () => {
  const runAgy = scripted([ok]);
  const result = await runHandoffLoop({
    prompt: "p", verifyCommand: "t", maxFixups: 2, testHashes: {},
    runAgy, runVerify: scripted([red]), rehash: () => ({})
  });
  assert.equal(result.status.label, "FAIL");
  assert.equal(result.status.exitCode, 4);
  assert.equal(runAgy.calls.length, 3);
});

test("runHandoffLoop: a changed test file wins over a green run", async () => {
  const result = await runHandoffLoop({
    prompt: "p", verifyCommand: "t", maxFixups: 0, testHashes: { "a.test.js": "h1" },
    runAgy: scripted([ok]), runVerify: scripted([green]), rehash: () => ({ "a.test.js": "h2" })
  });
  assert.equal(result.status.label, "TEST FILES MODIFIED");
  assert.deepEqual(result.modifiedTests, ["a.test.js"]);
});

test("runHandoffLoop: agy failure stops before verification", async () => {
  const runVerify = scripted([green]);
  const result = await runHandoffLoop({
    prompt: "p", verifyCommand: "t", maxFixups: 1, testHashes: {},
    runAgy: scripted([{ exitCode: 2, stdout: "" }]), runVerify, rehash: () => ({})
  });
  assert.equal(result.status.label, "AGY FAILED");
  assert.equal(runVerify.calls.length, 0);
});

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agy-handoff-"));
  const repo = path.join(root, "repo");
  const bin = path.join(root, "bin");
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.test.sh"), "test -f done.txt\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", "work");
  // Fake agy: the first run does nothing, the resumed fix-up creates done.txt.
  fs.writeFileSync(
    path.join(bin, "agy"),
    '#!/bin/sh\nfor a in "$@"; do [ "$a" = "--continue" ] && touch done.txt; done\necho "fake agy ran"\n'
  );
  fs.chmodSync(path.join(bin, "agy"), 0o755);
  return { root, repo, bin, git };
}

function runCompanion(env, repo, args) {
  return spawnSync(process.execPath, [COMPANION, "handoff", "--cwd", repo, ...args], {
    cwd: repo,
    encoding: "utf8",
    env
  });
}

test("handoff command: fails red, fixes up via --continue, reports PASS", () => {
  const { root, repo, bin } = makeRepo();
  const env = { ...process.env, AI_QUOTA_DIR: root, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CLAUDE_PLUGIN_DATA: path.join(root, "data") };
  try {
    const result = runCompanion(env, repo, ["--verify", "sh a.test.sh", "--tests", "a.test.sh", "make it pass"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /agy Hand-off: PASS/);
    assert.match(result.stdout, /agy runs: 2 \(1 fix-up\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff command: refuses on main and on a dirty tree", () => {
  const { root, repo, bin, git } = makeRepo();
  const env = { ...process.env, AI_QUOTA_DIR: root, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CLAUDE_PLUGIN_DATA: path.join(root, "data") };
  try {
    fs.writeFileSync(path.join(repo, "stray.txt"), "x");
    let result = runCompanion(env, repo, ["--verify", "true", "x"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /uncommitted changes/);

    fs.rmSync(path.join(repo, "stray.txt"));
    git("checkout", "-q", "main");
    result = runCompanion(env, repo, ["--verify", "true", "x"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Refusing to hand off on main/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
