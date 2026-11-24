---
description: Quick web research through agy with a cited source for every claim; Claude spot-checks the key claims
argument-hint: '[--tier <low|medium|high>] [--background] <question>'
allowed-tools: Bash(node:*), Bash(mkdir:*), Read, WebFetch
---

One round of web research done by agy (cheap on Claude tokens), with citations Claude checks.

Raw arguments: `$ARGUMENTS`

**Use this, not the `deep-research` skill,** for a focused question that needs current facts with sources (a version, a price, an API change, "what does X support"). For a broad, multi-angle report (comparisons across many options, a market or literature review), use `deep-research` instead and say so.

Steps:
1. If the question is empty, ask for one and stop. Choose the output path `docs/agy/research/<YYYY-MM-DD>-<short-slug>.md` under the repository root and create its directory.
2. Run, keeping `--tier` / `--model` / `--background` if given:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task --print-timeout 15m [flags] "Research on the web: <question>. Read the pages themselves, not only search snippets. Write to <absolute output path>: a direct answer first, then the findings as bullets where every bullet ends with the URL(s) it comes from, preferring primary sources (official docs, release notes, the vendor's own pages) and giving at least two independent sources for each key claim. Note the publication or update date when the page shows one, and list anything you could not confirm under 'Unverified'. Do not modify any other file. Reply with at most 12 lines: the direct answer and the 3 key claims with their URLs."
```
3. Verify before answering: for each of the key claims (up to 3), open at least one of its cited URLs with `WebFetch` and confirm the page says it. A claim with only one source, or whose page does not support it, is reported as unverified, not as fact.
4. Reply with the answer, each key claim marked verified or unverified with its URL, and the path of the full notes.

If agy is not installed, tell the user to run `/agy:setup`.
