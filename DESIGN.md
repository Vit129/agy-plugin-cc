# Design

## Interaction model

The product is a plugin for two hosts, Claude Code and OpenAI Codex CLI, not a graphical application. The design surface is the command vocabulary (`/agy:*` in Claude Code, `$agy ...` in Codex), prompts, status output, and lifecycle behavior.

## Principles

- Keep the plugin interface explicit about foreground and background execution.
- Keep status and result retrieval available through documented commands; `/agy:status` also shows each job's token usage.
- Return short replies to the host and write long output (research notes, transcripts of agy output, screenshots, images) to files under `docs/agy/` or the state dir, naming the path.
- Let the host verify agy's work: tests for hand-offs, cited pages for research, the images themselves for design reviews.
- Make update checks read-only unless the user explicitly requests a pull (`/agy:update --pull`, `$agy update --pull`).
- Keep runtime review isolated in a separate test Claude Code profile.

There is no visual UI, so a graphical layout specification does not apply.
