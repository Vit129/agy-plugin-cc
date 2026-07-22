---
description: Delegate a one-shot prompt to the Antigravity (agy) CLI agent
argument-hint: '[--sandbox] [--dry-run] [--continue|--resume|--fresh] [--conversation <id>] [--model <name>] [--effort <low|medium|high>] [--project <id>|--new-project] [--dangerously-skip-permissions] [--add-dir <path>] [--print-timeout <duration>] [--background] [prompt]'
allowed-tools: Bash(node:*)
---

Run a one-shot agy task via the companion:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task "$ARGUMENTS"
```

Return the command stdout verbatim to the user. Do not paraphrase, summarize, or add commentary.

If agy is not installed, tell the user to run `/agy:setup`.
