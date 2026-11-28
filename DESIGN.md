# Design

## Interaction model

The product is a plugin for two hosts, Claude Code and OpenAI Codex CLI, with an optional local Agent Usage dashboard. The design surface is the command vocabulary (`/agy:*` in Claude Code, `$agy ...` in Codex), prompts, status output, and lifecycle behavior.

## Principles

- Keep the plugin interface explicit about foreground and background execution.
- Keep status and result retrieval available through documented commands; `/agy:status` also shows each job's token usage.
- Return short replies to the host and write long output (research notes, transcripts of agy output, screenshots, images) to files under `docs/agy/` or the state dir, naming the path.
- Let the host verify agy's work: tests for hand-offs, cited pages for research, the images themselves for design reviews.
- Make update checks read-only unless the user explicitly requests a pull (`/agy:update --pull`, `$agy update --pull`).
- Keep runtime review isolated in a separate test Claude Code profile.

Agent Usage shows quota remaining and reset times for each provider, estimated session capacity, and model totals for 7 or 30 days. Colors and labels distinguish threshold severity and unavailable or stale values. The Claude row shows its probe error reason when a quota read fails. Plan usage lists the allowed or diverted decision and reason for each delegation direction.

Quota rows show the CLI account identity under the provider and an Active now badge for recent transcript writes. Settings uses a left navigation rail and turns it into tabs on narrow screens. General controls refresh and menu bar visibility. Notifications holds alert toggles, thresholds and the Claude Full reset expiry and Used it action. An empty expiry shows a prompt with a link to the provider usage page. Accounts shows one row per provider with the detected identity and Terminal sign-in. Its Advanced section holds additional accounts and manual configuration folders. Removing a managed account prompts before deleting its files. Auto-Route shows both directions and shares its Low and Critical values with the notification Warning and Critical thresholds.

The macOS status item gives each selected active provider two lines. A tinted vector mark or two-letter monogram and the five-hour session go on the first line, and the weekly or monthly window goes on the second. Known resets show a local 24-hour time and include the date for other days. Below Warning, the percentage uses a yellow pill with black text. Below Critical, it uses a red pill with white text. At or above Warning, it uses the default label color. When the title reaches 360 points, the windows reduce to percentages before the least recently active providers are hidden. At idle the title shows the selected provider with the lowest known quota. The tooltip lists every monitored window and its full reset time.

The popover opens on Overview, with an account heading, update age and provider-colored bars for each quota window. Provider tabs add the reset time, reserve, a linear exhaustion estimate and weekly capacity based on the dashboard's configured session cost. Session windows left count five-hour intervals, including a partial interval. Green and red ticks mark the expected remaining quota at an even pace. Auto-Route, reset credits and the dashboard, refresh and quit actions stay at the bottom. When the server is unavailable, the item shows a dash and offers to start it.
