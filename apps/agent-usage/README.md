# Agent Usage

Agent Usage serves a local dashboard for Claude Code, Antigravity, GitHub Copilot, and OpenAI Codex. Run `npm run dashboard` from the repository to start or reuse it, then open the URL it prints. For development, `npm run dashboard -- serve` starts the server in the foreground.

- The server listens on `127.0.0.1:43127` by default. Set `AGENT_USAGE_PORT` to override it.
- Run `node apps/agent-usage/cli.mjs install-launcher` to write an executable `agent-usage` launcher at `~/.local/bin/agent-usage`. It calls `apps/agent-usage/cli.mjs` through a stable Node path (for example `/opt/homebrew/bin/node`, not the versioned Cellar path) when that path resolves to the same binary. Source `apps/agent-usage/terminal-startup.zsh` from `~/.zshrc` with the launcher on your PATH. Typing `claude`, `agy`, `copilot`, or `codex` in an interactive Zsh session then starts or reuses the same server if that provider is enabled. The Claude Code and Antigravity plugin startup hooks use the same provider switch.
- Local state and `server.log` live in `~/.local/state/agent-usage/` or `AGENT_USAGE_STATE_DIR`. Quota comes directly from each signed-in CLI. Agent Usage reads Claude Code’s interactive `/usage` with Python 3.9+, Antigravity’s JSON `/usage`, Copilot CLI SDK’s account quota, and Codex App Server’s account rate limits. A complete live status-line snapshot skips the Claude or Antigravity CLI probe. Native samples also feed the shared cache used by both companions. Copilot shows monthly entitlement and displays a reset time when the CLI supplies one in the future. The server needs a fresh sample from every displayed quota window to estimate session capacity.
- **Plan usage** shows Claude→agy and agy→Claude Auto-Route decisions. The Claude row displays probe failures such as `parse-failed`, `timeout`, or `trust-required`. Changes to the failure reason are logged in `server.log`.
- Settings controls which providers the dashboard displays, polls, and alerts on. Claude Code, Antigravity, and Copilot start enabled. Enable OpenAI Codex to use the signed-in Codex account. Disabling a provider preserves its transcripts and pauses quotas, history display, and alerts. The shared refresh interval applies to enabled providers.
- `npm run dashboard -- schedule 2026-11-27T20:55:00+07:00 6` records six projected 5-hour check times. `npm run dashboard -- check-reset` reads quota through the running server. A scheduled check reports the available snapshot, including when it is stale or missing. On macOS a user LaunchAgent can invoke `agent-usage check-reset --scheduled` at the six calendar times to start a checker even when the server is down. The command checks the stored date and time before acting.
- The dashboard reads model usage from local CLI transcripts. Only model names and aggregate counters are served, and timing is shown as unavailable when it is missing from the log. Codex counts recorded turns with token usage. The other providers count recorded model calls.
- Threshold and scheduled-check alerts run in the local server with the dashboard tab closed. Use Test macOS notification in Settings to check delivery permissions.

## Accounts and Codex reset credits

**Settings → Accounts** lists sign-ins found in the current CLI home, the default home when it differs, and Agent Usage's managed homes. The quota rows show the account email or GitHub login when the CLI records it locally. Only the loopback dashboard and menu receive those identities. Agent Usage does not write identities or tokens to its state or logs.

Use **Sign in another account** to open the provider's sign-in in macOS Terminal. Agent Usage creates a private folder at `accounts/<provider>/<id>` under its state directory and sets the CLI home variable for that Terminal command. Complete the browser or device authorization in Terminal. The dashboard polls for the new account every 15 seconds. **Remove** asks before deleting a managed folder and its contents. Antigravity uses one CLI account.

| CLI | Home variable | Local identity | Terminal command |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE_CONFIG_DIR` | `.claude.json` → `oauthAccount.emailAddress`. The default also checks `~/.claude.json`. | `claude auth login` |
| GitHub Copilot | `COPILOT_HOME` | `config.json` → `lastLoggedInUser.login` or the sole `loggedInUsers[].login`. | `copilot login` |
| OpenAI Codex | `CODEX_HOME` | `auth.json` → `tokens.id_token` payload → `email`. | `codex login` |
| Antigravity | `AGY_HOME` | `google_accounts.json` → `active`. The default also checks `~/.gemini/google_accounts.json`. | — |

Use **Advanced** to enter a label and an absolute or `~/` path for a manually managed profile. A populated manual list replaces the implicit account for that provider. Signed-in managed accounts are included automatically. Named and managed profiles use their saved sign-in. Agent Usage removes inherited provider token overrides when invoking their CLIs. Auto-Route always uses the inherited CLI environment and shared quota cache.

Codex reset credits appear with their title and local expiry. The server rechecks the credit before notifying at 24 hours and 2 hours if it remains available. Each reminder is saved per account and credit, including across server restarts. If the server was offline, it can send the reminder for the interval still in progress.

## macOS menu bar

Run `npm run menubar:build` with the Xcode Command Line Tools installed. It writes `.tmp/menubar/Agent Usage Bar.app`. To install at login, explicitly run `npm run menubar:install`. It copies the app to `~/Applications/Agent Usage Bar.app` and registers `com.vit129.agent-usage-bar` in `~/Library/LaunchAgents` for your GUI session. Quit closes it until the next login or until you open it again.

The build copies transparent 32 px template PNGs from a local `AGENT_USAGE_ICON_DIR` when available (`claude.png`, `agy.png`, `copilot.png`, `codex.png`). Otherwise it converts the corresponding marks from a locally installed CodexBar app in `/Applications` or `~/Applications` using macOS `sips`. The generated app contains these local assets. Provider marks are represented by letters when a local image is unavailable.

The status title displays each enabled provider with a transcript write in the past two minutes and that provider's lowest remaining quota. When idle it shows the provider with the lowest known quota in a dimmer color. Activity uses file modification times, so it can remain visible briefly after an agent stops. The dashboard shows the same activity as **Active now**.

For a manual check, open the built app without installing it and use an Agent Usage server on `127.0.0.1:43127`.

1. In light and dark appearance, open the menu. Check that provider headings and indented quota rows are readable, email and reset text are secondary, and only the quota percentage has the severity color.
2. With a recent transcript from one provider and another provider exhausted, verify the title shows the active provider's mark and quota. Check multiple active providers and the dimmed title when idle. Check **Active now** on the corresponding dashboard rows.
3. Check both Auto-Route decisions, available Codex credits and their expiry, **Open dashboard**, and **Refresh**.
4. With the server stopped, verify **—** and **Start Agent Usage**. The start action needs the `~/.local/bin/agent-usage` launcher described above. Select **Quit** to close the app.
