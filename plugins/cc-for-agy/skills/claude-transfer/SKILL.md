---
name: claude-transfer
description: Transfer the current agy session's context to an interactive Claude Code terminal session by writing `.tmp/claude-transfer-<timestamp>.md`.
---

# Claude Interactive Transfer

When agy quota is exhausted or the user wants to continue interactively in Claude Code:
```bash
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" transfer --notes "Summary of goal, done so far, and next steps"
```

This writes `.tmp/claude-transfer-<YYYY-MM-DD-HHMM>.md` and prints the exact `claude "..."` command to run.
