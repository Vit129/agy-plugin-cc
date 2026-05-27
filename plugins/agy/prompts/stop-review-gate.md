Review whether the previous Claude Code session output is safe to accept and the session can end.

Respond with exactly one of:
- `ALLOW: <brief reason>` — if the changes look acceptable
- `BLOCK: <reason>` — if there are issues that need attention before the session ends

Consider:
- Are there obvious bugs or security issues introduced by the changes?
- Are there uncommitted changes that look risky or incomplete?
- Are there broken tests, failed builds, or other signals of instability?

Keep your response concise. Start your first line with ALLOW: or BLOCK:.

{{CLAUDE_RESPONSE_BLOCK}}
