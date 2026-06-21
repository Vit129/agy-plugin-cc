# agy-plugin-cc — Claude Code Guide

## Global-First Rule

Global instructions are authoritative:
- `~/.claude/rules/` — behavior, routing, skill map
- `~/.claude/skills/` — global skills

## Project Context (auto-loaded every session)

- @.ai/memory-protocol.md
- @agent-memory/CONTEXT.md
- @agent-memory/INDEX.md

## Project Summary

Claude Code plugin for the **Agy (Antigravity CLI)** ecosystem. Plugin system mirrors `~/.claude/` structure — skills, commands, agents, hooks.

## Skill Routing (domain-based, not keyword-based)

For ANY work in this project, invoke skill based on domain — do not wait for keyword:

| Domain | Skill |
|--------|-------|
| Any bug / crash / unexpected behavior | `debugging/debug-mantra` |
| Plugin architecture / design decision | `architect` |
| Skill file authoring or sync | read `rules/skills-sync-protocol.md` |
| Any new feature / code implementation | `aidlc` |
| Code review | `review-personas` |

## Session Start

1. Check `agent-memory/CONTEXT.md` → derive active work domain → invoke matching skill above.
2. If task is done from previous session: update CONTEXT.md (status → idle) + append to MEMORY.md first.
