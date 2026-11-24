---
name: agy
description: Use when the user invokes $agy, asks to run Antigravity, agy, Gemini CLI successor, agy setup, delegate work to agy, continue an agy task, or get a second coding/debugging pass through the local agy CLI.
---

# Agy for Codex

This skill is the Codex-native `$agy` command surface. It delegates bounded work to the local Antigravity (`agy`) CLI through the plugin helper script.

## Command Surface

Supported portable forms:

```text
$agy setup [--enable-review-gate|--disable-review-gate]
$agy task [--background] [--continue|--resume|--fresh] [--model <name>|--tier <low|medium|high>] [--effort <low|medium|high>] <prompt>
$agy rescue [--background|--wait] [--resume|--fresh] [--model <name>|--tier <low|medium|high>] [--effort <low|medium|high>] <prompt>
$agy review [--background|--wait] [--scope auto|working-tree|branch] [--base <ref>] [--model <name>|--tier <low|medium|high>] [--effort <low|medium|high>]
$agy adversarial-review [--background|--wait] [--scope auto|working-tree|branch] [--base <ref>] [--model <name>|--tier <low|medium|high>] [--effort <low|medium|high>] [focus]
$agy handoff [--background] [--verify <cmd>] [--tests <a,b>] [--fixups <n>] [--tier <low|medium|high>] <requirement>
$agy status [job-id] [--wait] [--all]
$agy result [job-id]
$agy cancel [job-id]
$agy update [--pull|--dismiss]
```

Slash-style aliases such as `/agy setup` may work in some Codex builds, but `$agy` is the stable form.

## Helper Resolution

The helper lives at `../../../scripts/agy-companion.mjs` relative to this `SKILL.md`.

When invoking it, resolve the absolute plugin root from the skill path and run:

```bash
node "<plugin-root>/scripts/agy-companion.mjs" <subcommand>
```

## Setup

If the user asks for setup or readiness checks, or invokes `$agy setup`, run:

```bash
node "<plugin-root>/scripts/agy-companion.mjs" setup
```

Print the result. If `agy` is missing, tell the user to install and authenticate it:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy auth
```

## One-Shot Delegation

For `$agy task <prompt>` or a direct agy prompt, run:

```bash
node "<plugin-root>/scripts/agy-companion.mjs" task "<user task>"
```

Return agy's output verbatim unless the user asked Codex to summarize or integrate it.

## Background and Resume Workflow

Use this for `$agy task ...`, when Codex is stuck, or when a second independent implementation/debugging pass is useful.

Supported flags:

- `--background`: start agy and return the log path immediately
- `--continue` / `--resume`: resume the most recent agy conversation
- `--fresh`: start without resume
Before a follow-up task with neither `--continue` nor `--fresh`, check:

```bash
node "<plugin-root>/scripts/agy-companion.mjs" task-resume-candidate --json
```

If a candidate exists and the user's request is clearly a follow-up, use `--continue`. If it is a new task, use `--fresh`. If unclear, make the conservative choice from the wording and state it briefly before running.

## Operating Rules

- Keep the delegated prompt scoped and concrete.
- Preserve the user's task text apart from stripping routing flags.
- Do not pass `--background`, `--fresh`, or `--continue` inside the natural-language prompt.
- Return raw agy output for pure delegation requests.
- If using agy output to make local code edits, inspect and verify the final code yourself before responding.

## Extended agy CLI Passthrough

The companion also supports local agy CLI features verified against `agy 1.0.10`:

- `models [--json]` lists available agy models.
- `doctor [--json]` verifies plugin manifest, host wiring, agy binary/auth, and model listing.
- `task` accepts `--model <name>`, `--effort <low|medium|high>`, `--conversation <id>`, repeatable `--add-dir <path>`, `--log-file <path>`, and `--print-timeout <duration>`.
- `review` and `adversarial-review` accept `--model <name>`, `--effort <low|medium|high>`, repeatable `--add-dir <path>`, `--log-file <path>`, and `--print-timeout <duration>`.

## Git-Clone Update Check

At session start a hook compares the repo's `version.json` (on GitHub `main`) against the `CURRENT_VERSION` baked into `plugins/agy/scripts/lib/git-update-check.mjs`. If a newer version exists, the hook prints a one-line notice and never pulls on its own.

If the user invokes `$agy update` (or you see that session-start notice) and the reported working tree is clean:

1. Ask the user whether to pull now.
2. If yes, run `$agy update --pull` — it re-checks the tree is clean, then runs `git pull origin main` and reports success or the conflict/error verbatim.
3. If no (or there is no one to ask, e.g. a non-interactive run), run `$agy update --dismiss` so the notice stays quiet until a newer version ships.

If the tree is dirty, `$agy update` reports that directly — do not offer to pull; tell the user to commit/stash and pull manually later.

Treat these as routing flags. Strip them from natural-language prompt text before invoking the helper.
