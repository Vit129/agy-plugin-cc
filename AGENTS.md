# agy-plugin-cc — Agent Instructions

## Agent Memory

`agent-memory/` is gitignored here (2026-08-16+) — not tracked in this repo, centrally backed up instead to the private `github.com/Vit129/agent-memory-private` repo (`agent-memory/agy-plugin-cc/`). Files stay physically in place; only git tracking changed. The `@agent-memory/CONTEXT.md` / `@agent-memory/INDEX.md` auto-loads below will silently no-op if missing (fresh clone) — restore via `~/.claude/scripts/bootstrap-new-machine.sh`, or manually: `rsync -a ~/Git/Personal/agent-memory-private/agent-memory/agy-plugin-cc/ agent-memory/`.

## Global-First Rule

Global instructions authoritative:
- `~/.claude/rules/` — behavior, routing, skill map
- `~/.claude/skills/` — global skills

## Project Context (auto-loaded every session)

- @.ai/memory-protocol.md
- @agent-memory/CONTEXT.md
- @agent-memory/INDEX.md

## Project Summary

Claude Code plugin, **Agy (Antigravity CLI)** ecosystem. Plugin system mirror `~/.claude/` structure — skills, commands, agents, hooks.

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

1. Check `agent-memory/CONTEXT.md`, derive active work domain, invoke matching skill above.
2. If task done from previous session: update CONTEXT.md (status: idle), append to MEMORY.md first.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<ClassName/FileName>"` for a known symbol/file (name match, not free-form concept search - use `query` for that). These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- After judging a query/path/explain result useful, a dead end, or wrong, run `graphify save-result --question "Q" --answer "A" --outcome useful|dead_end|corrected --nodes N1 N2` - this accumulates across sessions so the same dead end or vocabulary mismatch isn't re-derived every time. At the start of a session, check `graphify-out/reflections/LESSONS.md` if it exists (built via `graphify reflect`) for preferred sources, known dead ends, and past corrections.
