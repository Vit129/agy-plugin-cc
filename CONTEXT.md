# agy-plugin-cc — Context

Domain terms as used in `plugins/agy/scripts/`.

- **Companion** — `agy-companion.mjs`, the runtime the slash commands call to drive the Antigravity (`agy`) CLI.
- **Job** — one agy invocation tracked in plugin state (`id`, status, `createdAt`/`updatedAt`, `logFile`); newest first, at most 50 kept.
- **Workspace root** — the git root (or cwd) a job belongs to; state is keyed by a slug + hash of its real path.
- **State dir** — `$CLAUDE_PLUGIN_DATA/state/<slug>-<hash>/` (fallback: the OS temp dir) holding `state.json` and `jobs/`.
- **Stop-review gate** — optional hook (`stop-review-gate-hook.mjs`, `config.stopReviewGate`) that runs a review before a session stops.
- **Session lifecycle hook** — `session-lifecycle-hook.mjs`, runs on SessionStart/SessionEnd and checks for plugin updates.
- **Host** — Claude Code or Codex; detected from `CLAUDECODE`. Both load the same `plugins/agy` tree through their own manifest.
- **Hand-off** — a test-gated delegation (`handoff`): agy implements, the companion runs the test command, sends fix-ups, and checks test files were not edited.
- **Usage ledger** — `usage.jsonl` in the state dir, one line per finished job with agy's token counts.

- **Reset check** — a scheduled snapshot read based on a projected five-hour interval. A provider-reported reset is separate from the check time.
