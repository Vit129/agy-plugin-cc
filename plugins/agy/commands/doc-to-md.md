---
description: Convert a PDF, Word document or image to clean Markdown with agy (multimodal Gemini)
argument-hint: '[--tier <low|medium|high>] [--background] <file> [focus]'
allowed-tools: Bash(node:*), Bash(mkdir:*)
---

Convert a document to Markdown by delegating the reading to agy, so the document itself never enters this conversation.

Raw arguments: `$ARGUMENTS`

Steps:
1. Take the first non-flag argument as the input file and the rest as an optional focus. If no file is given, ask for one and stop. If the file does not exist, say so and stop.
2. Choose the output path `docs/agy/converted/<input basename without extension>.md` under the current repository root, and create the directory with `mkdir -p`.
3. Run, keeping any `--tier` / `--background` flags the user gave:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task [flags] "Read the file <absolute input path> and write a faithful Markdown version of it to <absolute output path>. Keep headings, lists and tables (as Markdown tables); transcribe text in images and scans; do not summarize or add content. <focus, if given>. Reply only with the output path and a 3-line summary of the document."
```
4. Return agy's reply verbatim. Do not open the converted file unless the user asks.

If agy is not installed, tell the user to run `/agy:setup`.
