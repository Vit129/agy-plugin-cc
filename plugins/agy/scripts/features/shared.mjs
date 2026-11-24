import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getAgyAvailability, installHint, resolveTierModel, runAgyModels } from "../lib/agy.mjs";
import { parseArgs, splitRawArgumentString } from "../lib/args.mjs";
import { DIGEST_CHAR_LIMIT, digestOutput } from "../lib/render.mjs";
import { generateJobId, resolveJobsDir, upsertJob, writeJobFile } from "../lib/state.mjs";
import { SESSION_ID_ENV, appendLogLine, createJobLogFile, createJobProgressUpdater, createJobRecord, createProgressReporter, runTrackedJob } from "../lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";
import { buildQuotaLines } from "./setup.mjs";

export const ROOT_DIR = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;

export const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;

export function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

// A failed command writes its diagnostic to stderr. JSON callers still get the payload.
export function outputCommandResult(payload, rendered, asJson, exitCode = 0) {
  if (exitCode !== 0 && !asJson) {
    process.stderr.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`);
    return;
  }
  outputResult(asJson ? payload : rendered, asJson);
}

// Shown under a task's output when agy exited nonzero, so the diagnostic is not lost.
export function renderStderrBlock(stderr, exitCode) {
  const text = String(stderr ?? "").trim();
  if (!text) return "";
  return `\n--- agy stderr (exit ${exitCode}) ---\n${text}\n`;
}

export function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

export function parseCommandInput(argv, config = {}) {
  const normalized = normalizeArgv(argv);
  if (normalized.slice(0, normalized.indexOf("--") < 0 ? undefined : normalized.indexOf("--")).some((arg) => arg === "--sandbox" || arg.startsWith("--sandbox="))) {
    throw new Error("--sandbox is no longer supported for delegation; remove --sandbox and specify read-only behavior in the prompt if needed.");
  }
  return parseArgs(normalized, {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

export function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

export function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shorten(text, limit = 96) {
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

export function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

export function normalizeOptionList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function resolveOptionalPath(cwd, value) {
  return value ? path.resolve(cwd, value) : null;
}

export function buildAgyRunOptions(cwd, options = {}, config = {}) {
  const addDirs = normalizeOptionList(options["add-dir"]).map((dir) =>
    path.resolve(cwd, dir)
  );

  return {
    resumeLast: Boolean(config.allowResume && (options["continue"] || options["resume-last"] || options.resume)),
    conversation: config.allowConversation ? options.conversation ?? null : null,
    model: resolveTierModel(options.tier, options.model),
    effort: options.effort ?? null,
    project: options.project ?? null,
    newProject: Boolean(options["new-project"]),
    dangerouslySkipPermissions: true,
    addDirs,
    logFile: resolveOptionalPath(cwd, options["log-file"]),
    printTimeout: options["print-timeout"] ?? null
  };
}

export function describeAgyRunOptions(agyOptions = {}) {
  const parts = [];
  if (agyOptions.model) parts.push(`model: ${agyOptions.model}`);
  if (agyOptions.effort) parts.push(`effort: ${agyOptions.effort}`);
  if (agyOptions.conversation) parts.push(`conversation: ${agyOptions.conversation}`);
  if (agyOptions.newProject) parts.push("new project");
  else if (agyOptions.project) parts.push(`project: ${agyOptions.project}`);
  if (agyOptions.dangerouslySkipPermissions) parts.push("--dangerously-skip-permissions (no agy sandbox)");
  if (agyOptions.addDirs?.length) parts.push(`add dirs: ${agyOptions.addDirs.length}`);
  if (agyOptions.printTimeout) parts.push(`timeout: ${agyOptions.printTimeout}`);
  if (agyOptions.logFile) parts.push(`log: ${agyOptions.logFile}`);
  return parts;
}

export function getCurrentClaudeSessionId() {
  return process.env[SESSION_ID_ENV] ?? null;
}

export function filterJobsForCurrentClaudeSession(jobs) {
  const sessionId = getCurrentClaudeSessionId();
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

export function isActiveJobStatus(status) {
  return status === "queued" || status === "running";
}

export function ensureAgyAvailable(cwd) {
  const availability = getAgyAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      `agy CLI is not installed. Install it with: ${installHint()}`
    );
  }
}

export function ensureValidModel(cwd, agyOptions) {
  if (!agyOptions.model) {
    return;
  }
  const result = runAgyModels(cwd, { timeout: 10000 });
  if (result.exitCode !== 0) {
    process.stderr.write(`warning: could not validate model "${agyOptions.model}" (agy models exit ${result.exitCode}); continuing.\n${renderStderrBlock(result.stderr, result.exitCode)}`);
    return;
  }
  const rawLines = parseModelLines(result.stdout);
  if (rawLines.length === 0) {
    return;
  }
  const modelIds = rawLines.map((line) => line.split(/\s+/)[0]);
  if (modelIds.includes(agyOptions.model) || rawLines.includes(agyOptions.model)) {
    return;
  }
  throw new Error(
    `Unknown --model "${agyOptions.model}". Available models:\n${rawLines.map((model) => `- ${model}`).join("\n")}`
  );
}

export const VALID_EFFORT_VALUES = ["low", "medium", "high"];

export function ensureValidEffort(agyOptions) {
  if (!agyOptions.effort) {
    return;
  }
  if (VALID_EFFORT_VALUES.includes(agyOptions.effort)) {
    return;
  }
  throw new Error(
    `Unknown --effort "${agyOptions.effort}". Valid values: ${VALID_EFFORT_VALUES.join(", ")}`
  );
}

export function loadPromptTemplate(name) {
  const templatePath = path.join(ROOT_DIR, "prompts", `${name}.md`);
  if (!fs.existsSync(templatePath)) {
    return null;
  }
  return fs.readFileSync(templatePath, "utf8");
}

export function interpolateTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value ?? "");
  }
  return result;
}

export function writeFullOutput(cwd, label, text) {
  const dir = resolveJobsDir(resolveWorkspaceRoot(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}-${Date.now()}-output.md`);
  fs.writeFileSync(file, text, "utf8");
  return file;
}

export function capOutput(cwd, label, text) {
  const output = typeof text === "string" ? text : "";
  if (output.length <= DIGEST_CHAR_LIMIT) return output;
  return digestOutput(output, writeFullOutput(cwd, label, output)).text;
}

export function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary }) {
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

export function createTrackedProgress(job, options = {}) {
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

export function buildTaskJob(workspaceRoot, taskMetadata) {
  return createCompanionJob({
    prefix: "task",
    kind: "task",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary
  });
}

export async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  if (execution.exitStatus !== 0 && !options.json) {
    outputCommandResult(execution.payload, execution.rendered, false, execution.exitStatus);
  } else {
    outputResult(options.json ? execution.payload : execution.rendered, options.json);
  }
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

export function spawnDetachedTaskWorker(cwd, jobId) {
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

export function enqueueBackgroundTask(cwd, job, request) {
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

export function renderQueuedTaskLaunch(payload) {
  return `${payload.title} started in the background as ${payload.jobId}. Check /agy:status ${payload.jobId} for progress.\n`;
}

export function buildDryRunReport(cwd, title, agyOptions, details = []) {
  const modelsResult = runAgyModels(cwd, { timeout: 10000 });
  const models = modelsResult.exitCode === 0 ? parseModelLines(modelsResult.stdout) : [];
  return {
    ok: true,
    dryRun: true,
    title,
    details,
    options: describeAgyRunOptions(agyOptions),
    model: agyOptions.model,
    models,
    quota: buildQuotaLines(cwd)
  };
}

export function renderDryRunReport(report) {
  const lines = [`# ${report.title} (dry run)`, ""];
  lines.push(...report.details);
  if (report.options.length > 0) {
    lines.push(`Options: ${report.options.join(", ")}`);
  }
  lines.push(
    "",
    report.models.length > 0 ? "Available models:" : "Available models: (agy models unavailable)"
  );
  for (const model of report.models) {
    lines.push(model === report.model ? `- ${model} (selected)` : `- ${model}`);
  }
  lines.push("", "Antigravity quota:", ...report.quota);
  lines.push("", "No agy run performed.");
  return lines.join("\n") + "\n";
}

export function parseModelLines(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
