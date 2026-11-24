// Not imported anywhere: stop-review-gate-hook.mjs carries its own copy of
// these functions. Moved here unchanged from agy-companion.mjs during the
// split; delete once confirmed unneeded.

import { runAgyTaskSync } from "../lib/agy.mjs";
import { SESSION_ID_ENV } from "../lib/tracked-jobs.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./shared.mjs";

export const STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;

export function buildStopGatePrompt(input = {}) {
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

export function parseStopReviewOutput(rawOutput) {
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

export function runStopGateReview(cwd, input = {}) {
  const prompt = buildStopGatePrompt(input);
  const childEnv = {
    ...process.env,
    ...(input.session_id ? { [SESSION_ID_ENV]: input.session_id } : {})
  };

  const result = runAgyTaskSync(cwd, prompt, {
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
