# agent-bridge — Context

Domain terms as used in `plugins/agy/scripts/`.

- **Companion** — `agy-companion.mjs`, the runtime the slash commands call to drive the Antigravity (`agy`) CLI.
- **Job** — one agy invocation tracked in plugin state (`id`, status, `createdAt`/`updatedAt`, `logFile`); newest first, at most 50 kept.
- **Workspace root** — the git root (or cwd) a job belongs to; state is keyed by a slug + hash of its real path.
- **State dir** — `$CLAUDE_PLUGIN_DATA/state/<slug>-<hash>/` (fallback: the OS temp dir) holding `state.json` and `jobs/`.
- **Stop-review gate** — optional hook (`stop-review-gate-hook.mjs`, `config.stopReviewGate`) that runs a review before a session stops.
- **Session lifecycle hook** — `session-lifecycle-hook.mjs`, runs on SessionStart/SessionEnd and checks for plugin updates.
- **Host** — Claude Code or Codex; detected from `CLAUDECODE`. Both load the same `plugins/agy` tree through their own manifest.
- **Monitored provider** — A CLI whose configured accounts Agent Usage tracks when its Settings switch is on.
- **Named account** — A CLI configuration directory with a stable ID for quota observations and alerts. A manual list replaces the implicit account for that provider.
- **Managed account** — A signed-in CLI home created by Agent Usage under its state directory and monitored automatically.
- **Active provider** — An enabled CLI with a transcript write in the past two minutes.
- **Reset credit** — A Claude Code or Codex account entitlement to reset eligible rate-limit windows. Claude Full reset expiry is entered per CLI account. Unused credits with an expiry can trigger two reminders.
- **Hand-off** — a test-gated delegation (`handoff`): agy implements, the companion runs the test command, sends fix-ups, and checks test files were not edited.
- **Usage ledger** — `usage.jsonl` in the state dir records token counts for finished jobs and quota diversions with their reason.
- **Auto-Route** — a cache-only decision before delegation. It uses the tightest fresh 5h/7d quota for each provider and the Agent Usage Critical and Low thresholds. `--route off` bypasses the decision. Agent Usage displays both directions.

- **LaunchAgent** — a per-user macOS login service for the dashboard server, menu bar app or reset checker. Setup generates its paths from the current clone and home.
- **Reset check** — a scheduled snapshot read based on a projected five-hour interval. A provider-reported reset is separate from the check time.
