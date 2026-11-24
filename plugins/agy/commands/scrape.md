---
description: Extract structured data from one web page with agy (table or JSON saved in the repository)
argument-hint: '[--tier <low|medium|high>] [--json] <url> [what to extract]'
allowed-tools: Bash(node:*), Bash(mkdir:*), Read
---

One-off extraction of structured data from a single page. Not for recurring pipelines or for sites that forbid scraping.

Raw arguments: `$ARGUMENTS`

Steps:
1. The first URL is the page; the rest (minus flags) describes what to extract. If no URL is given, ask and stop. If no schema is given, extract the page's main repeated items (rows of a table, cards of a list) with their visible fields.
2. Output path: `docs/agy/scrapes/<YYYY-MM-DD>-<host>-<short-slug>.md`, or `.json` with `--json`. Create the directory.
3. Run, keeping `--tier` / `--model` if given:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task --print-timeout 10m [flags] "Open <url> in a browser (render JavaScript; follow pagination only if asked). Extract: <schema or 'the main repeated items with their visible fields'>. Copy values exactly as shown; leave a field empty rather than guessing. Write the result to <absolute output path> as <a Markdown table | a JSON array of objects>, with a first line noting the URL and the time of extraction. Do not modify any other file. Reply with: the row count, the column names, and the first 3 rows."
```
4. Open the output file with `Read`, check the row count and columns match agy's reply, and return the path, row count and first rows. Say that values are as extracted by agy and were not checked against the page one by one.

If agy is not installed, tell the user to run `/agy:setup`.
