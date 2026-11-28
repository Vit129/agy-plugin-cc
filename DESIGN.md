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

Settings lists one switch per provider. Saving applies the switches to CLI-triggered dashboard startup, quota polling, alerts, and model history on the same dashboard. When all switches are off, the quota view points to Settings.
