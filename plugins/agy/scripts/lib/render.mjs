import { formatUsage } from "./usage.mjs";

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function formatJobLine(job) {
  const parts = [job.id, `${job.status || "unknown"}`];
  if (job.kindLabel) {
    parts.push(job.kindLabel);
  }
  if (job.title) {
    parts.push(job.title);
  }
  return parts.join(" | ");
}

function appendActiveJobsTable(lines, jobs) {
  lines.push("Active jobs:");
  lines.push("| Job | Kind | Status | Phase | Elapsed | Summary | Actions |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const job of jobs) {
    const actions = [`/agy:status ${job.id}`];
    if (job.status === "queued" || job.status === "running") {
      actions.push(`/agy:cancel ${job.id}`);
    }
    lines.push(
      `| ${escapeMarkdownCell(job.id)} | ${escapeMarkdownCell(job.kindLabel)} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(job.phase ?? "")} | ${escapeMarkdownCell(job.elapsed ?? "")} | ${escapeMarkdownCell(job.summary ?? "")} | ${actions.map((action) => `\`${action}\``).join("<br>")} |`
    );
  }
}

function pushJobDetails(lines, job, options = {}) {
  lines.push(`- ${formatJobLine(job)}`);
  if (job.summary) {
    lines.push(`  Summary: ${job.summary}`);
  }
  if (job.phase) {
    lines.push(`  Phase: ${job.phase}`);
  }
  if (options.showElapsed && job.elapsed) {
    lines.push(`  Elapsed: ${job.elapsed}`);
  }
  if (options.showDuration && job.duration) {
    lines.push(`  Duration: ${job.duration}`);
  }
  if (job.usage) {
    lines.push(`  Usage: ${formatUsage(job.usage)}`);
  }
  if (job.logFile && options.showLog) {
    lines.push(`  Log: ${job.logFile}`);
  }
  if ((job.status === "queued" || job.status === "running") && options.showCancelHint) {
    lines.push(`  Cancel: /agy:cancel ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && options.showResultHint) {
    lines.push(`  Result: /agy:result ${job.id}`);
  }
  if (job.progressPreview?.length) {
    lines.push("  Progress:");
    for (const line of job.progressPreview) {
      lines.push(`    ${line}`);
    }
  }
}

export function renderSetupReport(report) {
  const lines = [
    "# agy Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- agy: ${report.agy.detail}`,
    `- review gate: ${report.reviewGateEnabled ? "enabled" : "disabled"}`,
    ""
  ];

  if (report.actionsTaken.length > 0) {
    lines.push("Actions taken:");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }

  if (report.nextSteps.length > 0) {
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderTaskResult(parsedResult, meta) {
  const rawOutput =
    typeof parsedResult?.rawOutput === "string" ? parsedResult.rawOutput : "";
  if (rawOutput) {
    return rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
  }

  const message =
    String(parsedResult?.failureMessage ?? "").trim() ||
    "agy did not return a final message.";
  return `${message}\n`;
}

export function renderReviewResult(rawOutput, meta) {
  const output = typeof rawOutput === "string" ? rawOutput.trim() : "";
  const lines = [`# agy ${meta.reviewLabel}`, "", `Target: ${meta.targetLabel}`, ""];

  if (output) {
    lines.push(output);
  } else {
    lines.push("agy review completed without output.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderStatusReport(report) {
  const lines = [
    "# agy Status",
    "",
    `Review gate: ${report.config.stopReviewGate ? "enabled" : "disabled"}`
  ];

  if (report.quota && (report.quota.agy?.available || report.quota.claude?.available)) {
    const parts = [];
    if (report.quota.agy?.available) {
      const g5 = report.quota.agy.pools.gemini["5h"]?.effectiveRemainingPct;
      const g7 = report.quota.agy.pools.gemini["7d"]?.effectiveRemainingPct;
      parts.push(`agy:gemini 5h:${g5 ?? "--"}% rem 7d:${g7 ?? "--"}% rem`);
    }
    if (report.quota.claude?.available) {
      const c5 = report.quota.claude.pools.default["5h"]?.effectiveRemainingPct;
      const c7 = report.quota.claude.pools.default["7d"]?.effectiveRemainingPct;
      parts.push(`claude 5h:${c5 ?? "--"}% rem 7d:${c7 ?? "--"}% rem`);
    }
    if (parts.length > 0) {
      lines.push(`Quota: ${parts.join(" | ")}`);
    }
  }
  lines.push("");

  if (report.running.length > 0) {
    appendActiveJobsTable(lines, report.running);
    lines.push("");
    lines.push("Live details:");
    for (const job of report.running) {
      pushJobDetails(lines, job, {
        showElapsed: true,
        showLog: true
      });
    }
    lines.push("");
  }

  if (report.latestFinished) {
    lines.push("Latest finished:");
    pushJobDetails(lines, report.latestFinished, {
      showDuration: true,
      showLog: report.latestFinished.status === "failed"
    });
    lines.push("");
  }

  if (report.recent.length > 0) {
    lines.push("Recent jobs:");
    for (const job of report.recent) {
      pushJobDetails(lines, job, {
        showDuration: true,
        showLog: job.status === "failed"
      });
    }
    lines.push("");
  } else if (report.running.length === 0 && !report.latestFinished) {
    lines.push("No jobs recorded yet.", "");
  }

  if (report.needsReview) {
    lines.push(
      "The stop-time review gate is enabled.",
      "Ending the session will trigger a fresh agy review and block if it finds issues."
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderJobStatusReport(job) {
  const lines = ["# agy Job Status", ""];
  pushJobDetails(lines, job, {
    showElapsed: job.status === "queued" || job.status === "running",
    showDuration: job.status !== "queued" && job.status !== "running",
    showLog: true,
    showCancelHint: true,
    showResultHint: true
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderStoredJobResult(job, storedJob) {
  const rawOutput =
    (typeof storedJob?.result?.rawOutput === "string" && storedJob.result.rawOutput) ||
    (typeof storedJob?.rendered === "string" && storedJob.rendered) ||
    "";

  if (rawOutput) {
    return rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
  }

  const lines = [
    `# ${job.title ?? "agy Result"}`,
    "",
    `Job: ${job.id}`,
    `Status: ${job.status}`
  ];

  if (job.summary) {
    lines.push(`Summary: ${job.summary}`);
  }

  if (job.errorMessage) {
    lines.push("", job.errorMessage);
  } else if (storedJob?.errorMessage) {
    lines.push("", storedJob.errorMessage);
  } else {
    lines.push("", "No captured result payload was stored for this job.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderCancelReport(job) {
  const lines = ["# agy Cancel", "", `Cancelled ${job.id}.`, ""];

  if (job.title) {
    lines.push(`- Title: ${job.title}`);
  }
  if (job.summary) {
    lines.push(`- Summary: ${job.summary}`);
  }
  lines.push("- Check `/agy:status` for the updated queue.");

  return `${lines.join("\n").trimEnd()}\n`;
}

export const DIGEST_CHAR_LIMIT = 12000;

// Long agy replies flood the caller's context; keep the head inline and point
// to the full text on disk instead.
export function digestOutput(text, fullOutputPath, limit = DIGEST_CHAR_LIMIT) {
  const output = typeof text === "string" ? text : "";
  if (output.length <= limit) {
    return { text: output, truncated: false };
  }
  const head = output.slice(0, limit).trimEnd();
  return {
    text: `${head}\n\n[agy output truncated: showing ${limit} of ${output.length} chars. Full output: ${fullOutputPath}]\n`,
    truncated: true
  };
}
