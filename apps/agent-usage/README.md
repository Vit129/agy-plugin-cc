# Agent Usage

Agent Usage serves a local dashboard for Claude Code and Antigravity. Run `npm run dashboard` from the repository to start or reuse it, then open the URL it prints. For development, `npm run dashboard -- serve` starts the server in the foreground.

- The server listens on `127.0.0.1:43127` by default. Set `AGENT_USAGE_PORT` to override it.
- Install an executable `agent-usage` launcher at `~/.local/bin/agent-usage` to enable the host plugins' startup hooks. It calls `apps/agent-usage/cli.mjs` using the installed Node executable. Both the `agy-plugin-cc` and `cc-plugin-agy` startup hooks use the same launcher.
- Local state and `server.log` live in `~/.local/state/agent-usage/` or `AGENT_USAGE_STATE_DIR`. Quota comes from the plugins' existing shared cache, with a rate-limited CodexBar CLI fallback when a provider's snapshot is missing or stale. The fallback requests provider CLI quota and only surfaces measured windows. The server needs a fresh sample from both windows to show estimated session capacity.
- `npm run dashboard -- schedule 2026-11-27T20:55:00+07:00 6` records six projected 5-hour check times. `npm run dashboard -- check-reset` reads quota through the running server. A scheduled check reports the available snapshot, including when it is stale or missing. On macOS a user LaunchAgent can invoke `agent-usage check-reset --scheduled` at the six calendar times to start a checker even when the server is down. The command checks the stored date and time before acting.
- The dashboard reads recorded model responses in local CLI transcripts. Only model names and aggregate counters are served, and timing is shown as unavailable when it is missing from the log. The counts cover recorded calls, including headless calls where logged.
- Automatic alerts run in the local server and can continue with the dashboard tab closed. macOS notification delivery depends on the system's notification settings.
