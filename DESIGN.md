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

Quota rows show the CLI account identity under the provider and an Active now badge for recent transcript writes. Settings shows one switch per provider and lists detected account identities. The primary account action opens Terminal for sign-in. Advanced holds manual labels and configuration folders. Removing a managed account prompts before deleting its files. Available Codex reset credits appear below the route decisions with local expiry times.

The macOS status item shows each active provider's logo and lowest remaining quota. At idle it dims the logo and quota of the provider with the lowest known quota. The menu shows indented windows under each provider and account heading. Quota percentages carry severity colors, with secondary text for identities and reset times. When the server is unavailable, the item shows a dash and offers to start it.
