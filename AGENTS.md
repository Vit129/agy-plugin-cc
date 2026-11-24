# agy-plugin-cc — Agent Instructions

## Agent Memory

Per-project memory lives centrally in `~/Git/Personal/unified-memory-vault/memory-vault/agy-plugin-cc/` (never in this repo). Resolve path via `python3 ~/.claude/scripts/lib/memory_root.py .` or search via `python3 ~/.claude/scripts/recall.py "<query>"`.

## Global-First Rule

Global instructions authoritative:
- `~/.claude/rules/` — behavior, routing, skill map
- `~/.claude/skills/` — global skills

## Project Context (auto-loaded every session)

- @.ai/memory-protocol.md
- @CONTEXT.md

## Project Summary

Plugin for Claude Code and OpenAI Codex CLI, **Agy (Antigravity CLI)** ecosystem. One `plugins/agy` tree: shared skills in `skills/`, host-only skills in `cc/skills/` and `codex/skills/`, commands, agents, hooks.

## Skills & Rules

- **Global skills** (`~/.claude/skills/`) — always available every session; pick whichever fits the task.
- **Project-local skills** (`.claude/skills/`, when this repo has any) — check first; these specialize/override the global ones for this repo's own conventions.
- **Global rules** (`~/.claude/rules/`) — behavior/workflow/coding conventions that apply everywhere.
- **Project-local rules** (`rules/`, when this repo has any) — check first; these specialize the global ones for this repo's own domain.

## Skill Routing (domain-based, not keyword-based)

Any work this project: invoke skill by domain, don't wait for keyword:

| Domain | Skill |
|--------|-------|
| Any bug / crash / unexpected behavior | `debugging/debug-mantra` |
| Plugin architecture / design decision | `architect` |
| Skill file authoring or sync | read `rules/skills-sync-protocol.md` |
| Any new feature / code implementation | `aidlc` |
| Code review | `review-personas` |

## Tests

`npm test` — `node:test` over `tests/*.test.mjs` (arg parsing and state store; no dependencies). `npm run check` is the syntax check.

## Session Start

1. Check `CONTEXT.md`, derive active work domain, invoke matching skill above.
2. If task done from previous session: update CONTEXT.md (status: idle), append to MEMORY.md first.

## Code search

- Use `project_search` first. One call returns text matches and code-graph hits together.
- `rg` plus `Read` is the primary method. Read the file before you edit it.
- If `project_search` reports a stale index, treat its graph hits as hints and confirm them with `rg` and `Read`.
- Code-index output is local. Never commit it.
