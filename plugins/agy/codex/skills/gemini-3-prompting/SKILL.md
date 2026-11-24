---
name: gemini-3-prompting
description: Guidance for writing effective prompts for Antigravity (agy) / Gemini 3 models.
user-invocable: false
---

# Gemini 3 Prompting for Agy

Use this only to tighten a user's request before forwarding it to `agy`.

## Prompt Structure

1. State the goal clearly.
2. Provide the relevant context, files, errors, or constraints.
3. Specify scope and non-goals.
4. State acceptance criteria.

## Do

- Be specific about files, functions, components, and error messages.
- Include the tech stack if it is relevant and not obvious.
- Keep the prompt concise and direct.
- Ask for a specific output format when Codex needs to consume the result.

## Do Not

- Do not ask agy to "look at everything" without scope.
- Do not include Codex-side speculation as fact.
- Do not include `--background`, `--continue`, or `--fresh` inside the natural-language prompt.
- Do not ask agy to make irreversible changes without a clear verification plan.

## Research / Audit / Comparison Tasks (exception to "scope it")

The "don't ask agy to look at everything" rule above is for implementation/fix tasks. It
backfired on a comparison task: agy was asked to diff two repos and reported several features
"missing" from one side that actually existed several directories deeper than the paths the
prompt had scoped it to (it only checked top-level `rules`/`scripts` folders, not nested skill
subdirectories). Root cause: the prompt scoped the search too narrowly, and agy inferred absence
from a shallow/top-level listing instead of an exhaustive one.

For a research/audit/comparison/investigation task (the goal is "what exists" or "how do X and Y
differ", not "implement/fix Z"):

1. Do not narrow-scope the prompt the way an implementation task would be scoped. Explicitly tell
   agy to search/grep the full relevant directory tree recursively — including nested
   skill/plugin/reference subdirectories, not just top-level folders — before reporting that a
   file, function, or feature is absent. Never let it report "missing"/"does not exist" from a
   shallow or top-level-only listing.
2. Explicitly tell agy to report findings/structure first and make no code edits, unless the
   original request also explicitly asked for an implementation or fix. Default to read-only for
   this task type.
