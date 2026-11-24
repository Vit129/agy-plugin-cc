---
description: Check whether a newer agy-plugin-cc is available on GitHub and pull it after confirmation (git-clone installs)
argument-hint: '[--pull|--dismiss]'
allowed-tools: Bash(node:*), AskUserQuestion
---

Raw arguments: `$ARGUMENTS`

1. If the arguments include `--pull` or `--dismiss`, run it directly:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" update $ARGUMENTS
```
   and return the output verbatim.
2. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" update` and show the output.
   - If it reports an update and a clean tree, use `AskUserQuestion` once: `Pull now` or `Not now`. On `Pull now` run `... update --pull`; on `Not now` run `... update --dismiss`.
   - If it reports uncommitted changes, tell the user to commit or stash and pull manually; do not offer to pull.

Marketplace installs update through `/plugin` instead; this command applies to git-clone installs.
