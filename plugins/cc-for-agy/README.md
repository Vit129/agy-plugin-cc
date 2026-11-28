# Agent Bridge for Antigravity

Antigravity (`agy`) native plugin (`v2.1.0`) for symmetric delegation, cold/adversarial code review, test-verified handoff, session transfer, background jobs, and shared 5h/7d quota-aware routing with Claude Code CLI (`claude -p`).

## Features

- **`ask_claude` MCP tool** (`mcp_config.json` + `scripts/ask-claude-mcp.mjs`): zero-dependency stdio MCP server calling `claude -p --output-format json --strict-mcp-config` via stdin, with multi-turn `persist` / `resume` (`session_id`) and `usage.jsonl` logging.
- **Read-only by default:** defaults to `Read,Grep,Glob` (or `--no-tools` for diff-only reviews). Requires explicit `edit: true` / `--edit` to modify files.
- **Reviews (`review`, `adversarial-review`):** supports `--staged`, `--base <ref>`, `--deep`, and `--background`.
- **Test-Verified Handoff (`handoff`):** refuses `main`/`master` and dirty trees, hashes `--tests` with SHA-256 to detect test tampering, runs `--verify` + `--fixups N` via `--resume`.
- **Interactive Transfer (`transfer`):** writes `.tmp/claude-transfer-<ts>.md` and prints a ready-to-run `claude` command.
- **Background Jobs & Usage Ledger:** `status`, `result`, `cancel`, and `usage.jsonl` per workspace (`$PLUGIN_DATA`).
- **Loop guard:** sets `CC_PLUGIN_AGY_ACTIVE=1` to block recursive `agy -> claude -> agy` calls.
- **Quota Auto-Route:** `ask`, `review`, `adversarial-review`, and `handoff` default to `--route auto`. `ask_claude` accepts `route: "auto"`. If Claude is critical and both agy windows are above Low, they return a diversion reason before launching Claude. Use `--route off` or `route: "off"` to override.
- **Shared quota hooks:** `PreInvocation` never blocks an ordinary agy prompt. It only stops a prompt that delegates to Claude (for example "ask claude ...") when Claude is critical and agy has headroom. Turn it off with `CC_PLUGIN_AGY_ROUTE=off` at agy launch, or at any time by creating an empty `route-off` file in the Agent Usage state directory (`$AGENT_USAGE_STATE_DIR`, default `~/.local/state/agent-usage`). Slash commands such as `/usage` always remain available. `Stop` records provider cooldowns.

Auto-Route uses the shared status-line/Agent Usage cache and Agent Usage Critical and Low thresholds. Both providers need fresh 5h/7d windows. Diversions are recorded in `usage.jsonl`. Agent Usage displays both delegation directions under **Plan usage**.

## Validate & Install

```bash
npm test
agy plugin validate . --strict
agy plugin install .
```

## Contributors

Developed and maintained by **Vit129** and **Antigravity** (Google).
