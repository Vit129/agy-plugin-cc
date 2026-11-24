---
description: Generate an image with agy's built-in image generation tool and save it in the repository
argument-hint: '[--tier <low|medium|high>] [--out <path>] <description>'
allowed-tools: Bash(node:*), Bash(mkdir:*), Bash(test:*), Read
---

Generate an image through agy, which has an image generation tool Claude does not.

Raw arguments: `$ARGUMENTS`

Steps:
1. Take `--out <path>` as the target file if given; otherwise use `docs/agy/images/<YYYY-MM-DD>-<short-slug-of-description>.png` under the repository root. Create its directory with `mkdir -p`. Everything else (except `--tier` / `--model`) is the description; if it is empty, ask for one and stop.
2. Run, keeping `--tier` / `--model` if given:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task --print-timeout 10m [flags] "Use your built-in image generation tool to create: <description>. Save the final image to <absolute target path> (copy it there if the tool saved it elsewhere). If generation fails, retry once. End your reply with exactly one line: IMAGE_PATH: <absolute path>"
```
3. Take the path from the `IMAGE_PATH:` line (fall back to the target path). Check it exists with `test -f`. If it does not, report agy's reply and stop.
4. Open the image with `Read` and check it matches the description. Reply with the path and one line on what it shows; say plainly if it does not match.

If agy is not installed, tell the user to run `/agy:setup`.
