#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { getAgyAuthStatus, getAgyAvailability, runAgyChangelog, runAgyModels, runAgyPlugins, runAgyTask, runAgyTaskSync } from "./lib/agy.mjs";
import { readStdinIfPiped } from "./lib/fs.mjs";
import { ensureGitRepository, resolveReviewTarget } from "./lib/git.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import {
  generateJobId,
  getConfig,
  listJobs,
  setConfig,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  enrichJob,
  findLatestResumableTaskJob,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  nowIso,
  runTrackedJob,
  SESSION_ID_ENV
} from "./lib/tracked-jobs.mjs";
import { checkForPluginUpdate } from "./lib/update-check.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult
} from "./lib/render.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;
const STOP_REVIEW_TASK_MARKER = "Run a stop-gate review of the previous agy turn.";
const STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/agy-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--enable-auto-update|--disable-auto-update] [--json]",
      "  node scripts/agy-companion.mjs models [--json]",
      "  node scripts/agy-companion.mjs doctor [--json]",
      "  node scripts/agy-companion.mjs changelog [--json]",
      "  node scripts/agy-companion.mjs plugins [--json]",
      "  node scripts/agy-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <name>] [--project <id>|--new-project] [--dangerously-skip-permissions] [--add-dir <path>] [--log-file <path>] [--print-timeout <duration>]",
      "  node scripts/agy-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <name>] [--project <id>|--new-project] [--dangerously-skip-permissions] [--add-dir <path>] [--log-file <path>] [--print-timeout <duration>] [focus text]",
      "  node scripts/agy-companion.mjs task [--background] [--sandbox] [--continue|--resume-last|--resume|--fresh] [--conversation <id>] [--model <name>] [--project <id>|--new-project] [--dangerously-skip-permissions] [--add-dir <path>] [--log-file <path>] [--print-timeout <duration>] [prompt]",
      "  node scripts/agy-companion.mjs task-worker --job-id <id>",
      "  node scripts/agy-companion.mjs task-resume-candidate [--json]",
      "  node scripts/agy-companion.mjs status [job-id] [--wait] [--all] [--json]",
      "  node scripts/agy-companion.mjs result [job-id] [--json]",
      "  node scripts/agy-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function normalizeOptionList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveOptionalPath(cwd, value) {
  return value ? path.resolve(cwd, value) : null;
}

function buildAgyRunOptions(cwd, options = {}, config = {}) {
  const addDirs = normalizeOptionList(options["add-dir"]).map((dir) =>
    path.resolve(cwd, dir)
  );

  return {
    sandbox: Boolean(options.sandbox || config.forceSandbox),
    resumeLast: Boolean(config.allowResume && (options["continue"] || options["resume-last"] || options.resume)),
    conversation: config.allowConversation ? options.conversation ?? null : null,
    model: options.model ?? null,
    project: options.project ?? null,
    newProject: Boolean(options["new-project"]),
    dangerouslySkipPermissions: Boolean(options["dangerously-skip-permissions"]),
    addDirs,
    logFile: resolveOptionalPath(cwd, options["log-file"]),
    printTimeout: options["print-timeout"] ?? null
  };
}

function describeAgyRunOptions(agyOptions = {}) {
  const parts = [];
  if (agyOptions.model) parts.push(`model: ${agyOptions.model}`);
  if (agyOptions.conversation) parts.push(`conversation: ${agyOptions.conversation}`);
  if (agyOptions.newProject) parts.push("new project");
  else if (agyOptions.project) parts.push(`project: ${agyOptions.project}`);
  if (agyOptions.dangerouslySkipPermissions) parts.push("skip permissions");
  if (agyOptions.addDirs?.length) parts.push(`add dirs: ${agyOptions.addDirs.length}`);
  if (agyOptions.printTimeout) parts.push(`timeout: ${agyOptions.printTimeout}`);
  if (agyOptions.logFile) parts.push(`log: ${agyOptions.logFile}`);
  return parts;
}

function getCurrentClaudeSessionId() {
  return process.env[SESSION_ID_ENV] ?? null;
}

function filterJobsForCurrentClaudeSession(jobs) {
  const sessionId = getCurrentClaudeSessionId();
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function isActiveJobStatus(status) {
  return status === "queued" || status === "running";
}

function ensureAgyAvailable(cwd) {
  const availability = getAgyAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "agy CLI is not installed. Install it with: curl -fsSL https://antigravity.google/cli/install.sh | bash"
    );
  }
}

async function buildSetupReport(cwd, actionsTaken = []) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const agyStatus = getAgyAvailability(cwd);
  const authStatus = getAgyAuthStatus(cwd);
  const config = getConfig(workspaceRoot);
  const update = checkForPluginUpdate(config);
  if (update.checkedAt) {
    setConfig(workspaceRoot, "lastUpdateCheckAt", update.checkedAt);
  }

  const nextSteps = [];
  if (!agyStatus.available) {
    nextSteps.push(
      "Install agy with: curl -fsSL https://antigravity.google/cli/install.sh | bash"
    );
  }
  if (!config.stopReviewGate) {
    nextSteps.push(
      "Optional: run `/agy:setup --enable-review-gate` to require a fresh review before stop."
    );
  }
  if (update.updateAvailable && !update.autoUpdate) {
    nextSteps.push(
      `Agy plugin update available: ${update.currentVersion} -> ${update.latestVersion}. Run: npx -y @vit129/agy-plugin-cc@latest install`
    );
  }
  if (update.autoUpdateStarted) {
    nextSteps.push(
      `Agy plugin update installing in background (${update.currentVersion} -> ${update.latestVersion}). Run \`/reload-plugins\` after it finishes, or check ${update.installLogPath}.`
    );
  }

  return {
    ready: agyStatus.available,
    agy: agyStatus,
    auth: authStatus,
    reviewGateEnabled: Boolean(config.stopReviewGate),
    autoUpdateEnabled: Boolean(update.autoUpdate),
    update,
    actionsTaken,
    nextSteps
  };
}

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: [
      "json",
      "enable-review-gate",
      "disable-review-gate",
      "enable-auto-update",
      "disable-auto-update"
    ]
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }
  if (options["enable-auto-update"] && options["disable-auto-update"]) {
    throw new Error("Choose either --enable-auto-update or --disable-auto-update.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }
  if (options["enable-auto-update"]) {
    setConfig(workspaceRoot, "autoUpdate", true);
    setConfig(workspaceRoot, "lastUpdateCheckAt", null);
    actionsTaken.push("Enabled opt-in plugin auto-update for this workspace.");
  } else if (options["disable-auto-update"]) {
    setConfig(workspaceRoot, "autoUpdate", false);
    actionsTaken.push("Disabled plugin auto-update for this workspace.");
  }

  const finalReport = await buildSetupReport(cwd, actionsTaken);
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), options.json);
}

function loadPromptTemplate(name) {
  const templatePath = path.join(ROOT_DIR, "prompts", `${name}.md`);
  if (!fs.existsSync(templatePath)) {
    return null;
  }
  return fs.readFileSync(templatePath, "utf8");
}

function interpolateTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value ?? "");
  }
  return result;
}

function buildReviewPrompt(target, reviewName, focusText) {
  const template = loadPromptTemplate(
    reviewName === "Adversarial Review" ? "adversarial-review" : "review"
  );
  if (!template) {
    const base =
      reviewName === "Adversarial Review"
        ? `Perform an adversarial review of the ${target.label}. Try to find the strongest reasons this change should NOT ship. Look for correctness bugs, security issues, data loss risks, race conditions, and breaking changes. Report only material findings with file paths and line numbers.`
        : `Review the ${target.label}. Report any correctness bugs, missing error handling, security issues, or other material concerns. Be specific about file paths and line numbers.`;
    return focusText ? `${base}\n\nAdditional focus: ${focusText}` : base;
  }

  const diffArgs =
    target.mode === "working-tree"
      ? "--cached HEAD && git diff"
      : `${target.baseRef}...HEAD`;

  return interpolateTemplate(template, {
    TARGET_LABEL: target.label,
    REVIEW_KIND: reviewName,
    USER_FOCUS: focusText || "No extra focus provided.",
    DIFF_ARGS: diffArgs
  });
}

async function executeReviewRun(request) {
  ensureAgyAvailable(request.cwd);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });
  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";
  const prompt = buildReviewPrompt(target, reviewName, focusText);

  const result = await runAgyTask(request.cwd, prompt, {
    ...(request.agyOptions ?? {}),
    sandbox: true,
    onProgress: request.onProgress
  });

  const rendered = renderReviewResult(result.stdout, {
    reviewLabel: reviewName,
    targetLabel: target.label
  });
  const payload = {
    review: reviewName,
    target,
    agy: {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    }
  };

  return {
    exitStatus: result.exitCode,
    payload,
    rendered,
    summary: firstMeaningfulLine(result.stdout, `${reviewName} finished.`),
    jobTitle: `agy ${reviewName}`,
    jobClass: "review",
    targetLabel: target.label
  };
}

function buildTaskRunMetadata({ prompt, resumeLast = false }) {
  if (!resumeLast && String(prompt ?? "").includes(STOP_REVIEW_TASK_MARKER)) {
    return {
      title: "agy Stop Gate Review",
      summary: "Stop-gate review of previous Claude turn"
    };
  }

  const title = resumeLast ? "agy Resume" : "agy Task";
  const fallbackSummary = resumeLast ? "Continue." : "Task";
  return {
    title,
    summary: shorten(prompt || fallbackSummary)
  };
}

async function executeTaskRun(request) {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  ensureAgyAvailable(request.cwd);

  const agyOptions = {
    ...(request.agyOptions ?? {}),
    resumeLast: Boolean(request.resumeLast ?? request.agyOptions?.resumeLast),
    sandbox: Boolean(request.sandbox ?? request.agyOptions?.sandbox)
  };
  const taskMetadata = buildTaskRunMetadata({
    prompt: request.prompt,
    resumeLast: agyOptions.resumeLast
  });

  if (!request.prompt && !agyOptions.resumeLast && !agyOptions.conversation) {
    throw new Error("Provide prompt, piped stdin, or use --continue.");
  }

  const result = await runAgyTask(request.cwd, request.prompt || "Continue.", {
    ...agyOptions,
    onProgress: request.onProgress
  });

  const rawOutput = result.stdout ?? "";
  const failureMessage = result.stderr ?? "";
  const rendered = renderTaskResult(
    { rawOutput, failureMessage },
    { title: taskMetadata.title, jobId: request.jobId ?? null }
  );
  const payload = {
    status: result.exitCode === 0 ? "completed" : "failed",
    exitCode: result.exitCode,
    rawOutput
  };

  return {
    exitStatus: result.exitCode,
    payload,
    rendered,
    summary: firstMeaningfulLine(rawOutput, firstMeaningfulLine(failureMessage, `${taskMetadata.title} finished.`)),
    jobTitle: taskMetadata.title,
    jobClass: "task"
  };
}

function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: jobClass === "review" ? kind : "rescue",
    title,
    workspaceRoot,
    jobClass,
    summary
  });
}

function createTrackedProgress(job, options = {}) {
  const logFile =
    options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
    })
  };
}

function buildTaskJob(workspaceRoot, taskMetadata) {
  return createCompanionJob({
    prefix: "task",
    kind: "task",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary
  });
}

async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

function spawnDetachedTaskWorker(cwd, jobId) {
  const scriptPath = path.join(ROOT_DIR, "scripts", "agy-companion.mjs");
  const child = spawn(
    process.execPath,
    [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId],
    {
      cwd,
      env: process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  );
  child.unref();
  return child;
}

function enqueueBackgroundTask(cwd, job, request) {
  const { logFile } = createTrackedProgress(job);
  appendLogLine(logFile, "Queued for background execution.");

  const child = spawnDetachedTaskWorker(cwd, job.id);
  const queuedRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid: child.pid ?? null,
    logFile,
    request
  };
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  return {
    payload: {
      jobId: job.id,
      status: "queued",
      title: job.title,
      summary: job.summary,
      logFile
    },
    logFile
  };
}

function renderQueuedTaskLaunch(payload) {
  return `${payload.title} started in the background as ${payload.jobId}. Check /agy:status ${payload.jobId} for progress.\n`;
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findPluginManifest() {
  const candidates = [
    path.join(ROOT_DIR, ".codex-plugin", "plugin.json"),
    path.join(ROOT_DIR, ".claude-plugin", "plugin.json")
  ];
  const manifestPath = candidates.find((candidate) => fs.existsSync(candidate));
  return {
    path: manifestPath ?? null,
    manifest: manifestPath ? readJsonIfExists(manifestPath) : null
  };
}

function parseModelLines(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseAgyVersion(detail) {
  return String(detail ?? "").match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

function parseLatestChangelogVersion(output) {
  return String(output ?? "").match(/^(\d+\.\d+\.\d+):/m)?.[1] ?? null;
}

function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function buildAgyVersionCheck(cwd, agy) {
  const installed = parseAgyVersion(agy.detail);
  if (!installed) {
    return { installed: null, latest: null, upToDate: null };
  }
  const changelogResult = runAgyChangelog(cwd, { timeout: 10000 });
  const latest = changelogResult.exitCode === 0 ? parseLatestChangelogVersion(changelogResult.stdout) : null;
  return {
    installed,
    latest,
    upToDate: latest ? compareVersions(installed, latest) >= 0 : null
  };
}

function buildHostDoctor(manifestVersion) {
  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
  const claudeMarketplacePath = path.join(
    os.homedir(),
    ".claude",
    "plugins",
    "marketplaces",
    "agy-plugin-cc.json"
  );
  const codexConfig = fs.existsSync(codexConfigPath)
    ? fs.readFileSync(codexConfigPath, "utf8")
    : "";
  const host = fs.existsSync(path.join(ROOT_DIR, ".codex-plugin")) ? "codex" : "claude";

  if (host === "codex") {
    const skillPathMatches = [
      ...codexConfig.matchAll(
        /path = "([^"]*agy-plugin-codex\/agy\/([^"]+)\/skills\/[^"]+\/SKILL\.md)"/g
      )
    ];
    const skillPaths = skillPathMatches.map((match) => match[1]);
    const staleSkillPaths = skillPathMatches
      .filter((match) => manifestVersion && match[2] !== manifestVersion)
      .map((match) => match[1]);
    return {
      host,
      configPath: codexConfigPath,
      configExists: Boolean(codexConfig),
      pluginEnabled: /\[plugins\."agy@agy-plugin-codex"\][\s\S]*?enabled = true/.test(codexConfig),
      skillPaths,
      staleSkillPaths
    };
  }

  const pointer = readJsonIfExists(claudeMarketplacePath);
  return {
    host,
    marketplacePointerPath: claudeMarketplacePath,
    marketplacePointerExists: Boolean(pointer),
    marketplacePointer: pointer
  };
}

function buildDoctorReport(cwd) {
  const { path: manifestPath, manifest } = findPluginManifest();
  const agy = getAgyAvailability(cwd);
  const auth = getAgyAuthStatus(cwd);
  const modelsResult = agy.available ? runAgyModels(cwd, { timeout: 10000 }) : null;
  const models = modelsResult?.exitCode === 0 ? parseModelLines(modelsResult.stdout) : [];
  const host = buildHostDoctor(manifest?.version ?? null);
  const versionCheck = agy.available ? buildAgyVersionCheck(cwd, agy) : { installed: null, latest: null, upToDate: null };

  return {
    ready: Boolean(agy.available && auth.loggedIn && manifest),
    plugin: {
      root: ROOT_DIR,
      manifestPath,
      version: manifest?.version ?? null,
      name: manifest?.name ?? null
    },
    host,
    agy,
    auth,
    versionCheck,
    models: {
      ok: modelsResult ? modelsResult.exitCode === 0 : false,
      count: models.length,
      items: models,
      error:
        modelsResult && modelsResult.exitCode !== 0
          ? (modelsResult.stderr || modelsResult.stdout || "agy models failed").trim()
          : null
    }
  };
}

function renderModelsReport(models) {
  if (models.length === 0) {
    return "No agy models reported.\n";
  }
  return models.join("\n") + "\n";
}

function renderDoctorReport(report) {
  const lines = [
    "# agy Doctor",
    "",
    "Ready: " + (report.ready ? "yes" : "no"),
    "Plugin: " + (report.plugin.name ?? "unknown") + " " + (report.plugin.version ?? "unknown"),
    "Host: " + report.host.host,
    "agy: " + (report.agy.available ? report.agy.detail : "missing (" + report.agy.detail + ")"),
    "auth: " + (report.auth.loggedIn ? "ok" : report.auth.detail),
    "models: " + (report.models.ok ? report.models.count + " available" : report.models.error ?? "not checked")
  ];

  if (report.versionCheck.installed) {
    const { installed, latest, upToDate } = report.versionCheck;
    lines.push(
      "agy version: " +
        (latest
          ? upToDate
            ? `${installed} (up to date)`
            : `${installed} -> ${latest} available. Run: agy update`
          : `${installed} (latest unknown — changelog check failed)`)
    );
  }

  if (report.host.host === "codex") {
    lines.push(
      "Codex config: " + (report.host.configExists ? report.host.configPath : "missing"),
      "Codex plugin enabled: " + (report.host.pluginEnabled ? "yes" : "no"),
      "Skill paths: " + report.host.skillPaths.length,
      "Stale skill paths: " + report.host.staleSkillPaths.length
    );
    for (const stalePath of report.host.staleSkillPaths) {
      lines.push("- stale: " + stalePath);
    }
  } else {
    lines.push(
      "Claude marketplace pointer: " +
        (report.host.marketplacePointerExists ? report.host.marketplacePointerPath : "missing")
    );
  }

  if (report.models.items.length > 0) {
    lines.push("", "Models:");
    for (const model of report.models.items) {
      lines.push("- " + model);
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

function handleModels(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const result = runAgyModels(cwd, { timeout: 10000 });
  const models = result.exitCode === 0 ? parseModelLines(result.stdout) : [];
  const payload = { ok: result.exitCode === 0, models, exitCode: result.exitCode, stderr: result.stderr };
  outputCommandResult(
    payload,
    result.exitCode === 0 ? renderModelsReport(models) : (result.stderr || result.stdout || "agy models failed\n"),
    options.json
  );
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

function handleDoctor(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const report = buildDoctorReport(cwd);
  outputCommandResult(report, renderDoctorReport(report), options.json);
}

function handleChangelog(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const result = runAgyChangelog(cwd, { timeout: 10000 });
  const payload = { ok: result.exitCode === 0, text: result.stdout, exitCode: result.exitCode, stderr: result.stderr };
  outputCommandResult(
    payload,
    result.exitCode === 0 ? result.stdout : (result.stderr || result.stdout || "agy changelog failed\n"),
    options.json
  );
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

function handlePlugins(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const result = runAgyPlugins(cwd, { timeout: 10000 });
  const payload = { ok: result.exitCode === 0, text: result.stdout, exitCode: result.exitCode, stderr: result.stderr };
  outputCommandResult(
    payload,
    result.exitCode === 0 ? result.stdout : (result.stderr || result.stdout || "agy plugin list failed\n"),
    options.json
  );
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "cwd", "model", "project", "add-dir", "log-file", "print-timeout"],
    repeatableOptions: ["add-dir"],
    booleanOptions: ["json", "background", "wait", "new-project", "dangerously-skip-permissions"]
  });

  if (options.project && options["new-project"]) {
    throw new Error("Choose either --project or --new-project.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  const agyOptions = buildAgyRunOptions(cwd, options, { forceSandbox: true });

  const job = createCompanionJob({
    prefix: "review",
    kind: config.reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: `agy ${config.reviewName}`,
    workspaceRoot,
    jobClass: "review",
    summary: focusText ? shorten(focusText) : config.reviewName
  });

  if (options.background) {
    ensureAgyAvailable(cwd);
    ensureGitRepository(cwd);
    const request = {
      kind: "review",
      cwd,
      base: options.base,
      scope: options.scope,
      focusText,
      reviewName: config.reviewName,
      agyOptions,
      jobId: job.id
    };
    const { payload } = enqueueBackgroundTask(cwd, job, request);
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  await runForegroundCommand(
    job,
    (progress) =>
      executeReviewRun({
        cwd,
        base: options.base,
        scope: options.scope,
        focusText,
        reviewName: config.reviewName,
        agyOptions,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "prompt-file", "conversation", "model", "project", "add-dir", "log-file", "print-timeout"],
    repeatableOptions: ["add-dir"],
    booleanOptions: [
      "json",
      "sandbox",
      "continue",
      "resume-last",
      "resume",
      "fresh",
      "background",
      "wait",
      "new-project",
      "dangerously-skip-permissions"
    ]
  });

  if (options.project && options["new-project"]) {
    throw new Error("Choose either --project or --new-project.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);

  let prompt = "";
  if (options["prompt-file"]) {
    prompt = fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  } else {
    const positionalPrompt = positionals.join(" ");
    prompt = positionalPrompt || readStdinIfPiped();
  }

  const agyOptions = buildAgyRunOptions(cwd, options, { allowResume: true, allowConversation: true });
  const fresh = Boolean(options.fresh);
  if (agyOptions.resumeLast && fresh) {
    throw new Error("Choose either --continue/--resume/--resume-last or --fresh.");
  }
  if (agyOptions.resumeLast && agyOptions.conversation) {
    throw new Error("Choose either --continue/--resume/--resume-last or --conversation.");
  }
  if (!prompt && !agyOptions.resumeLast && !agyOptions.conversation) {
    throw new Error("Provide prompt, prompt file, piped stdin, --conversation, or use --continue.");
  }

  const taskMetadata = buildTaskRunMetadata({ prompt, resumeLast: agyOptions.resumeLast });
  const optionSummary = describeAgyRunOptions(agyOptions);
  if (optionSummary.length > 0) {
    taskMetadata.summary = `${taskMetadata.summary} (${optionSummary.join(", ")})`;
  }

  if (options.background) {
    ensureAgyAvailable(cwd);
    const job = buildTaskJob(workspaceRoot, taskMetadata);
    const request = {
      cwd,
      prompt,
      agyOptions,
      resumeLast: agyOptions.resumeLast,
      sandbox: agyOptions.sandbox,
      jobId: job.id
    };
    const { payload } = enqueueBackgroundTask(cwd, job, request);
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  const job = buildTaskJob(workspaceRoot, taskMetadata);
  await runForegroundCommand(
    job,
    (progress) => executeTaskRun({ cwd, prompt, agyOptions, jobId: job.id, onProgress: progress }),
    { json: options.json }
  );
}

async function handleTaskWorker(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "job-id"]
  });

  if (!options["job-id"]) {
    throw new Error("Missing required --job-id for task-worker.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const storedJob = readStoredJob(workspaceRoot, options["job-id"]);
  if (!storedJob) {
    throw new Error(`No stored job found for ${options["job-id"]}.`);
  }

  const request = storedJob.request;
  if (!request || typeof request !== "object") {
    throw new Error(`Stored job ${options["job-id"]} is missing its task request payload.`);
  }

  const { logFile, progress } = createTrackedProgress(
    { ...storedJob, workspaceRoot },
    { logFile: storedJob.logFile ?? null }
  );
  await runTrackedJob(
    { ...storedJob, workspaceRoot, logFile },
    () => executeTaskRun({ ...request, onProgress: progress }),
    { logFile }
  );
}

async function waitForSingleJobSnapshot(cwd, reference, options = {}) {
  const timeoutMs = Math.max(
    0,
    Number(options.timeoutMs) || DEFAULT_STATUS_WAIT_TIMEOUT_MS
  );
  const pollIntervalMs = Math.max(
    100,
    Number(options.pollIntervalMs) || DEFAULT_STATUS_POLL_INTERVAL_MS
  );
  const deadline = Date.now() + timeoutMs;
  let snapshot = buildSingleJobSnapshot(cwd, reference);

  while (isActiveJobStatus(snapshot.job.status) && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = buildSingleJobSnapshot(cwd, reference);
  }

  return {
    ...snapshot,
    waitTimedOut: isActiveJobStatus(snapshot.job.status),
    timeoutMs
  };
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";

  if (reference) {
    const snapshot = options.wait
      ? await waitForSingleJobSnapshot(cwd, reference, {
          timeoutMs: options["timeout-ms"],
          pollIntervalMs: options["poll-interval-ms"]
        })
      : buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), options.json);
    return;
  }

  if (options.wait) {
    throw new Error("`status --wait` requires a job id.");
  }

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(
    options.json ? report : renderStatusReport(report),
    options.json
  );
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const payload = { job, storedJob };

  outputCommandResult(payload, renderStoredJobResult(job, storedJob), options.json);
}

function handleTaskResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const jobs = filterJobsForCurrentClaudeSession(
    sortJobsNewestFirst(listJobs(workspaceRoot))
  );
  const candidate = findLatestResumableTaskJob(jobs);

  const payload = {
    available: Boolean(candidate),
    candidate:
      candidate == null
        ? null
        : {
            id: candidate.id,
            status: candidate.status,
            title: candidate.title ?? null,
            summary: candidate.summary ?? null,
            completedAt: candidate.completedAt ?? null,
            updatedAt: candidate.updatedAt ?? null
          }
  };

  const rendered = candidate
    ? `Resumable task found: ${candidate.id} (${candidate.status}).\n`
    : "No resumable task found for this session.\n";
  outputCommandResult(payload, rendered, options.json);
}

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, {
    env: process.env
  });
  const existing = readStoredJob(workspaceRoot, job.id) ?? {};

  terminateProcessTree(job.pid ?? Number.NaN);
  appendLogLine(job.logFile, "Cancelled by user.");

  const completedAt = nowIso();
  const nextJob = {
    ...job,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
    errorMessage: "Cancelled by user."
  };

  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...nextJob,
    cancelledAt: completedAt
  });
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    errorMessage: "Cancelled by user.",
    completedAt
  });

  const payload = {
    jobId: job.id,
    status: "cancelled",
    title: job.title
  };

  outputCommandResult(payload, renderCancelReport(nextJob), options.json);
}

function buildStopGatePrompt(input = {}) {
  const template = loadPromptTemplate("stop-review-gate");
  const lastAssistantMessage = String(input.last_assistant_message ?? "").trim();
  const claudeResponseBlock = lastAssistantMessage
    ? ["Previous Claude response:", lastAssistantMessage].join("\n")
    : "";

  if (template) {
    return interpolateTemplate(template, {
      CLAUDE_RESPONSE_BLOCK: claudeResponseBlock
    });
  }

  return [
    "Review the previous Claude Code session output and decide whether the session can safely end.",
    "",
    "Respond with one of:",
    "- ALLOW: <brief reason> — if everything looks acceptable",
    "- BLOCK: <reason> — if there are issues that need attention before ending",
    "",
    claudeResponseBlock
  ]
    .filter(Boolean)
    .join("\n");
}

function parseStopReviewOutput(rawOutput) {
  const text = String(rawOutput ?? "").trim();
  if (!text) {
    return {
      ok: false,
      reason:
        "The stop-time agy review returned no output. Run /agy:review --wait manually or bypass the gate."
    };
  }

  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine.startsWith("ALLOW:")) {
    return { ok: true, reason: null };
  }
  if (firstLine.startsWith("BLOCK:")) {
    const reason = firstLine.slice("BLOCK:".length).trim() || text;
    return {
      ok: false,
      reason: `agy stop-time review found issues before ending the session: ${reason}`
    };
  }

  return {
    ok: false,
    reason:
      "The stop-time agy review returned an unexpected answer. Run /agy:review --wait manually or bypass the gate."
  };
}

function runStopGateReview(cwd, input = {}) {
  const prompt = buildStopGatePrompt(input);
  const childEnv = {
    ...process.env,
    ...(input.session_id ? { [SESSION_ID_ENV]: input.session_id } : {})
  };

  const result = runAgyTaskSync(cwd, prompt, {
    sandbox: true,
    env: childEnv,
    timeout: STOP_REVIEW_TIMEOUT_MS
  });

  if (result.timedOut) {
    return {
      ok: false,
      reason:
        "The stop-time agy review timed out after 15 minutes. Run /agy:review --wait manually or bypass the gate."
    };
  }

  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      reason: detail
        ? `The stop-time agy review failed: ${detail}`
        : "The stop-time agy review failed. Run /agy:review --wait manually or bypass the gate."
    };
  }

  return parseStopReviewOutput(result.stdout);
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "models":
      handleModels(argv);
      break;
    case "doctor":
      handleDoctor(argv);
      break;
    case "changelog":
      handleChangelog(argv);
      break;
    case "plugins":
      handlePlugins(argv);
      break;
    case "review":
      await handleReviewCommand(argv, { reviewName: "Review" });
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, { reviewName: "Adversarial Review" });
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
