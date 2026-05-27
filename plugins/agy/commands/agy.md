---
description: Delegate a one-shot prompt to the Antigravity (agy) CLI agent
argument-hint: '[--sandbox] [--resume] [prompt]'
allowed-tools: Bash(node:*)
---

Run a one-shot agy task via the companion:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task "$ARGUMENTS"
```

Return the command stdout verbatim to the user. Do not paraphrase, summarize, or add commentary.

If agy is not installed, tell the user to run `/agy:setup`.
