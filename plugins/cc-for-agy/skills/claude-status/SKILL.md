---
name: claude-status
description: Check shared 5h/7d quota status, route recommendations, and background job results/cancellations across Claude Code and agy.
---

# Shared AI Quota, Jobs & Route

Run:
```bash
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" status [job-id] [--all]
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" result [job-id]
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" cancel [job-id]
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" route
```

Add `--json` for machine-readable output.
