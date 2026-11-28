---
name: claude-handoff
description: Hand a test-covered implementation task to Claude Code CLI with automatic verification, bounded fixup rounds, and SHA-256 test-file tamper detection.
---

# Claude Test-Verified Handoff

Run on a feature branch with a clean git working tree:
```bash
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" handoff \
  --tests tests/example.test.mjs \
  --verify "npm test" \
  --fixups 1 \
  "Implement the requirement without modifying the test files."
```

Exit codes: `0 PASS`, `4 FAIL`, `5 CLAUDE FAILED`, `6 TEST FILES MODIFIED`.
Add `--background` for long-running tasks and monitor with `status`.
