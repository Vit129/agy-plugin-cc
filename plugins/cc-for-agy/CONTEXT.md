# Agent Bridge for Antigravity — Context

- **Companion** — `scripts/claude-companion.mjs` delegates jobs to the local Claude Code CLI. `ask_claude` exposes bounded delegation through MCP.
- **Auto-Route** — shared-cache policy that diverts a critical destination only when the other provider has confirmed headroom in both quota windows. The companion and MCP tool support an explicit `off` override.
- **Usage ledger** — per-workspace `usage.jsonl`, including completed jobs and quota diversions with their reason.
