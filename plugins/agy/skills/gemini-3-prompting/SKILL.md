---
name: gemini-3-prompting
description: Guidance for writing effective prompts for Antigravity (agy) / Gemini 3 models
user-invocable: false
---

# Gemini 3 Prompting for agy

Use this skill only to tighten a user's request into a better agy prompt before forwarding to `task`.

## Effective prompt structure

1. **State the goal clearly** — one sentence describing the desired end state
2. **Provide context** — relevant files, error messages, or constraints the agent should know
3. **Specify scope** — what agy should and should not touch
4. **State acceptance criteria** — how to know when the task is done

## Do

- Be specific about files, functions, or components involved
- Include error messages verbatim if debugging
- Mention the tech stack (React, Python, etc.) if not obvious from the repo
- Ask for a specific output format when the result needs to be consumed downstream (by Claude Code or Codex)

## Don't

- Don't ask agy to "look at everything" — scope it to the relevant area
- Don't include the calling agent's (Claude's or Codex's) own analysis in the prompt — forward the raw task
- Don't add commentary or padding — agy works best with concise, direct prompts
- Don't include `--background`, `--continue`, or `--fresh` flags in the prompt text

## Prompt antipatterns

| Antipattern | Better |
|---|---|
| "Fix the bug somewhere in the auth flow" | "Fix the 401 error in `src/auth/middleware.js:42` — token is not being verified before route access" |
| "Improve the code" | "Refactor `src/utils/parser.js` to remove duplicate null checks and add JSDoc for the public functions" |
| "Look at everything and tell me what's wrong" | "Review `src/features/aiInvestment/` for stale state patterns and Zustand anti-patterns" |

## Research / Audit / Comparison Tasks (exception to "scope narrowly")

The "Don't ask agy to 'look at everything'" rule above is correct for implementation/fix tasks — but it caused a real incident when misapplied to a comparison task: agy was asked to compare two repos and reported several features "missing" from one of them, when they actually existed several directories deeper than the paths the prompt had scoped it to (it only checked top-level `rules`/`scripts` folders, not nested skill subdirectories). Root cause: the prompt scoped the search too narrowly, and agy inferred absence from a shallow/top-level listing instead of an exhaustive search.

For a research/audit/comparison/investigation-type task (the goal is "what exists" or "how do X and Y differ", not "implement/fix Z"):

1. Do NOT scope the prompt to a narrow subdirectory the way an implementation task would be scoped. Explicitly instruct agy to search/grep the full relevant directory tree recursively (including nested skill/plugin/reference subdirectories, not just top-level folders) before reporting that a file, function, or feature is absent. Never let agy report "does not exist" or "missing" based on a shallow or top-level-only listing.
2. Explicitly tell agy to report findings/structure first and NOT make any code edits, unless the user's original request explicitly also asked for an implementation or fix. Default to read-only / report-only for this task type.

| Antipattern | Better |
|---|---|
| "Compare repo A and repo B, tell me what's different" | "Compare repo A and repo B: read every file under both trees recursively (not just top-level dirs), report findings only, do not edit anything unless I ask a follow-up to implement." |

