#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getAgyAvailability } from "./lib/agy.mjs";
import { getConfig, listJobs } from "./lib/state.mjs";
import { SESSION_ID_ENV } from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { sortJobsNewestFirst } from "./lib/job-control.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(message) {
  if (!message) {
    return;
  }
  process.stderr.write(`${message}\n`);
}

function filterJobsForCurrentSession(jobs, input = {}) {
  const sessionId = input.session_id || process.env[SESSION_ID_ENV] || null;
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function buildSetupNote(cwd) {
  const availability = getAgyAvailability(cwd);
  if (availability.available) {
    return null;
  }
  return "agy is not set up for the review gate. Run /agy:setup.";
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

function buildStopGatePrompt(input = {}) {
  const template = loadPromptTemplate("stop-review-gate");
  const lastAssistantMessage = String(input.last_assistant_message ?? "").trim();
  const claudeResponseBlock = lastAssistantMessage
    ? ["Previous Claude response:", lastAssistantMessage].join("\n")
    : "";

  if (template) {
    return interpolateTemplate(template, { CLAUDE_RESPONSE_BLOCK: claudeResponseBlock });
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

function runStopReview(cwd, input = {}) {
  const scriptPath = path.join(SCRIPT_DIR, "agy-companion.mjs");
  const prompt = buildStopGatePrompt(input);
  const childEnv = {
    ...process.env,
    ...(input.session_id ? { [SESSION_ID_ENV]: input.session_id } : {})
  };

  const result = spawnSync(
    process.execPath,
    [scriptPath, "task", "--sandbox", "--json", prompt],
    {
      cwd,
      env: childEnv,
      encoding: "utf8",
      timeout: STOP_REVIEW_TIMEOUT_MS
    }
  );

  if (result.error?.code === "ETIMEDOUT") {
    return {
      ok: false,
      reason:
        "The stop-time agy review timed out after 15 minutes. Run /agy:review --wait manually or bypass the gate."
    };
  }

  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      reason: detail
        ? `The stop-time agy review failed: ${detail}`
        : "The stop-time agy review failed. Run /agy:review --wait manually or bypass the gate."
    };
  }

  try {
    const payload = JSON.parse(result.stdout);
    return parseStopReviewOutput(payload?.rawOutput);
  } catch {
    return parseStopReviewOutput(result.stdout);
  }
}

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);

  const jobs = sortJobsNewestFirst(
    filterJobsForCurrentSession(listJobs(workspaceRoot), input)
  );
  const runningJob = jobs.find(
    (job) => job.status === "queued" || job.status === "running"
  );
  const runningTaskNote = runningJob
    ? `agy task ${runningJob.id} is still running. Check /agy:status and use /agy:cancel ${runningJob.id} if you want to stop it before ending the session.`
    : null;

  if (!config.stopReviewGate) {
    logNote(runningTaskNote);
    return;
  }

  const setupNote = buildSetupNote(cwd);
  if (setupNote) {
    logNote(setupNote);
    logNote(runningTaskNote);
    return;
  }

  const review = runStopReview(cwd, input);
  if (!review.ok) {
    emitDecision({
      decision: "block",
      reason: runningTaskNote ? `${runningTaskNote} ${review.reason}` : review.reason
    });
    return;
  }

  logNote(runningTaskNote);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
