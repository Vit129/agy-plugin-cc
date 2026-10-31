# agy-plugin-cc

> Unofficial community project. Not affiliated with, sponsored or endorsed by Google. "Antigravity" and "Google" are trademarks of Google LLC.

A Claude Code plugin that integrates **Google's Antigravity (agy) CLI** and **Antigravity IDE** developer tools into Claude Code.

This companion extension follows the same design patterns as [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc), providing full job tracking, background execution, code review, and a session-aware stop-time review gate for **Google Antigravity** workflows.
(For OpenAI Codex CLI, see the counterpart: [`agy-plugin-codex`](https://github.com/Vit129/agy-plugin-codex)).

## Prerequisites

The Antigravity CLI must be installed and authenticated before using this plugin.

1. **Install agy CLI:**

   **Mac/Linux:**
   ```bash
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   ```

   **Windows PowerShell:**
   ```powershell
   irm https://antigravity.google/cli/install.ps1 | iex
   ```

   **Windows CMD:**
   ```cmd
   curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd
   ```

2. **Authenticate with your Google account:**
   ```bash
   agy auth
   ```

## Installation

In Claude Code:

```text
/plugin marketplace add Vit129/agy-plugin-cc
/plugin install agy@agy-plugin-cc
/reload-plugins
```

Updates: open `/plugin` → Marketplaces → `agy-plugin-cc` and turn on auto-update; new versions arrive when a session starts.
Manual update: `/plugin marketplace update agy-plugin-cc`, then `/reload-plugins`.

## Commands & Usage

### `/agy:setup`

Check whether `agy` is installed and optionally toggle the stop-time review gate.

```text
/agy:setup
/agy:setup --enable-review-gate
/agy:setup --disable-review-gate
```

---

### `/agy:agy [prompt]`

Run a one-shot `agy` task directly.

```text
/agy:agy "Explain how the authentication flow works in this repo"
/agy:agy --resume "Keep going"
/agy:agy --sandbox "What files changed in the last commit?"
```

---

### `/agy:rescue [task]`

Delegate investigation, fixes, or follow-up work to `agy`. Checks for a resumable previous session before starting.

```text
/agy:rescue "Fix the memory leak in the WebSocket connection handler"
/agy:rescue "Triage the slow query logs" --background
/agy:rescue "Keep going" --resume
/agy:rescue "Start over from scratch" --fresh
/agy:rescue "Read-only audit of the auth module" --sandbox
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--background` | Run in the background; check progress with `/agy:status` |
| `--resume` | Continue the most recent agy conversation |
| `--fresh` | Force a new conversation, ignoring previous context |
| `--sandbox` | Run agy with terminal restrictions (read-only mode) |

---

### `/agy:review`

Run a code review — agy examines the current git changes and reports findings.

```text
/agy:review
/agy:review --wait
/agy:review --background
/agy:review --scope branch
/agy:review --base main
```

**Scopes:** `auto` (default), `working-tree`, `branch`

---

### `/agy:adversarial-review [focus]`

Run an adversarial review — agy tries to find the strongest reasons the change should *not* ship.

```text
/agy:adversarial-review
/agy:adversarial-review "focus on the auth boundary"
/agy:adversarial-review --base main --wait
```

---

### `/agy:status [job-id]`

Show active and recent agy jobs for this repository.

```text
/agy:status
/agy:status task-abc123
/agy:status task-abc123 --wait
/agy:status --all
```

---

### `/agy:result [job-id]`

Show the stored output for a finished job.

```text
/agy:result
/agy:result task-abc123
```

---

### `/agy:cancel [job-id]`

Cancel an active background job.

```text
/agy:cancel
/agy:cancel task-abc123
```

---

## Stop-Time Review Gate

When enabled, `agy` runs a review before each session ends and blocks if it finds issues.

```text
/agy:setup --enable-review-gate   # turn on
/agy:setup --disable-review-gate  # turn off
```

When a session ends with the gate enabled:
- `agy` reviews the previous Claude response
- If it responds `ALLOW:` — the session closes normally
- If it responds `BLOCK:` — the session is blocked with the reason

---

## Architecture

```
plugins/agy/
├── .claude-plugin/plugin.json       # plugin metadata (v1.1.0)
├── agents/agy-rescue.md             # agy:agy-rescue subagent
├── commands/                        # slash commands
│   ├── agy.md                       # /agy:agy
│   ├── rescue.md                    # /agy:rescue
│   ├── setup.md                     # /agy:setup
│   ├── review.md                    # /agy:review
│   ├── adversarial-review.md        # /agy:adversarial-review
│   ├── status.md                    # /agy:status
│   ├── result.md                    # /agy:result
│   └── cancel.md                    # /agy:cancel
├── hooks/hooks.json                 # SessionStart / SessionEnd / Stop
├── prompts/                         # prompt templates
│   ├── review.md
│   ├── adversarial-review.md
│   └── stop-review-gate.md
├── scripts/
│   ├── agy-companion.mjs            # main runtime (9 subcommands)
│   ├── session-lifecycle-hook.mjs   # SessionStart / SessionEnd handler
│   ├── stop-review-gate-hook.mjs    # Stop hook handler
│   └── lib/                         # modular library
│       ├── agy.mjs                  # agy CLI wrapper
│       ├── args.mjs                 # argument parsing
│       ├── fs.mjs                   # file utilities
│       ├── git.mjs                  # git review target resolution
│       ├── job-control.mjs          # job queries & enrichment
│       ├── process.mjs              # process utilities
│       ├── render.mjs               # output rendering
│       ├── state.mjs                # persistent job state
│       ├── tracked-jobs.mjs         # job lifecycle tracking
│       └── workspace.mjs            # git root resolution
└── skills/
    ├── agy-cli-runtime/SKILL.md     # internal runtime contract
    ├── agy-result-handling/SKILL.md # result presentation guidance
    └── gemini-3-prompting/SKILL.md  # prompt composition guidance
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Development and delivery

This is a Claude Code plugin package, not a local web application. `npm start` / `make start` runs the isolated preview gate: syntax checks, unit tests, and `npm pack --dry-run`. There is no local GUI dev server; review runtime behavior by installing into a separate test Claude Code profile. `npm run release` repeats the build gate before invoking the release script. CI runs tests, syntax checks, and the package dry run on pull requests and pushes to `main`.

## Contributors

Developed and maintained by **Vit129** and **Claude** (Anthropic).

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Parts of the design
and scripts are derived from [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (Copyright 2026 OpenAI,
Apache-2.0), credited in `NOTICE`. Releases up to
v1.5.1 were published under MIT and remain available under those terms (`LICENSE-MIT`). Keep
`LICENSE` and `NOTICE` when you redistribute, and mark the files you change.
