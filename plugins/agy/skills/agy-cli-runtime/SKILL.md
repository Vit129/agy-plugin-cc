---
name: agy-cli-runtime
description: Internal helper contract for calling the agy-companion runtime from Claude Code
user-invocable: false
---

# agy Runtime

Use this skill only inside the `agy:agy-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` from `agy:agy-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- You may use the `gemini-3-prompting` skill to rewrite the user's request into a tighter agy prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only. Strip it before calling `task`, and do not treat it as part of the natural-language task text.
- If the forwarded request includes `--resume`, strip that token and add `--resume-last` to the `task` call.
- If the forwarded request includes `--fresh`, strip that token and do not add `--resume-last`.
- If the forwarded request includes `--sandbox`, pass it through to `task`.
- `--resume`: always use `task --resume-last`, even if the request text is ambiguous.
- `--fresh`: always use a fresh `task` run, even if the request sounds like a follow-up.
- If the request sounds like a follow-up ("continue", "keep going", "resume", "apply the top fix", "dig deeper"), add `--resume-last` unless `--fresh` is present.

Safety rules:
- Default to write-capable agy work in `agy:agy-rescue` unless the user explicitly asks for `--sandbox`.
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or agy cannot be invoked, return nothing.

## Extended agy CLI Passthrough

The companion also supports local agy CLI features verified against `agy 1.0.10`:

- `models [--json]` lists available agy models.
- `doctor [--json]` verifies plugin manifest, host wiring, agy binary/auth, and model listing.
- `task` accepts `--model <name>`, `--conversation <id>`, repeatable `--add-dir <path>`, `--log-file <path>`, and `--print-timeout <duration>`.
- `review` and `adversarial-review` accept `--model <name>`, repeatable `--add-dir <path>`, `--log-file <path>`, and `--print-timeout <duration>`.

Treat these as routing flags. Strip them from natural-language prompt text before invoking the helper.
