---
description: Delegate an autonomous, run-until-complete goal to the Antigravity (agy) CLI
argument-hint: '[--wait] [--continue|--resume|--fresh] [--conversation <id>] [--model <name>] [--project <id>|--new-project] [--dangerously-skip-permissions] [--add-dir <path>] [--print-timeout <duration>] [goal text]'
allowed-tools: Bash(node:*)
---

Run an autonomous agy goal via the companion. Goal mode has no time cap, so this queues as a background job unless `--wait` is passed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" goal "$ARGUMENTS"
```

Return the command stdout verbatim to the user. Do not paraphrase, summarize, or add commentary.

If it queues in the background, tell the user to check `/agy:status <job-id>` for progress and `/agy:cancel <job-id>` to stop it.

If agy is not installed, tell the user to run `/agy:setup`.
