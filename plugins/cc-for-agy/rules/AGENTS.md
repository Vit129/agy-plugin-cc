# cc-plugin-agy Rules

- You have `ask_claude` (MCP) and `scripts/claude-companion.mjs` to consult Claude Code CLI using the user's local Claude subscription (no API key).
- **Read-only by default:** `ask_claude` runs with `Read,Grep,Glob` (or `--no-tools` when passing a diff directly). Never pass `edit: true` unless the user explicitly asks Claude to edit files (or using `handoff` on a clean feature branch).
- **Multi-turn resume:** Pass `persist: true` (or `--persist`) to get a `session_id`, then `resume` on follow-ups to save tokens.
- **Quota-aware:** Check `scripts/claude-companion.mjs route --json` or `status` before heavy delegation if either plan is near its 5h/7d limit.
