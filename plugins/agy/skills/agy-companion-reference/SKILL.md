---
name: agy-companion-reference
description: Shared reference for agy-companion subcommands and flags (models, doctor, task, review, handoff, --tier, --deep, usage, dry-run, quota). Used by both the Claude Code and Codex runtime skills.
user-invocable: false
---

# agy Companion Reference

The single source for what the companion accepts. Host-specific skills (`agy-cli-runtime` under `cc/skills/` for Claude Code, `codex/skills/` for Codex) say how to invoke it; this file says what it supports. Edit features here, not in the host skills.

## Subcommands and flags

Verified against `agy 1.5.16`. These hold on every host (Claude Code and Codex):

- `models [--json]` lists available agy models.
- `agents [--json]` lists available agy agents (raw `agy agents` passthrough).
- `doctor [--json]` verifies plugin manifest, host wiring, agy binary/auth, and model listing.
- `changelog [--json]` prints agy release notes (no agy task run, just `agy changelog`).
- `task` accepts `--model <name>`, `--effort <low|medium|high>`, `--conversation <id>`, `--project <id>` or `--new-project` (mutually exclusive), `--dangerously-skip-permissions`, repeatable `--add-dir <path>`, `--log-file <path>`, and `--print-timeout <duration>`.
- `review` and `adversarial-review` accept the same `--model`, `--effort`, `--project`/`--new-project`, `--dangerously-skip-permissions`, `--add-dir`, `--log-file`, and `--print-timeout` flags.
- `--tier <low|medium|high>` maps to `gemini-3.8-flash-low|medium|high` and cannot be combined with `--model`.
- `review` and `adversarial-review` accept `--deep`: agy also reads callers, surrounding code and tests of the changed symbols (read only).
- Replies longer than 12,000 characters are cut; the rendered output ends with a line naming the file that holds the full text.
- `handoff` accepts `--verify <cmd>`, `--tests <a,b>` (repeatable), `--fixups <n>` (default 1), `--requirement-file <path>`, `--model`/`--tier`, `--effort`, `--print-timeout` (default 60m), `--background`, `--dry-run`. Exit codes: 0 PASS, 4 FAIL, 5 AGY FAILED, 6 TEST FILES MODIFIED.
- `task`, `review`, `adversarial-review` and `handoff` call agy with `--output-format json`; the reply is unwrapped to plain text, token usage is stored on the job (shown by `status`) and appended to `usage.jsonl` in the state dir.
- `--model` is validated against a live `agy models` call before the run starts — an unrecognized name fails fast with the current model list instead of reaching agy.
- `--effort` is validated against the static `low|medium|high` enum agy itself defines — no CLI call needed for this one.
- `task`/`review`/`adversarial-review` accept `--dry-run`: prints the resolved options, the live `agy models` list (selected model marked), and current Antigravity quota (5-hour + weekly, Gemini and Claude/GPT pools) — then exits without calling agy. Use it to pick a model and confirm there's enough quota before committing to a real run.
- Quota comes from the separately-installed `codexbar` CLI (`codexbar usage --provider antigravity --json`), not from `agy` itself — `agy`'s own `/usage`/`/quota` are TUI-only and error under `--print`/non-interactive mode. If `codexbar` isn't installed, `--dry-run` shows an install hint instead of quota and everything else still works.

Treat these as routing flags. Strip them from natural-language prompt text before invoking the helper.

`--dangerously-skip-permissions` disables all agy tool-permission prompts for that run — only forward it when the user explicitly asked for it, never by default.

`/goal <...>` is not a CLI flag — it is a prompt-level directive agy's own agent parses out of the `--print` text. Passing a prompt that starts with `/goal` through `task` already works with no companion changes; it runs agy in autonomous goal mode (uncapped duration since agy 1.0.14) rather than a single turn.
