# agy-plugin-cc

> Unofficial community project. Not affiliated with, sponsored or endorsed by Google. "Antigravity" and "Google" are trademarks of Google LLC.

A Claude Code plugin that integrates **Google's Antigravity (agy) CLI** and **Antigravity IDE** developer tools into Claude Code.

This companion extension follows the same design patterns as [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc), providing full job tracking, background execution, code review, and a session-aware stop-time review gate for **Google Antigravity** workflows.
The same plugin tree also installs into OpenAI Codex CLI (see [Codex](#codex)); it replaces the separate `agy-plugin-codex` repository, which is no longer developed.

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
/agy:agy "What files changed in the last commit?"
```

---

### `/agy:rescue [task]`

Delegate investigation, fixes, or follow-up work to `agy`. Checks for a resumable previous session before starting.

```text
/agy:rescue "Fix the memory leak in the WebSocket connection handler"
/agy:rescue "Triage the slow query logs" --background
/agy:rescue "Keep going" --resume
/agy:rescue "Start over from scratch" --fresh
/agy:rescue "Read-only audit of the auth module"
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--background` | Run in the background; check progress with `/agy:status` |
| `--resume` | Continue the most recent agy conversation |
| `--fresh` | Force a new conversation, ignoring previous context |
| `--tier low\|medium\|high` | Pick a Gemini 3.8 Flash level instead of naming a model (`--model` and `--tier` are exclusive; also on `/agy:agy` and the reviews) |

Replies longer than 12,000 characters are cut; the last line names the file holding the full output.

---

### `/agy:review`

Run a code review — agy examines the current git changes and reports findings.

```text
/agy:review
/agy:review --wait
/agy:review --background
/agy:review --scope branch
/agy:review --base main
/agy:review --deep
```

**Scopes:** `auto` (default), `working-tree`, `branch`

`--deep` (also on `/agy:adversarial-review`) tells agy to read the callers, surrounding code and tests of each changed symbol, not just the diff.

---

### `/agy:adversarial-review [focus]`

Run an adversarial review — agy tries to find the strongest reasons the change should *not* ship.

```text
/agy:adversarial-review
/agy:adversarial-review "focus on the auth boundary"
/agy:adversarial-review --base main --wait
```

---

### `/agy:doc-to-md <file> [focus]`

Convert a PDF, Word document or image to Markdown with agy's multimodal model. The result is written to `docs/agy/converted/`; only a short summary comes back.

---

### `/agy:handoff <requirement>`

Hand a whole, test-covered task to agy. The companion refuses `main`/`master` and a dirty tree, runs agy, runs the test command itself (`--verify`, or detected from `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`), sends up to `--fixups` (default 1) follow-ups on the same conversation quoting the failure, and checks that the `--tests` files were not changed.

```text
/agy:handoff --tests tests/cart.test.mjs "Add a discount code field to the cart..."
/agy:handoff --verify "make check" --fixups 2 --background "..."
```

Result: `PASS` (exit 0), `FAIL` (4), `AGY FAILED` (5), `TEST FILES MODIFIED` (6). Worth it for changes of roughly 200+ lines; small edits cost more this way.

---

### `/agy:transfer [notes]`

Move this session's work to an interactive agy session: Claude writes `.tmp/agy-transfer-<timestamp>.md` (goal, done so far, next steps, constraints, git state) and prints an `agy -i "..."` command to continue there. Unlike `--resume`, which continues agy's own conversation under Claude's control, this hands Claude's context to you in agy.

---

### Usage tracking

Every `task`, review and hand-off runs agy with `--output-format json` and records its token usage (input, output + thinking, cache read), model and agy's own duration on the job. `/agy:status` shows it per job, and each finished job appends one line to `usage.jsonl` in the workspace state dir (`$CLAUDE_PLUGIN_DATA/state/<slug>-<hash>/`). Hand-offs record the sum of all their agy calls. An agy that does not print the JSON envelope falls back to plain text with no usage. The stop-review gate is not tracked.

---

### Web and image commands

agy does the browsing or generation and writes the result under `docs/agy/`; Claude gets a short reply and checks the result.

| Command | What it does | Claude's check |
|---|---|---|
| `/agy:image <description>` | Generates an image with agy's built-in image tool → `docs/agy/images/` | opens the image and says whether it matches |
| `/agy:research <question>` | One round of web research, every claim with source URLs → `docs/agy/research/` | fetches the cited pages for up to 3 key claims; unsupported claims are marked unverified. Use the `deep-research` skill for broad multi-angle reports |
| `/agy:scrape <url> [what]` | Extracts a table (or JSON with `--json`) from one page → `docs/agy/scrapes/` | checks row count and columns |
| `/agy:design-review <url> [focus]` | agy captures 1440px and 390px screenshots → `docs/agy/design-reviews/` | reviews the screenshots itself; agy's own page description is not trusted |

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

## Codex

`plugins/agy` also carries a Codex manifest (`.codex-plugin/plugin.json`), Codex hooks (`hooks.json`) and Codex skills (`codex/skills/`), and the repo root has a Codex marketplace (`.agents/plugins/marketplace.json`, name `agy-plugin-cc`). In Codex, use `$agy setup`, `$agy task ...`, `$agy review`, `$agy handoff ...`, `$agy status`, `$agy update`. The runtime scripts are shared with Claude Code; `/agy:doctor` reports which host it runs in. The Codex side has not been re-tested since the merge.

## Development and delivery

This is a Claude Code plugin package, not a local web application. `npm start` / `make start` runs the isolated package preview gate: syntax checks, unit tests, and `npm pack --dry-run`. There is no local GUI dev server; review runtime behavior by installing into a separate test Claude Code profile. The release script updates every semver/build surface, commits the candidate, and runs `npm run release:check` on that exact commit before it tags or pushes. CI runs the same gate on pull requests and pushes to `main`.

## Contributors

Developed and maintained by **Vit129** and **Claude** (Anthropic).

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Parts of the design
and scripts are derived from [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (Copyright 2026 OpenAI,
Apache-2.0), credited in `NOTICE`. Releases up to
v1.5.1 were published under MIT and remain available under those terms (`LICENSE-MIT`). Keep
`LICENSE` and `NOTICE` when you redistribute, and mark the files you change.

Delegated agy runs use `--dangerously-skip-permissions` without agy terminal sandboxing. Parent environment restrictions still apply. For read-only reviews, state that constraint in the prompt. The `--sandbox` option is rejected.
