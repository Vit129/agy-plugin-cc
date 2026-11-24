---
description: Hand this Claude session's work over to an interactive agy session (writes a context file and prints the agy command)
argument-hint: '[extra notes for agy]'
allowed-tools: Bash(git:*), Bash(mkdir:*), Write
---

Move the work in this session to agy so the user can continue there (for example when Claude's quota runs out). This is not a delegation: you do not run agy yourself.

Raw arguments (extra notes for agy): `$ARGUMENTS`

Steps:
1. Collect repository state: `git rev-parse --show-toplevel`, `git branch --show-current`, `git status --short`, `git diff --stat` and `git diff --cached --stat`. Do not paste full diffs into the file; agy can run git itself.
2. Write `.tmp/agy-transfer-<YYYY-MM-DD-HHMM>.md` under the repository root (create `.tmp/` with `mkdir -p`) with these sections, written from what you know of this conversation:
   - **Goal**: what the user is trying to achieve, in their terms.
   - **Done so far**: decisions made and changes already in place (files, commits, PRs).
   - **Next steps**: the concrete remaining tasks, in order, with the first one clear enough to start immediately.
   - **Constraints**: rules the user set in this session (scope limits, things not to touch, branch/PR rules) and the instruction files to read (`AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md` if present).
   - **Open questions / risks**: anything unverified or undecided.
   - **Repository state**: the git output from step 1.
   - **Notes from the user**: `$ARGUMENTS`, if any.
   Keep it under ~80 lines. Never include secrets, tokens or credential values.
3. Reply with the file path and this command for the user to run in a terminal at the repository root:
```bash
agy -i "Read .tmp/agy-transfer-<timestamp>.md and the instruction files it lists, then continue from Next steps."
```
   Add `--dangerously-skip-permissions` only if the user asks for unattended runs.
