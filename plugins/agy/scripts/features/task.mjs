import fs from "node:fs";
import path from "node:path";
import { runAgyTask } from "../lib/agy.mjs";
import { readStdinIfPiped } from "../lib/fs.mjs";
import { findLatestResumableTaskJob, sortJobsNewestFirst } from "../lib/job-control.mjs";
import { renderTaskResult } from "../lib/render.mjs";
import { listJobs } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";
import { buildAgyRunOptions, buildDryRunReport, buildTaskJob, capOutput, describeAgyRunOptions, enqueueBackgroundTask, ensureAgyAvailable, ensureValidEffort, ensureValidModel, filterJobsForCurrentClaudeSession, firstMeaningfulLine, outputCommandResult, parseCommandInput, renderDryRunReport, renderQueuedTaskLaunch, renderStderrBlock, resolveCommandCwd, resolveCommandWorkspace, runForegroundCommand, shorten } from "./shared.mjs";

export const STOP_REVIEW_TASK_MARKER = "Run a stop-gate review of the previous agy turn.";

export function buildTaskRunMetadata({ prompt, resumeLast = false }) {
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

export async function executeTaskRun(request) {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  ensureAgyAvailable(request.cwd);

  const agyOptions = {
    ...(request.agyOptions ?? {}),
    resumeLast: Boolean(request.resumeLast ?? request.agyOptions?.resumeLast)
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
    { rawOutput: capOutput(request.cwd, "task", rawOutput), failureMessage },
    { title: taskMetadata.title, jobId: request.jobId ?? null }
  ) + (result.exitCode !== 0 || failureMessage ? renderStderrBlock(failureMessage, result.exitCode) : "");
  const payload = {
    status: result.exitCode === 0 ? "completed" : "failed",
    exitCode: result.exitCode,
    rawOutput,
    stderr: failureMessage
  };

  return {
    exitStatus: result.exitCode,
    payload,
    rendered,
    usage: result.usage ?? null,
    summary: firstMeaningfulLine(rawOutput, firstMeaningfulLine(failureMessage, `${taskMetadata.title} finished.`)),
    jobTitle: taskMetadata.title,
    jobClass: "task"
  };
}

export async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "prompt-file", "conversation", "model", "tier", "effort", "project", "add-dir", "log-file", "print-timeout"],
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
      "dangerously-skip-permissions",
      "dry-run"
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
  ensureValidModel(cwd, agyOptions);
  ensureValidEffort(agyOptions);
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

  if (options["dry-run"]) {
    const report = buildDryRunReport(cwd, "agy Task", agyOptions, [
      `Prompt: ${prompt ? shorten(prompt, 240) : "(none)"}`,
      `Resume last: ${agyOptions.resumeLast ? "yes" : "no"}`,
      `Conversation: ${agyOptions.conversation ?? "(none)"}`
    ]);
    outputCommandResult(report, renderDryRunReport(report), options.json);
    return;
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

export function handleTaskResumeCandidate(argv) {
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
