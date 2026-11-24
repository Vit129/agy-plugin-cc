---
description: agy captures desktop and mobile screenshots of a URL; Claude reviews the screenshots for UI/UX issues
argument-hint: '[--tier <low|medium|high>] <url> [focus]'
allowed-tools: Bash(node:*), Bash(mkdir:*), Bash(test:*), Read
---

agy drives the browser; Claude does the review from the images. Do not rely on agy's own description of the page: in testing, agy described elements (an underlined link, a card layout) that the screenshot did not contain.

Raw arguments: `$ARGUMENTS`

Steps:
1. The first URL is the page; the rest (minus flags) is an optional focus. If no URL is given, ask and stop. Output folder: `docs/agy/design-reviews/<YYYY-MM-DD>-<host>/` under the repository root; create it.
2. Run, keeping `--tier` / `--model` if given:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task --print-timeout 10m [flags] "Open <url> in a browser. Take full-page screenshots at 1440px wide and at 390px wide and save them as <folder>/desktop.png and <folder>/mobile.png. Do not modify any other file. End your reply with: SCREENSHOTS: <absolute paths>"
```
3. Check both files exist with `test -f`. Open each with `Read` and review them yourself (use the `uxui-designer` skill if it is available): visual hierarchy, typography, spacing and alignment, color contrast, responsiveness between the two widths, and anything broken or clipped. Apply the focus if one was given.
4. Write the review to `<folder>/review.md`: top 3 strengths, top 3 issues with a concrete fix each, then other notes. Reply with the top issues and the folder path. Only report what is visible in the screenshots.

If agy is not installed, tell the user to run `/agy:setup`.
