# agy-plugin-cc — Context

Domain terms as used in `plugins/agy/scripts/`.

- **Companion** — `agy-companion.mjs`, the runtime the slash commands call to drive the Antigravity (`agy`) CLI.
- **Job** — one agy invocation tracked in plugin state (`id`, status, `createdAt`/`updatedAt`, `logFile`); newest first, at most 50 kept.
- **Workspace root** — the git root (or cwd) a job belongs to; state is keyed by a slug + hash of its real path.
- **State dir** — `$CLAUDE_PLUGIN_DATA/state/<slug>-<hash>/` (fallback: the OS temp dir) holding `state.json` and `jobs/`.
- **Stop-review gate** — optional hook (`stop-review-gate-hook.mjs`, `config.stopReviewGate`) that runs a review before a session stops.
- **Session lifecycle hook** — `session-lifecycle-hook.mjs`, runs on SessionStart/SessionEnd and checks for plugin updates.
