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
- Ask for a specific output format when the result needs to be consumed downstream

## Don't

- Don't ask agy to "look at everything" — scope it to the relevant area
- Don't include Claude-side analysis in the prompt — forward the raw task
- Don't add commentary or padding — agy works best with concise, direct prompts
- Don't include `--background`, `--continue`, or `--fresh` flags in the prompt text

## Prompt antipatterns

| Antipattern | Better |
|---|---|
| "Fix the bug somewhere in the auth flow" | "Fix the 401 error in `src/auth/middleware.js:42` — token is not being verified before route access" |
| "Improve the code" | "Refactor `src/utils/parser.js` to remove duplicate null checks and add JSDoc for the public functions" |
| "Look at everything and tell me what's wrong" | "Review `src/features/aiInvestment/` for stale state patterns and Zustand anti-patterns" |
