import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runAgyTask } from "../lib/agy.mjs";
import { readStdinIfPiped } from "../lib/fs.mjs";
import { ensureGitRepository, getCurrentBranch, isWorkingTreeDirty } from "../lib/git.mjs";
import { detectVerifyCommand, hashFiles, parseTestList, renderHandoffReport, runHandoffLoop } from "../lib/handoff.mjs";
import { sumUsage } from "../lib/usage.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";
import { buildAgyRunOptions, buildDryRunReport, createCompanionJob, enqueueBackgroundTask, ensureAgyAvailable, ensureValidEffort, ensureValidModel, interpolateTemplate, loadPromptTemplate, outputCommandResult, parseCommandInput, renderDryRunReport, renderQueuedTaskLaunch, resolveCommandCwd, resolveCommandWorkspace, runForegroundCommand, shorten } from "./shared.mjs";

export const DEFAULT_HANDOFF_PRINT_TIMEOUT = "60m";

export function runVerifyCommand(cwd, command) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`
  };
}

export function resolveHandoffPlan(cwd, options, requirement) {
  ensureGitRepository(cwd);
  const root = resolveWorkspaceRoot(cwd);
  if (!requirement.trim()) {
    throw new Error("Provide the requirement as text, --requirement-file, or piped stdin.");
  }
  const branch = getCurrentBranch(cwd);
  if (["main", "master"].includes(branch)) {
    throw new Error(`Refusing to hand off on ${branch}: create a branch first.`);
  }
  if (isWorkingTreeDirty(cwd)) {
    throw new Error("Working tree has uncommitted changes: commit or stash them so the hand-off diff is only agy's work.");
  }
  const verifyCommand = options.verify ?? detectVerifyCommand(root);
  if (!verifyCommand) {
    throw new Error("No verification command found: pass --verify \"<command>\".");
  }
  const maxFixups = options.fixups === undefined ? 1 : Number(options.fixups);
  if (!Number.isInteger(maxFixups) || maxFixups < 0) {
    throw new Error("--fixups must be a whole number of 0 or more.");
  }
  return { root, branch, verifyCommand, maxFixups, testFiles: parseTestList(options.tests) };
}

export function buildHandoffPrompt(requirement, plan) {
  const template = loadPromptTemplate("handoff");
  return interpolateTemplate(template, {
    REQUIREMENT: requirement.trim(),
    VERIFY_COMMAND: plan.verifyCommand,
    TEST_FILES_LINE: plan.testFiles.length
      ? `These test files define the behavior and must pass unmodified: ${plan.testFiles.join(", ")}`
      : ""
  });
}

export async function executeHandoffRun(request) {
  ensureAgyAvailable(request.cwd);
  const { plan, requirement } = request;
  const testHashes = hashFiles(plan.root, plan.testFiles);
  const log = (message) => request.onProgress?.({ message });
  const agyUsages = [];

  const result = await runHandoffLoop({
    prompt: buildHandoffPrompt(requirement, plan),
    verifyCommand: plan.verifyCommand,
    maxFixups: plan.maxFixups,
    testHashes,
    runAgy: (prompt, { resume }) => {
      log(resume ? "Sending fix-up to agy." : "Handing the task to agy.");
      return runAgyTask(request.cwd, prompt, {
        ...(request.agyOptions ?? {}),
        resumeLast: resume,
        onProgress: request.onProgress
      }).then((agyResult) => {
        agyUsages.push(agyResult.usage);
        return agyResult;
      });
    },
    runVerify: (command) => {
      log(`Running ${command}.`);
      return runVerifyCommand(request.cwd, command);
    },
    rehash: () => hashFiles(plan.root, plan.testFiles),
    onProgress: log
  });

  const diffStat = spawnSync("git", ["diff", "--stat"], { cwd: request.cwd, encoding: "utf8" }).stdout ?? "";
  const rendered = renderHandoffReport(result, {
    verifyCommand: plan.verifyCommand,
    testFiles: plan.testFiles,
    diffStat
  });

  return {
    exitStatus: result.status.exitCode,
    payload: {
      status: result.status.label,
      rounds: result.rounds,
      modifiedTests: result.modifiedTests,
      verifyCommand: plan.verifyCommand,
      verifyExitCode: result.verify?.exitCode ?? null,
      branch: plan.branch
    },
    rendered,
    usage: sumUsage(agyUsages),
    summary: `Hand-off ${result.status.label}`,
    jobTitle: "agy Hand-off",
    jobClass: "task"
  };
}

export async function handleHandoff(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "requirement-file", "verify", "tests", "fixups", "model", "tier", "effort", "add-dir", "log-file", "print-timeout"],
    repeatableOptions: ["add-dir", "tests"],
    booleanOptions: ["json", "background", "wait", "dry-run"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const requirement = options["requirement-file"]
    ? fs.readFileSync(path.resolve(cwd, options["requirement-file"]), "utf8")
    : positionals.join(" ") || readStdinIfPiped();
  const plan = resolveHandoffPlan(cwd, options, requirement);

  const agyOptions = buildAgyRunOptions(cwd, options, {});
  agyOptions.printTimeout = agyOptions.printTimeout ?? DEFAULT_HANDOFF_PRINT_TIMEOUT;
  ensureValidModel(cwd, agyOptions);
  ensureValidEffort(agyOptions);

  if (options["dry-run"]) {
    const report = buildDryRunReport(cwd, "agy Hand-off", agyOptions, [
      `Branch: ${plan.branch}`,
      `Verify: ${plan.verifyCommand}`,
      `Fix-ups allowed: ${plan.maxFixups}`,
      `Test files: ${plan.testFiles.length ? plan.testFiles.join(", ") : "(none: tampering not checked)"}`,
      `Requirement: ${shorten(requirement, 240)}`
    ]);
    outputCommandResult(report, renderDryRunReport(report), options.json);
    return;
  }

  const job = createCompanionJob({
    prefix: "handoff",
    kind: "handoff",
    title: "agy Hand-off",
    workspaceRoot,
    jobClass: "task",
    summary: shorten(requirement)
  });
  const request = { kind: "handoff", cwd, requirement, plan, agyOptions, jobId: job.id };

  if (options.background) {
    ensureAgyAvailable(cwd);
    const { payload } = enqueueBackgroundTask(cwd, job, request);
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  await runForegroundCommand(
    job,
    (progress) => executeHandoffRun({ ...request, onProgress: progress }),
    { json: options.json }
  );
}
