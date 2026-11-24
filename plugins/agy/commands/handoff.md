---
description: Hand a whole, test-covered task to agy; it is judged only by the test command, with one fix-up round
argument-hint: '[--background|--wait] [--dry-run] [--verify "<cmd>"] [--tests a,b] [--fixups <n>] [--model <name>|--tier <low|medium|high>] [--effort <low|medium|high>] <requirement>'
allowed-tools: Bash(node:*), Bash(git:*), AskUserQuestion
---

Hand the task to agy as a whole and act as the verifier only.

Raw arguments: `$ARGUMENTS`

**When to hand off.** A coherent change of roughly 200+ lines whose "done" is defined by tests (existing ones that must pass, or tests written first). Measured elsewhere, hand-off costs about 0.6× doing it yourself on such tasks, and more than doing it yourself on small edits, and it takes 3–4× the wall-clock time. If the task is a small edit, a judgement call, or has no test command, say so and suggest `/agy:rescue` or doing it directly instead of handing off.

Steps:
1. Write the requirement as observable behavior (10–30 lines): context, what must be true afterwards, constraints, which test files must pass unmodified. Do not open source files to write it; if you do not know the codebase, ask the user or run `/agy:agy` for a short digest first.
2. The companion refuses to start on `main`/`master` or with uncommitted changes. If either applies, tell the user and stop; do not create branches or stash on your own.
3. Run in the background unless the user passed `--wait`:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" handoff --background $ARGUMENTS
```
   Then tell the user: "agy hand-off started in the background. Check `/agy:status` for progress." Use `/agy:result <id>` to collect it.
4. While it runs, do not read the diff or edit files in the repository.
5. Report the result in a few lines: status (`PASS`, `FAIL`, `TEST FILES MODIFIED`, `AGY FAILED`), rounds, the diff stat. Hand the diff to the user as a first draft for human review (look for dead code, duplicated helpers, options nobody asked for). On `FAIL`, offer one more hand-off with a sharper requirement or taking over; do not patch agy's work by hand and call it a hand-off.

The companion detects the test command from `package.json`, `pyproject.toml`, `go.mod` or `Cargo.toml`; pass `--verify` when the gate is something else. Each agy run has a 60-minute `--print-timeout` unless you pass one.

If agy is not installed, tell the user to run `/agy:setup`.
