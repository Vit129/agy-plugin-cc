import { runAgyTask } from "../lib/agy.mjs";
import { ensureGitRepository, resolveReviewTarget } from "../lib/git.mjs";
import { renderReviewResult } from "../lib/render.mjs";
import { buildAgyRunOptions, buildDryRunReport, capOutput, createCompanionJob, enqueueBackgroundTask, ensureAgyAvailable, ensureValidEffort, ensureValidModel, firstMeaningfulLine, interpolateTemplate, loadPromptTemplate, outputCommandResult, parseCommandInput, renderDryRunReport, renderQueuedTaskLaunch, renderStderrBlock, resolveCommandCwd, resolveCommandWorkspace, runForegroundCommand, shorten } from "./shared.mjs";

export const DEEP_REVIEW_INSTRUCTIONS = `

Deep mode: do not stop at the diff. For each changed function or exported symbol, open the surrounding file, its callers and its tests (search the repository), and check that the change still holds there: contracts callers rely on, tests that no longer cover the new behavior, and related code that should have changed but did not. Read only; do not edit any file.`;

export function buildReviewPrompt(target, reviewName, focusText, deep = false) {
  const prompt = buildBaseReviewPrompt(target, reviewName, focusText);
  return deep ? prompt + DEEP_REVIEW_INSTRUCTIONS : prompt;
}

export function buildBaseReviewPrompt(target, reviewName, focusText) {
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

export async function executeReviewRun(request) {
  ensureAgyAvailable(request.cwd);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });
  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";
  const prompt = buildReviewPrompt(target, reviewName, focusText, Boolean(request.deep));

  const result = await runAgyTask(request.cwd, prompt, {
    ...(request.agyOptions ?? {}),
    onProgress: request.onProgress
  });

  const rendered = renderReviewResult(capOutput(request.cwd, "review", result.stdout), {
    reviewLabel: reviewName,
    targetLabel: target.label
  }) + (result.exitCode !== 0 || result.stderr ? renderStderrBlock(result.stderr, result.exitCode) : "");
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
    usage: result.usage ?? null,
    summary: firstMeaningfulLine(result.stdout, `${reviewName} finished.`),
    jobTitle: `agy ${reviewName}`,
    jobClass: "review",
    targetLabel: target.label
  };
}

export async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "cwd", "model", "tier", "effort", "project", "add-dir", "log-file", "print-timeout"],
    repeatableOptions: ["add-dir"],
    booleanOptions: ["json", "background", "wait", "new-project", "dangerously-skip-permissions", "dry-run", "deep"]
  });

  if (options.project && options["new-project"]) {
    throw new Error("Choose either --project or --new-project.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  const agyOptions = buildAgyRunOptions(cwd, options, {});
  ensureValidModel(cwd, agyOptions);
  ensureValidEffort(agyOptions);

  if (options["dry-run"]) {
    const report = buildDryRunReport(cwd, `agy ${config.reviewName}`, agyOptions, [
      `Base: ${options.base ?? "auto"}`,
      `Scope: ${options.scope ?? "auto"}`,
      focusText ? `Focus: ${shorten(focusText)}` : "Focus: (none)"
    ]);
    outputCommandResult(report, renderDryRunReport(report), options.json);
    return;
  }

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
      deep: Boolean(options.deep),
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
        deep: Boolean(options.deep),
        agyOptions,
        onProgress: progress
      }),
    { json: options.json }
  );
}
