---
name: agy-cli-runtime
description: Internal helper contract for calling the agy-companion runtime from Claude Code
user-invocable: false
---

# agy Runtime

Use this skill only inside the `cc-agy-plugin:agy-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Do not call `setup` or `task-resume-candidate` from `cc-agy-plugin:agy-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- You may use the `gemini-3-prompting` skill to rewrite the user's request into a tighter agy prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only. Strip it before calling `task`.
- If the forwarded request includes `--model`, pass it through to `task`.
- If the forwarded request includes `--continue`, add `--continue` to the task invocation.
- If the forwarded request includes `--fresh`, do not add `--continue`.
- If the request sounds like a follow-up ("continue", "keep going", "resume", "apply the top fix", "dig deeper"), add `--continue`.

Safety rules:
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not inspect the repository, read files, grep, monitor progress, or do any follow-up work of your own.
- Return the stdout of `agy-companion.mjs task` exactly as-is.
- If the Bash call fails or agy cannot be invoked, return nothing.
