---
description: Ask agy (multimodal Gemini) about an audio, video or image file; the full transcript goes to a file, not this conversation
argument-hint: '[--tier <low|medium|high>] [--background] <file|URL> [| question]'
allowed-tools: Bash(node:*), Bash(mkdir:*)
---

Delegate listening, watching or looking to agy, which handles audio and video natively. Claude only receives a short digest.

Raw arguments: `$ARGUMENTS`

Steps:
1. Split the arguments on the first `|`: the left side is the file or URL (plus flags), the right side an optional question. If no file or URL is given, ask for one and stop. A local file that does not exist: say so and stop.
2. Choose the transcript path `docs/agy/media/<YYYY-MM-DD>-<input basename>.md` under the current repository root, and create the directory with `mkdir -p`.
3. Run, keeping any `--tier` / `--background` flags the user gave:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task [flags] "Open <absolute path or URL>. Write a full transcript (audio/video, with [mm:ss] timestamps) or a full description (image) to <absolute transcript path>. Then reply with at most 15 lines: <the question, answered with timestamps, if one was given; otherwise a timestamped digest of the key points>. End with the transcript path."
```
4. Return agy's reply verbatim. Read the transcript file only if the user asks a follow-up that the digest does not answer.

If agy is not installed, tell the user to run `/agy:setup`.
