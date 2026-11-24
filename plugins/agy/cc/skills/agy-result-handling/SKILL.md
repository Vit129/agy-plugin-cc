---
name: agy-result-handling
description: Internal guidance for presenting agy output back to the user
user-invocable: false
---

# agy Result Handling

When the helper returns agy output:
- Preserve the helper's findings and next steps structure.
- For review output, present findings first, ordered by severity if provided.
- Use the file paths and line numbers exactly as agy reports them.
- Preserve evidence boundaries. If agy marked something as an inference or uncertainty, keep that distinction.
- If there are no findings, say that explicitly and keep the residual-risk note brief.
- If agy made edits, say so explicitly and list the touched files when the helper provides them.
- For `agy:agy-rescue`, do not turn a failed or incomplete agy run into a Claude-side implementation attempt. Report the failure and stop.
- For `agy:agy-rescue`, if agy was never successfully invoked, do not generate a substitute answer at all.
- CRITICAL: After presenting review findings, STOP. Do not make any code changes. Do not fix any issues. You MUST explicitly ask the user which issues, if any, they want fixed before touching a single file. Auto-applying fixes from a review is strictly forbidden, even if the fix is obvious.
- If the helper reports a failed agy run, include the most actionable error lines and stop there instead of guessing.
- If the helper reports that setup is required, direct the user to `/agy:setup` and do not improvise alternate flows.
