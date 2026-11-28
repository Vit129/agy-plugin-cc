#!/usr/bin/env node

import { execSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { runClaudeAvailability, runClaudePrompt, selectClaudeModel } from "./lib/claude.mjs";
import {
  detectVerifyCommand,
  hashFiles,
  parseTestList,
  renderHandoffReport,
  runHandoffLoop
} from "./lib/handoff.mjs";
import { decideRoute, readAllQuota } from "./lib/quota-state.mjs";
import { autoRoute, checkClaudeRoute } from "./lib/delegation-route.mjs";
import {
  appendUsageLog,
  formatUsage,
  generateJobId,
  listJobs,
  nowIso,
  readJobFile,
  resolveJobLogFile,
  resolveWorkspaceRoot,
  sumUsage,
  terminateProcessTree,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";

const BOOLEAN_FLAGS = new Set([
  "json",
  "edit",
  "no-tools",
  "staged",
  "deep",
  "persist",
  "background",
  "all"
]);

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key.startsWith("route=")) {
        options.route = key.slice("route=".length);
      } else if (key === "route") {
        if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("Missing value for --route.");
        options.route = argv[++i];
      } else if (BOOLEAN_FLAGS.has(key)) {
        options[key] = true;
      } else if (i + 1 < argv.length) {
        const val = argv[++i];
        if (key === "tests") {
          options.tests = options.tests ? [...options.tests, val] : [val];
        } else {
          options[key] = val;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { options, positionals };
}

function formatWin(w) {
  if (!w || w.state === "unknown") return "unknown";
  return `${w.effectiveRemainingPct}% rem (${w.state})`;
}

function gitText(args, cwd) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function collectDiff(cwd, options) {
  if (options.base) {
    const base = gitText(["diff", `${options.base}...HEAD`], cwd);
    if (base.status !== 0) {
      throw new Error(base.stderr.trim() || `git diff ${options.base}...HEAD failed.`);
    }
    const wt = gitText(["diff"], cwd).stdout;
    return [base.stdout.trimEnd(), wt.trimEnd()].filter(Boolean).join("\n");
  }
  if (options.staged) {
    return gitText(["diff", "--cached"], cwd).stdout;
  }
  return gitText(["diff"], cwd).stdout;
}

function buildReviewPrompt(diff, focus, { adversarial, deep }) {
  const header = adversarial
    ? "Perform an ADVERSARIAL, cold code review of this git diff. Actively try to find the strongest concrete reasons this change should NOT ship (security boundaries, race conditions, data loss, edge cases, silent failures)."
    : "Perform a cold, read-only code review of this git diff. Focus on correctness, edge cases, security, and regressions.";
  const deepNote = deep
    ? "Use Read, Grep, and Glob to inspect callers, surrounding code, and tests for changed symbols before concluding."
    : "";
  return [
    header,
    deepNote,
    focus ? `Extra focus: ${focus}` : "",
    "",
    "```diff",
    diff.slice(0, 60_000),
    "```"
  ]
    .filter(Boolean)
    .join("\n");
}

function recordCompletedJob(workspaceRoot, jobId, kind, res, rendered) {
  const status = res.exitCode === 0 ? "completed" : "failed";
  const completedAt = nowIso();
  const payload = {
    id: jobId,
    kind,
    workspaceRoot,
    status,
    phase: status === "completed" ? "done" : "failed",
    pid: null,
    completedAt,
    sessionId: res.sessionId ?? null,
    usage: res.usage ?? null,
    rendered
  };
  writeJobFile(workspaceRoot, jobId, payload);
  upsertJob(workspaceRoot, {
    id: jobId,
    kind,
    workspaceRoot,
    status,
    phase: payload.phase,
    pid: null,
    completedAt,
    sessionId: res.sessionId ?? null,
    usage: res.usage ?? null
  });
  if (res.usage) {
    appendUsageLog(workspaceRoot, {
      at: completedAt,
      jobId,
      kind,
      status,
      sessionId: res.sessionId ?? null,
      ...res.usage
    });
  }
}

function enqueueBackground(workspaceRoot, kind, requestPayload, options) {
  const jobId = generateJobId(kind);
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  const jobRecord = {
    id: jobId,
    kind,
    workspaceRoot,
    status: "queued",
    phase: "queued",
    pid: null,
    logFile,
    request: requestPayload
  };
  writeJobFile(workspaceRoot, jobId, jobRecord);
  upsertJob(workspaceRoot, {
    id: jobId,
    kind,
    workspaceRoot,
    status: "queued",
    phase: "queued",
    pid: null,
    logFile
  });

  const scriptPath = new URL(import.meta.url).pathname;
  const child = spawn(
    process.execPath,
    [scriptPath, "task-worker", "--job-id", jobId, "--cwd", workspaceRoot],
    { cwd: workspaceRoot, detached: true, stdio: "ignore" }
  );
  child.unref();

  const out = { jobId, status: "queued", workspaceRoot };
  if (options.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`Queued ${kind} job: ${jobId}`);
    console.log(`Check status: node "${scriptPath}" status ${jobId}`);
  }
}

function formatModelTag(request) {
  if (!request.autoModel || !request.model) return "";
  return `[model: ${request.model}${request.effort ? `, effort: ${request.effort}` : ""} (auto)]`;
}

async function executeAsk(workspaceRoot, request, jobId) {
  const res = await runClaudePrompt(request.prompt, {
    cwd: workspaceRoot,
    model: request.model,
    effort: request.effort,
    resume: request.resume,
    persist: Boolean(request.persist || request.resume),
    noTools: Boolean(request.noTools),
    edit: Boolean(request.edit)
  });
  const tags = [
    formatModelTag(request),
    (request.persist || request.resume) && res.sessionId ? `[session_id: ${res.sessionId}]` : ""
  ].filter(Boolean);
  const footer = tags.length ? `\n\n${tags.join(" ")}` : "";
  const rendered = `${res.text}${footer}`.trim();
  recordCompletedJob(workspaceRoot, jobId, "ask", res, rendered);
  return { res, rendered };
}

async function executeReview(workspaceRoot, request, jobId) {
  const kind = request.adversarial ? "adversarial-review" : "review";
  const res = await runClaudePrompt(request.prompt, {
    cwd: workspaceRoot,
    model: request.model,
    effort: request.effort,
    noTools: !request.deep
  });
  const tag = formatModelTag(request);
  const rendered = tag ? `${res.text}\n\n${tag}`.trim() : res.text;
  recordCompletedJob(workspaceRoot, jobId, kind, res, rendered);
  return { res, rendered };
}

async function executeHandoff(workspaceRoot, request, jobId) {
  const testFiles = request.testFiles ?? [];
  const testHashes = hashFiles(workspaceRoot, testFiles);
  const loopResult = await runHandoffLoop({
    prompt: request.prompt,
    verifyCommand: request.verifyCommand,
    maxFixups: request.maxFixups,
    testHashes,
    runClaude: (promptText, opts) =>
      runClaudePrompt(promptText, {
        cwd: workspaceRoot,
        model: request.model,
        effort: request.effort,
        edit: true,
        persist: true,
        resume: opts.resume
      }),
    runVerify: (cmd) => {
      const r = spawnSync("sh", ["-c", cmd], { cwd: workspaceRoot, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
      return {
        exitCode: r.status ?? 1,
        output: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim()
      };
    },
    rehash: () => hashFiles(workspaceRoot, testFiles)
  });

  const diffStat = gitText(["diff", "--stat"], workspaceRoot).stdout;
  const rendered = renderHandoffReport(loopResult, {
    verifyCommand: request.verifyCommand,
    testFiles,
    diffStat
  });
  const totalUsage = sumUsage(loopResult.usages);
  const resLike = {
    exitCode: loopResult.status.exitCode,
    sessionId: loopResult.claudeResult?.sessionId ?? null,
    usage: totalUsage,
    text: rendered,
    stderr: loopResult.claudeResult?.stderr ?? ""
  };
  recordCompletedJob(workspaceRoot, jobId, "handoff", resLike, rendered);
  return { res: resLike, loopResult, rendered };
}

async function handleTaskWorker(options) {
  const jobId = options["job-id"];
  if (!jobId) throw new Error("--job-id is required for task-worker.");
  const workspaceRoot = resolveWorkspaceRoot(options.cwd || process.cwd());
  const stored = readJobFile(workspaceRoot, jobId);
  if (!stored?.request) throw new Error(`Stored job ${jobId} has no request payload.`);

  upsertJob(workspaceRoot, {
    id: jobId,
    status: "running",
    phase: "running",
    pid: process.pid,
    startedAt: nowIso()
  });

  const { kind, request } = stored;
  if (kind === "ask") {
    await executeAsk(workspaceRoot, request, jobId);
  } else if (kind === "review" || kind === "adversarial-review") {
    await executeReview(workspaceRoot, request, jobId);
  } else if (kind === "handoff") {
    await executeHandoff(workspaceRoot, request, jobId);
  } else {
    throw new Error(`Unknown job kind: ${kind}`);
  }
}

function handleStatus(options, positionals) {
  const workspaceRoot = resolveWorkspaceRoot(options.cwd || process.cwd());
  const jobs = listJobs(workspaceRoot);
  const quota = readAllQuota();
  const ref = positionals[0];

  if (ref) {
    const job = jobs.find((j) => j.id === ref || j.id.startsWith(ref));
    if (!job) throw new Error(`No job found for "${ref}".`);
    const stored = readJobFile(workspaceRoot, job.id);
    if (options.json) {
      console.log(JSON.stringify({ job, stored }, null, 2));
      return;
    }
    console.log(`Job ${job.id} (${job.kind}) — ${job.status}`);
    if (job.usage) console.log(`Usage: ${formatUsage(job.usage)}`);
    if (stored?.rendered) console.log(`\n${stored.rendered}`);
    return;
  }

  const shown = options.all ? jobs : jobs.slice(0, 8);
  if (options.json) {
    console.log(JSON.stringify({ workspaceRoot, quota, jobs: shown }, null, 2));
    return;
  }
  const lines = [
    "# Claude Companion Status",
    `- claude:default — 5h: ${formatWin(quota.claude.pools.default["5h"])}, 7d: ${formatWin(quota.claude.pools.default["7d"])}`,
    `- agy:gemini — 5h: ${formatWin(quota.agy.pools.gemini["5h"])}, 7d: ${formatWin(quota.agy.pools.gemini["7d"])}`,
    `- agy:argon — 7d: ${formatWin(quota.agy.pools.argon["7d"])}`,
    `- agy:3p — 5h: ${formatWin(quota.agy.pools["3p"]["5h"])}, 7d: ${formatWin(quota.agy.pools["3p"]["7d"])}`,
    ""
  ];
  if (shown.length === 0) {
    lines.push("No jobs recorded yet.");
  } else {
    lines.push("Recent jobs:");
    for (const j of shown) {
      const u = j.usage ? ` | ${formatUsage(j.usage)}` : "";
      lines.push(`- ${j.id} [${j.kind}] ${j.status}${u}`);
    }
  }
  console.log(lines.join("\n"));
}

function handleResult(options, positionals) {
  const workspaceRoot = resolveWorkspaceRoot(options.cwd || process.cwd());
  const jobs = listJobs(workspaceRoot);
  const ref = positionals[0];
  const job = ref
    ? jobs.find((j) => j.id === ref || j.id.startsWith(ref))
    : jobs.find((j) => j.status === "completed" || j.status === "failed");
  if (!job) throw new Error("No finished job found.");
  const stored = readJobFile(workspaceRoot, job.id);
  if (options.json) {
    console.log(JSON.stringify({ job, stored }, null, 2));
    return;
  }
  console.log(stored?.rendered ?? "(no stored output)");
}

function handleCancel(options, positionals) {
  const workspaceRoot = resolveWorkspaceRoot(options.cwd || process.cwd());
  const jobs = listJobs(workspaceRoot);
  const ref = positionals[0];
  const job = ref
    ? jobs.find((j) => j.id === ref || j.id.startsWith(ref))
    : jobs.find((j) => j.status === "running" || j.status === "queued");
  if (!job) throw new Error("No active job to cancel.");
  terminateProcessTree(job.pid);
  const completedAt = nowIso();
  upsertJob(workspaceRoot, { id: job.id, status: "cancelled", phase: "cancelled", pid: null, completedAt });
  if (options.json) {
    console.log(JSON.stringify({ id: job.id, status: "cancelled" }, null, 2));
  } else {
    console.log(`Cancelled ${job.id}`);
  }
}

function handleRoute(options) {
  const decision = decideRoute({
    preferred: options.preferred,
    model: options.model,
    min5h: options["min-5h"] ? Number(options["min-5h"]) : undefined,
    min7d: options["min-7d"] ? Number(options["min-7d"]) : undefined
  });
  const auto = autoRoute("claude", { model: options.model });
  if (options.json) {
    console.log(JSON.stringify({ ...decision, autoRoute: auto }, null, 2));
    return;
  }
  console.log(`Selected: ${decision.selected ? `${decision.selected.provider}:${decision.selected.pool}` : "none"}`);
  console.log(`Reason: ${decision.reason}`);
  console.log(`Auto-Route agy→Claude: ${auto.target === "claude" ? "allowed" : "diverted"} · ${auto.reason}`);
}

function handleDoctor(options) {
  const claude = runClaudeAvailability();
  const quota = readAllQuota();
  const report = {
    claude,
    quotaAvailable: { claude: quota.claude.available, agy: quota.agy.available }
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Claude CLI: ${claude.available ? `${claude.binary} (${claude.version})` : "not found"}`);
  console.log(`Quota cache: claude=${quota.claude.available}, agy=${quota.agy.available}`);
}

function handleTransfer(options, positionals) {
  const workspaceRoot = resolveWorkspaceRoot(options.cwd || process.cwd());
  const branch = gitText(["branch", "--show-current"], workspaceRoot).stdout.trim() || "(detached)";
  const statusShort = gitText(["status", "--short"], workspaceRoot).stdout.trim() || "(clean)";
  const diffStat = gitText(["diff", "--stat"], workspaceRoot).stdout.trim() || "(none)";
  const cachedStat = gitText(["diff", "--cached", "--stat"], workspaceRoot).stdout.trim() || "(none)";
  const notes = options.notes || positionals.join(" ").trim() || "(none)";

  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const relPath = path.join(".tmp", `claude-transfer-${stamp}.md`);
  const fullPath = path.join(workspaceRoot, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const content = [
    "# Claude Transfer Context",
    "",
    `- **Repository:** \`${workspaceRoot}\``,
    `- **Branch:** \`${branch}\``,
    "",
    "## Notes from agy session",
    notes,
    "",
    "## Git status",
    "```",
    statusShort,
    "```",
    "",
    "## Unstaged diff stat",
    "```",
    diffStat,
    "```",
    "",
    "## Staged diff stat",
    "```",
    cachedStat,
    "```",
    "",
    "## Next steps",
    "Review the notes and git state above, inspect `AGENTS.md`/`CLAUDE.md` if present, and continue."
  ].join("\n");

  fs.writeFileSync(fullPath, `${content}\n`, "utf8");
  const cmd = `claude "Read ${relPath} and the instruction files it lists, then continue from Next steps."`;
  if (options.json) {
    console.log(JSON.stringify({ file: fullPath, relativePath: relPath, command: cmd }, null, 2));
  } else {
    console.log(`Wrote transfer file: ${fullPath}`);
    console.log(`Run in terminal:\n${cmd}`);
  }
}

function diverted(workspaceRoot, kind, options) {
  const event = checkClaudeRoute(workspaceRoot, kind, options.route);
  if (!event) return false;
  console.log(options.json ? JSON.stringify(event, null, 2) : event.message);
  process.exitCode = 1;
  return true;
}

async function handleAsk(options, positionals) {
  const workspaceRoot = resolveWorkspaceRoot(options.cwd || process.cwd());
  const prompt = positionals.join(" ").trim();
  if (!prompt) throw new Error("Prompt must not be empty.");
  if (diverted(workspaceRoot, "ask", options)) return;
  const picked = selectClaudeModel({
    kind: "ask",
    promptLength: prompt.length,
    edit: Boolean(options.edit),
    model: options.model,
    effort: options.effort
  });
  const request = {
    prompt,
    model: picked.model,
    effort: picked.effort,
    autoModel: picked.auto,
    resume: options.resume,
    persist: Boolean(options.persist || options.resume),
    noTools: Boolean(options["no-tools"]),
    edit: Boolean(options.edit)
  };
  if (options.background) {
    enqueueBackground(workspaceRoot, "ask", request, options);
    return;
  }
  const jobId = generateJobId("ask");
  const { res, rendered } = await executeAsk(workspaceRoot, request, jobId);
  if (options.json) {
    console.log(JSON.stringify({ jobId, ...res }, null, 2));
  } else if (rendered) {
    console.log(rendered);
  }
  if (res.exitCode !== 0) {
    if (res.stderr && !options.json) process.stderr.write(`${res.stderr}\n`);
    process.exitCode = res.exitCode;
  }
}

async function handleReview(options, positionals, { adversarial }) {
  const workspaceRoot = resolveWorkspaceRoot(options.cwd || process.cwd());
  const diff = collectDiff(workspaceRoot, options);
  if (!diff.trim()) {
    console.log("No git diff to review.");
    return;
  }
  const kind = adversarial ? "adversarial-review" : "review";
  if (diverted(workspaceRoot, kind, options)) return;
  const focus = positionals.join(" ").trim();
  const picked = selectClaudeModel({
    kind: adversarial ? "adversarial-review" : "review",
    promptLength: diff.length,
    deep: Boolean(options.deep),
    model: options.model,
    effort: options.effort
  });
  const request = {
    adversarial,
    deep: Boolean(options.deep),
    model: picked.model,
    effort: picked.effort,
    autoModel: picked.auto,
    prompt: buildReviewPrompt(diff, focus, { adversarial, deep: Boolean(options.deep) })
  };
  if (options.background) {
    enqueueBackground(workspaceRoot, kind, request, options);
    return;
  }
  const jobId = generateJobId(kind);
  const { res, rendered } = await executeReview(workspaceRoot, request, jobId);
  if (options.json) {
    console.log(JSON.stringify({ jobId, ...res }, null, 2));
  } else {
    console.log(rendered);
  }
  if (res.exitCode !== 0) {
    if (res.stderr && !options.json) process.stderr.write(`${res.stderr}\n`);
    process.exitCode = res.exitCode;
  }
}

async function handleHandoff(options, positionals) {
  const workspaceRoot = resolveWorkspaceRoot(options.cwd || process.cwd());
  const branch = gitText(["branch", "--show-current"], workspaceRoot).stdout.trim();
  if (branch === "main" || branch === "master") {
    throw new Error(`Refusing handoff on protected branch "${branch}". Switch to a feature branch first.`);
  }
  const dirty = gitText(["status", "--porcelain"], workspaceRoot).stdout.trim();
  if (dirty) {
    throw new Error("Refusing handoff on a dirty working tree. Commit or stash changes first.");
  }

  const requirement = positionals.join(" ").trim();
  if (!requirement) {
    throw new Error("Handoff requires a requirement prompt.");
  }
  const verifyCommand = options.verify || detectVerifyCommand(workspaceRoot);
  if (!verifyCommand) {
    throw new Error("Could not detect verification command; pass --verify <cmd>.");
  }

  if (diverted(workspaceRoot, "handoff", options)) return;
  const testFiles = parseTestList(options.tests);
  const maxFixups = options.fixups !== undefined ? Math.max(0, Number(options.fixups) || 0) : 1;
  const picked = selectClaudeModel({
    kind: "handoff",
    promptLength: requirement.length,
    edit: true,
    model: options.model,
    effort: options.effort
  });
  const request = {
    prompt: [
      requirement,
      "",
      `Verification command: \`${verifyCommand}\``,
      testFiles.length ? `Do NOT modify these test files: ${testFiles.join(", ")}` : "",
      "Do not commit."
    ]
      .filter(Boolean)
      .join("\n"),
    verifyCommand,
    testFiles,
    maxFixups,
    model: picked.model,
    effort: picked.effort,
    autoModel: picked.auto
  };

  if (options.background) {
    enqueueBackground(workspaceRoot, "handoff", request, options);
    return;
  }
  const jobId = generateJobId("handoff");
  const { loopResult, rendered } = await executeHandoff(workspaceRoot, request, jobId);
  if (options.json) {
    console.log(JSON.stringify({ jobId, status: loopResult.status, rounds: loopResult.rounds, rendered }, null, 2));
  } else {
    console.log(rendered);
  }
  process.exitCode = loopResult.status.exitCode;
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const { options, positionals } = parseArgs(rest);

  switch (sub) {
    case "doctor":
      handleDoctor(options);
      break;
    case "status":
      handleStatus(options, positionals);
      break;
    case "result":
      handleResult(options, positionals);
      break;
    case "cancel":
      handleCancel(options, positionals);
      break;
    case "route":
      handleRoute(options);
      break;
    case "transfer":
      handleTransfer(options, positionals);
      break;
    case "ask":
      await handleAsk(options, positionals);
      break;
    case "review":
      await handleReview(options, positionals, { adversarial: false });
      break;
    case "adversarial-review":
      await handleReview(options, positionals, { adversarial: true });
      break;
    case "handoff":
      await handleHandoff(options, positionals);
      break;
    case "task-worker":
      await handleTaskWorker(options);
      break;
    default:
      console.log(
        [
          "Usage:",
          "  node scripts/claude-companion.mjs doctor [--json]",
          "  node scripts/claude-companion.mjs status [job-id] [--all] [--json]",
          "  node scripts/claude-companion.mjs result [job-id] [--json]",
          "  node scripts/claude-companion.mjs cancel [job-id] [--json]",
          "  node scripts/claude-companion.mjs route [--preferred <claude|agy>] [--model <name>] [--json]",
          "  node scripts/claude-companion.mjs transfer [--notes <text>] [notes]",
          "  node scripts/claude-companion.mjs ask [--route auto|off] [--model <name>] [--effort <low|medium|high>] [--resume <id>] [--persist] [--no-tools] [--edit] [--background] <prompt>",
          "  node scripts/claude-companion.mjs review [--route auto|off] [--staged] [--base <ref>] [--deep] [--model <name>] [--background] [focus]",
          "  node scripts/claude-companion.mjs adversarial-review [--route auto|off] [--staged] [--base <ref>] [--deep] [--model <name>] [--background] [focus]",
          "  node scripts/claude-companion.mjs handoff [--route auto|off] [--verify <cmd>] [--tests <a,b>] [--fixups <n>] [--model <name>] [--background] <requirement>"
        ].join("\n")
      );
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
