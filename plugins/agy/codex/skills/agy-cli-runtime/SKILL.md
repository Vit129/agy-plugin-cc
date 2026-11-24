---
name: agy-cli-runtime
description: Internal helper contract for invoking the agy-companion runtime from Codex.
user-invocable: false
---

# Agy Runtime

Use this helper contract only from the `agy` skill.

Primary helper:

```bash
node "<plugin-root>/scripts/agy-companion.mjs" task "<raw task>"
```

Subcommands:

- `setup [--enable-review-gate|--disable-review-gate] [--json]`
- `task [--background] [--continue|--resume|--fresh] [prompt]`
- `task-worker --job-id <id>`
- `task-resume-candidate [--json]`
- `review [--background|--wait] [--scope auto|working-tree|branch] [--base <ref>]`
- `adversarial-review [--background|--wait] [--scope auto|working-tree|branch] [--base <ref>] [focus]`
- `status [job-id] [--wait] [--all] [--json]`
- `result [job-id] [--json]`
- `cancel [job-id] [--json]`

Rules:

- Use `task` for coding, debugging, diagnosis, planning, and explicit fix delegation.
- Use `setup` only when the user asks to verify installation/readiness.
- Use `task-resume-candidate` before ambiguous rescue continuation.
- Preserve user task text except routing flags.
- If the user explicitly asks for `--continue`, pass `--continue`.
- If the user explicitly asks for `--fresh`, omit `--continue`.
- If the request is a follow-up such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", prefer `--continue`.

## Extended agy CLI Passthrough

The companion also supports local agy CLI features verified against `agy 1.0.10`:

- `models [--json]` lists available agy models.
- `agents [--json]` lists available agy agents (raw `agy agents` passthrough).
- `doctor [--json]` verifies plugin manifest, host wiring, agy binary/auth, and model listing.
- `changelog [--json]` prints agy release notes (no agy task run, just `agy changelog`).
- `task` accepts `--model <name>`, `--effort <low|medium|high>`, `--conversation <id>`, `--project <id>` or `--new-project` (mutually exclusive), `--dangerously-skip-permissions`, repeatable `--add-dir <path>`, `--log-file <path>`, and `--print-timeout <duration>`.
- `review` and `adversarial-review` accept the same `--model`, `--effort`, `--project`/`--new-project`, `--dangerously-skip-permissions`, `--add-dir`, `--log-file`, and `--print-timeout` flags.
- `--model` is validated against a live `agy models` call before the run starts — an unrecognized name fails fast with the current model list instead of reaching agy.
- `--effort` is validated against the static `low|medium|high` enum agy itself defines — no CLI call needed for this one.
- `task`/`review`/`adversarial-review` accept `--dry-run`: prints the resolved options, the live `agy models` list (selected model marked), and current Antigravity quota (5-hour + weekly, Gemini and Claude/GPT pools) — then exits without calling agy. Use it to pick a model and confirm there's enough quota before committing to a real run.
- Quota comes from the separately-installed `codexbar` CLI (`codexbar usage --provider antigravity --json`), not from `agy` itself — `agy`'s own `/usage`/`/quota` are TUI-only and error under `--print`/non-interactive mode. If `codexbar` isn't installed, `--dry-run` shows an install hint instead of quota and everything else still works.

Treat these as routing flags. Strip them from natural-language prompt text before invoking the helper.
