# Agent Usage

Agent Usage serves a local dashboard for Claude Code, Antigravity, GitHub Copilot, and OpenAI Codex. Run `npm run dashboard` from the repository to start or reuse it, then open the URL it prints. For development, `npm run dashboard -- serve` starts the server in the foreground.

- The server listens on `127.0.0.1:43127` by default. Set `AGENT_USAGE_PORT` to override it.
- Install an executable `agent-usage` launcher at `~/.local/bin/agent-usage` that calls `apps/agent-usage/cli.mjs` using the installed Node executable. Source `apps/agent-usage/terminal-startup.zsh` from `~/.zshrc` with the launcher on your PATH. Typing `claude`, `agy`, `copilot`, or `codex` in an interactive Zsh session then starts or reuses the same server if that provider is enabled. The Claude Code and Antigravity plugin startup hooks use the same provider switch.
- Local state and `server.log` live in `~/.local/state/agent-usage/` or `AGENT_USAGE_STATE_DIR`. Quota comes directly from each signed-in CLI. Agent Usage reads Claude Code’s interactive `/usage` with Python 3.9+, Antigravity’s JSON `/usage`, Copilot CLI SDK’s account quota, and Codex App Server’s account rate limits. A complete live status-line snapshot skips the Claude or Antigravity CLI probe. Native samples also feed the shared cache used by both companions. Copilot shows monthly entitlement and displays a reset time when the CLI supplies one in the future. The server needs a fresh sample from every displayed quota window to estimate session capacity.
- **Plan usage** shows Claude→agy and agy→Claude Auto-Route decisions. The Claude row displays probe failures such as `parse-failed`, `timeout`, or `trust-required`. Changes to the failure reason are logged in `server.log`.
- Settings controls which providers the dashboard displays, polls, and alerts on. Claude Code, Antigravity, and Copilot start enabled. Enable OpenAI Codex to use the signed-in Codex account. Disabling a provider preserves its transcripts and pauses quotas, history display, and alerts. The shared refresh interval applies to enabled providers.
- `npm run dashboard -- schedule 2026-11-27T20:55:00+07:00 6` records six projected 5-hour check times. `npm run dashboard -- check-reset` reads quota through the running server. A scheduled check reports the available snapshot, including when it is stale or missing. On macOS a user LaunchAgent can invoke `agent-usage check-reset --scheduled` at the six calendar times to start a checker even when the server is down. The command checks the stored date and time before acting.
- The dashboard reads model usage from local CLI transcripts. Only model names and aggregate counters are served, and timing is shown as unavailable when it is missing from the log. Codex counts recorded turns with token usage. The other providers count recorded model calls.
- Threshold and scheduled-check alerts run in the local server with the dashboard tab closed. Use Test macOS notification in Settings to check delivery permissions.

## Accounts and Codex reset credits

In **Settings → Accounts**, add a label and the configuration directory of each signed-in profile. Use an absolute path or a path starting with `~/`. A populated list supplies the visible quota rows, local transcript history, and alerts for that provider. An empty list uses the CLI's current environment. Auto-Route always uses the current environment and its shared quota cache.

| CLI | Configuration directory |
| --- | --- |
| Claude Code | `CLAUDE_CONFIG_DIR` |
| GitHub Copilot | `COPILOT_HOME` |
| OpenAI Codex | `CODEX_HOME` |
| Antigravity | One account using the current CLI environment |

Named profiles use their saved sign-in. Agent Usage removes inherited provider token overrides from their probes so each CLI can resolve that profile's credentials.

Codex reset credits appear with their title and local expiry. The server rechecks the credit before notifying at 24 hours and 2 hours if it remains available. Each reminder is saved per account and credit, including across server restarts. If the server was offline, it can send the reminder for the interval still in progress.

## macOS menu bar

Run `npm run menubar:build` with the Xcode Command Line Tools installed. It writes `.tmp/menubar/Agent Usage Bar.app`. To install at login, explicitly run `npm run menubar:install`. It copies the app to `~/Applications/Agent Usage Bar.app` and registers `com.vit129.agent-usage-bar` in `~/Library/LaunchAgents` for your GUI session. Quit closes it until the next login or until you open it again.

For a manual check, open the built app without installing it and use an Agent Usage server on `127.0.0.1:43127`. Verify the colored title matches the lowest known percentage, the menu lists provider/account windows and both Auto-Route decisions, and each available Codex credit shows its expiry. Check **Open dashboard** and **Refresh**. With the server stopped, verify **—** and **Start Agent Usage**. The start action needs the `~/.local/bin/agent-usage` launcher described above. Select **Quit** to close the app.
