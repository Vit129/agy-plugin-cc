import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERIFY_MARKERS = [
  ["package.json", "npm test"],
  ["pyproject.toml", "pytest"],
  ["go.mod", "go test ./..."],
  ["Cargo.toml", "cargo test"]
];

export const HANDOFF_STATUS = {
  PASS: { label: "PASS", exitCode: 0 },
  FAIL: { label: "FAIL", exitCode: 4 },
  CLAUDE_FAILED: { label: "CLAUDE FAILED", exitCode: 5 },
  TEST_FILES_MODIFIED: { label: "TEST FILES MODIFIED", exitCode: 6 }
};

export function detectVerifyCommand(root, exists = fs.existsSync) {
  for (const [marker, command] of VERIFY_MARKERS) {
    if (exists(path.join(root, marker))) return command;
  }
  return null;
}

export function parseTestList(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hashFiles(root, files, read = fs.readFileSync) {
  const hashes = {};
  for (const file of files) {
    try {
      hashes[file] = crypto.createHash("sha256").update(read(path.resolve(root, file))).digest("hex");
    } catch {
      hashes[file] = null;
    }
  }
  return hashes;
}

export function changedFiles(before, after) {
  return Object.keys(before).filter((file) => before[file] !== after[file]);
}

export function tailText(text, maxChars = 6000) {
  const value = String(text ?? "");
  return value.length <= maxChars ? value : value.slice(-maxChars);
}

export function buildFixupPrompt(verifyCommand, verifyOutput) {
  return [
    `The verification command \`${verifyCommand}\` still fails. Its output (last part):`,
    "",
    "```",
    tailText(verifyOutput),
    "```",
    "",
    "Fix the implementation so it passes. Do not modify the test files, do not add dependencies, do not commit.",
    "Reply with at most 10 lines: what you changed and why."
  ].join("\n");
}

export async function runHandoffLoop({
  prompt,
  verifyCommand,
  maxFixups,
  testHashes,
  runClaude,
  runVerify,
  rehash,
  onProgress
}) {
  const rounds = [];
  const usages = [];
  let claudeResult = await runClaude(prompt, { persist: true, resume: null });
  rounds.push({ kind: "initial", claudeExitCode: claudeResult.exitCode });
  if (claudeResult.usage) usages.push(claudeResult.usage);

  if (claudeResult.exitCode !== 0) {
    return { status: HANDOFF_STATUS.CLAUDE_FAILED, rounds, usages, claudeResult, verify: null, modifiedTests: [] };
  }

  let verify = await runVerify(verifyCommand);
  rounds.at(-1).verifyExitCode = verify.exitCode;
  let sessionId = claudeResult.sessionId ?? null;

  for (let fixup = 1; verify.exitCode !== 0 && fixup <= maxFixups; fixup += 1) {
    onProgress?.(`Verification failed; fix-up ${fixup}/${maxFixups}.`);
    claudeResult = await runClaude(buildFixupPrompt(verifyCommand, verify.output), {
      persist: true,
      resume: sessionId
    });
    if (claudeResult.sessionId) sessionId = claudeResult.sessionId;
    rounds.push({ kind: "fixup", claudeExitCode: claudeResult.exitCode });
    if (claudeResult.usage) usages.push(claudeResult.usage);

    if (claudeResult.exitCode !== 0) {
      return { status: HANDOFF_STATUS.CLAUDE_FAILED, rounds, usages, claudeResult, verify, modifiedTests: [] };
    }
    verify = await runVerify(verifyCommand);
    rounds.at(-1).verifyExitCode = verify.exitCode;
  }

  const modifiedTests = changedFiles(testHashes, rehash());
  const status =
    modifiedTests.length > 0
      ? HANDOFF_STATUS.TEST_FILES_MODIFIED
      : verify.exitCode === 0
        ? HANDOFF_STATUS.PASS
        : HANDOFF_STATUS.FAIL;
  return { status, rounds, usages, claudeResult, verify, modifiedTests };
}

export function renderHandoffReport(result, meta) {
  const lines = [
    `# Claude Hand-off: ${result.status.label}`,
    "",
    `Verify: \`${meta.verifyCommand}\` (exit ${result.verify?.exitCode ?? "not run"})`,
    `Claude runs: ${result.rounds.length} (${result.rounds.length - 1} fix-up)`
  ];
  if (meta.testFiles.length === 0) {
    lines.push("Warning: no --tests given, so test-file tampering was not checked.");
  }
  if (result.modifiedTests.length > 0) {
    lines.push(`Modified or deleted test files: ${result.modifiedTests.join(", ")}`);
  }
  if (meta.diffStat) {
    lines.push("", "Changes:", meta.diffStat.trimEnd());
  }
  const summary = String(result.claudeResult?.text ?? "").trim().split("\n").slice(-10).join("\n");
  if (summary) {
    lines.push("", "Claude said (last lines):", summary);
  }
  if (result.verify && result.verify.exitCode !== 0) {
    lines.push("", "Verification output (last lines):", tailText(result.verify.output, 1500).trimEnd());
  }
  return `${lines.join("\n")}\n`;
}
