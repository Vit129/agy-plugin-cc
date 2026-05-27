---
description: Delegate investigation, an explicit fix request, or follow-up rescue work to the agy (Antigravity) agent
argument-hint: "[--background|--wait] [--continue|--fresh] [--model <model>] [what agy should investigate, solve, or continue]"
allowed-tools: Bash, AskUserQuestion, Agent
---

Invoke the `agy:agy-rescue` subagent via the `Agent` tool (`subagent_type: "agy:agy-rescue"`), forwarding the raw user request as the prompt.
`agy:agy-rescue` is a subagent, not a skill — do not call `Skill(agy:agy-rescue)`. The command runs inline so the `Agent` tool stays in scope.
The final user-visible response must be agy's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `agy:agy-rescue` subagent in the background.
- If the request includes `--wait`, run it in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to the task text.
- `--model` is a runtime-selection flag. Preserve it for the forwarded call but do not treat it as part of the natural-language task text.
- If the request includes `--continue`, do not ask whether to continue. The user already chose.
- If the request includes `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting agy, check for a resumable session by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task-resume-candidate --json
```

- If that helper reports `available: true`, use `AskUserQuestion` exactly once to ask whether to continue the current agy conversation or start a new one.
- The two choices must be:
  - `Continue current agy conversation`
  - `Start a new agy conversation`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current agy conversation (Recommended)` first.
- Otherwise put `Start a new agy conversation (Recommended)` first.
- If the user chooses continue, add `--continue` before routing to the subagent.
- If the user chooses a new conversation, add `--fresh` before routing to the subagent.
- If the helper reports `available: false`, do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It uses one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task ...` and returns that stdout as-is.
- Return the agy output verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- If the helper reports that agy is missing or unauthenticated, stop and tell the user to run `/agy:setup`.
- If the user did not supply a request, ask what agy should investigate or fix.
