---
name: claude-ask
description: Delegate a cold code review, adversarial review, multi-turn analysis, or background task from agy to Claude Code CLI (`ask_claude` / `claude-companion.mjs`).
---

# Claude Ask & Code Review

Use the `ask_claude` MCP tool (or run `node "${PLUGIN_ROOT}/scripts/claude-companion.mjs"`):

1. **Cold & adversarial reviews:**
   * `node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" review` (`--staged`, `--base main`, `--deep`, `--background`)
   * `node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" adversarial-review` (finds concrete reasons NOT to ship)
2. **Multi-turn session resume:**
   * Pass `persist: true` to `ask_claude` (or `--persist`) to receive `[session_id: <id>]`, then pass `resume: "<id>"` on follow-ups.
3. **Safety:**
   * Default is read-only (`Read,Grep,Glob`, or `no_tools: true` for diff-only reviews). Only pass `edit: true` / `--edit` when explicitly requested by the user.
   * Recursion guard (`CC_PLUGIN_AGY_ACTIVE=1`) prevents infinite `agy -> claude -> agy` loops.
