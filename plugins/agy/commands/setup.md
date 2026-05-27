---
description: Check whether the Antigravity (agy) CLI is installed and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup --json $ARGUMENTS
```

If the result says agy is unavailable:
- Tell the user to install agy with:

```
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

If agy is already installed:
- Present the final setup output to the user.

Output rules:
- If the review gate was toggled, confirm the change.
- If agy is installed but not authenticated, remind the user to run `agy auth`.
