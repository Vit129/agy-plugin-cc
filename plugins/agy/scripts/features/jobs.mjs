import process from "node:process";
import { buildSingleJobSnapshot, buildStatusSnapshot, readStoredJob, resolveCancelableJob, resolveResultJob } from "../lib/job-control.mjs";
import { terminateProcessTree } from "../lib/process.mjs";
import { renderCancelReport, renderJobStatusReport, renderStatusReport, renderStoredJobResult } from "../lib/render.mjs";
import { upsertJob, writeJobFile } from "../lib/state.mjs";
import { appendLogLine, nowIso, runTrackedJob } from "../lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";
import { executeHandoffRun } from "./handoff.mjs";
import { executeReviewRun } from "./review.mjs";
import { DEFAULT_STATUS_POLL_INTERVAL_MS, DEFAULT_STATUS_WAIT_TIMEOUT_MS, createTrackedProgress, isActiveJobStatus, outputCommandResult, outputResult, parseCommandInput, resolveCommandCwd, sleep } from "./shared.mjs";
import { executeTaskRun } from "./task.mjs";

export async function waitForSingleJobSnapshot(cwd, reference, options = {}) {
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

export async function handleStatus(argv) {
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

export function handleResult(argv) {
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

export async function handleCancel(argv) {
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

export async function handleTaskWorker(argv) {
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
    () =>
      request.kind === "review"
        ? executeReviewRun({ ...request, onProgress: progress })
        : request.kind === "handoff"
          ? executeHandoffRun({ ...request, onProgress: progress })
          : executeTaskRun({ ...request, onProgress: progress }),
    { logFile }
  );
}
