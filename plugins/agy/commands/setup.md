---
description: Check whether the Antigravity (agy) CLI is installed and ready
allowed-tools: Bash
---

Run the setup check for the agy CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup
```

Print the result verbatim. If agy is not installed, tell the user to install it:

```
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Then re-run this command to verify.
