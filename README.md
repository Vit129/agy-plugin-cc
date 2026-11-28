# agy-plugin-cc

> Unofficial community project. Not affiliated with, sponsored or endorsed by Google. "Antigravity" and "Google" are trademarks of Google LLC.

A Claude Code plugin that integrates **Google's Antigravity (agy) CLI** and **Antigravity IDE** developer tools into Claude Code.

This companion extension provides full job tracking, background execution, code review, and a session-aware stop-time review gate for **Google Antigravity** workflows.
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

### Interactive installer

From a local clone, run the interactive multi-select installer to set up or update **Claude Code**, **Codex**, and **agy** (`cc-for-agy`) in one pass:

```bash
npm run setup
```

Detected CLIs on `PATH` are pre-selected. Use arrow keys or `j`/`k` to move, `space` to toggle, `a` to toggle all, `enter` to confirm, and `q` or `Ctrl-C` to abort.

For non-interactive or CI usage, pass target flags directly:

```bash
node scripts/install.mjs --all --dry-run
node scripts/install.mjs --claude --codex --agy
```

### Claude Code

Install from GitHub in your terminal:

```bash
claude plugin marketplace add Vit129/agy-plugin-cc
claude plugin install agy@agy-plugin-cc
```

Start Claude Code, or run `/reload-plugins` in an open session to load the plugin.

To update manually, refresh the marketplace and update the installed plugin:

```bash
claude plugin marketplace update agy-plugin-cc
claude plugin update agy@agy-plugin-cc
```

Restart Claude Code to apply the update. You can also enable marketplace auto-update under `/plugin` → Marketplaces → `agy-plugin-cc`.

To uninstall the plugin and remove its marketplace:

```bash
claude plugin uninstall agy@agy-plugin-cc
claude plugin marketplace remove agy-plugin-cc
```

Plugin install and uninstall default to `--scope user`. If you installed at project or local scope, pass `--scope project` or `--scope local` to the uninstall command. The update command detects the installation scope by default and accepts the same options to target a specific scope. Marketplace removal without `--scope` removes its declaration from every scope.

If you already use `agy@agy-plugin-cc` in Claude Code, follow the update steps above to move to the shared release. If you also installed the separate `agy-plugin-codex` in Codex, follow the [Codex migration steps](#migrate-from-agy-plugin-codex) in that host.

### agy plugin (cc-for-agy)

Install the Antigravity-native plugin (`plugins/cc-for-agy`) to call Claude Code CLI (`ask_claude` MCP tool, `review`, `adversarial-review`, `handoff`, `transfer`, and shared quota routing) from `agy`.

Install from a local clone:

```bash
agy plugin install <repo>/plugins/cc-for-agy
```

Or install from the published marketplace manifest (backed by the GitHub release zip):

```bash
agy plugin install cc-for-agy@https://raw.githubusercontent.com/Vit129/agy-plugin-cc/main/.agy-plugin/marketplace.json
```

Validate the local plugin directory at any time with `agy plugin validate --strict plugins/cc-for-agy`.

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

### Quota Auto-Route

Claude Code delegations to agy use `--route auto` by default. When either agy window is critical and both Claude windows are above Low, task, rescue, review, and handoff return a reason to run the work in Claude. Use `--route off` on the delegation to override. The companion recommends agy when Claude is critical and agy has headroom.

Agent Usage shows the current decision for Claude→agy and agy→Claude in **Plan usage**. Both directions use the shared quota cache and Agent Usage thresholds. Missing, stale, or reset windows keep the requested target. Diversions are written to the workspace's `usage.jsonl`.

### Usage tracking

Every `task`, review and hand-off runs agy with `--output-format stream-json`, reports each tool agy starts as job progress, and records its token usage (input, output + thinking, cache read), model and agy's own duration on the job. `/agy:status` shows it per job, and each finished job appends one line to `usage.jsonl` in the workspace state dir (`$CLAUDE_PLUGIN_DATA/state/<slug>-<hash>/`). Hand-offs record the sum of all their agy calls. A run cut off before its result still records the reply and tokens seen so far; an agy that prints no JSON falls back to plain text with no usage. The stop-review gate is not tracked.

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

### Maintenance commands

| Command | What it does |
|---|---|
| `/agy:doctor` | Checks the plugin manifest, host (Claude Code or Codex), agy binary and models |
| `/agy:models`, `/agy:agents`, `/agy:changelog` | Pass through `agy models`, `agy agents`, `agy changelog` |
| `/agy:update [--pull\|--dismiss]` | For git-clone installs: shows whether a newer version is on GitHub and pulls it after you confirm |

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

## Codex

### Install

In your terminal, add the GitHub marketplace and install the plugin:

```bash
codex plugin marketplace add Vit129/agy-plugin-cc
codex plugin add agy@agy-plugin-cc
```

Start a new Codex session to load the plugin. Try `$agy task --tier low "Reply with exactly: hello ok"`, then `$agy status` to see the result and token usage.

### Update

Refresh the Git marketplace and its installed plugins with Codex CLI 0.171.0:

```bash
codex plugin marketplace upgrade agy-plugin-cc
```

Start a new Codex session to load the updated plugin.

### Uninstall

Remove the plugin, then remove the marketplace if you no longer use it:

```bash
codex plugin remove agy@agy-plugin-cc
codex plugin marketplace remove agy-plugin-cc
```

Start a new Codex session to apply the change.

### Migrate from `agy-plugin-codex`

Remove the old plugin and marketplace, then install from the GitHub marketplace. Remove the old marketplace entry even if it points to a local checkout you have already deleted.

```bash
codex plugin remove agy@agy-plugin-codex
codex plugin marketplace remove agy-plugin-codex
codex plugin marketplace add Vit129/agy-plugin-cc
codex plugin add agy@agy-plugin-cc
```

If `~/.codex/config.toml` still contains `[[skills.config]]` entries whose `path` points to missing skills under `~/.codex/plugins/cache/agy-plugin-codex/`, remove those entries. You can also remove the old cache directory if it is empty. Start a new Codex session and run `$agy status`.

Skills are split by host so one edit reaches both: `plugins/agy/skills/` holds shared skills (loaded by Claude Code by default and listed in the Codex manifest), `plugins/agy/cc/skills/` holds Claude-only skills (`skills` in `.claude-plugin/plugin.json`, which adds to the default), and `plugins/agy/codex/skills/` holds Codex-only skills (`skills` in `.codex-plugin/plugin.json` lists `./skills/` and `./codex/skills/`, because a Codex `skills` list replaces the default).

`plugins/agy` also carries a Codex manifest (`.codex-plugin/plugin.json`), Codex hooks (`hooks.json`) and Codex skills (`codex/skills/`), and the repo root has a Codex marketplace (`.agents/plugins/marketplace.json`, name `agy-plugin-cc`). In Codex, use `$agy setup`, `$agy task ...`, `$agy review`, `$agy handoff ...`, `$agy status`, `$agy update`. The runtime scripts are shared with Claude Code. `tests/skills-layout.test.mjs` checks that each host resolves its skills.

## Development and delivery

`npm start` and `make start` run the package preview gate with syntax checks, unit tests, and `npm pack --dry-run`. Use a separate test Claude Code profile to verify the plugin lifecycle. Start the optional local quota dashboard with `npm run dashboard` or build its macOS menu bar companion with `npm run menubar:build`. The [Agent Usage instructions](apps/agent-usage/README.md) cover CLI accounts, Codex reset-credit reminders, and scheduled checks. The release script updates every semver/build surface, commits the candidate, and runs `npm run release:check` on that exact commit before it tags or pushes. Before publishing a release, run `npm run package:cc-for-agy` (`node scripts/package-cc-for-agy.mjs`) to sync shared libs, zip `plugins/cc-for-agy` to `dist/cc-for-agy-<version>.zip`, print its SHA-256, and update `.agy-plugin/marketplace.json` for the release asset URL (and attach the zip to the GitHub release). CI runs the same gate on pull requests and pushes to `main`.

## Architecture

```
plugins/agy/
├── .claude-plugin/plugin.json       # Claude Code manifest ("skills": "./cc/skills/")
├── .codex-plugin/plugin.json        # Codex manifest ("skills": ["./skills/", "./codex/skills/"])
├── agents/agy-rescue.md             # agy:agy-rescue subagent (Claude)
├── commands/                        # Claude slash commands, one .md each
│   ├── agy.md rescue.md             # /agy:agy, /agy:rescue
│   ├── review.md adversarial-review.md
│   ├── handoff.md transfer.md       # /agy:handoff, /agy:transfer
│   ├── image.md research.md scrape.md design-review.md doc-to-md.md
│   ├── status.md result.md cancel.md
│   └── setup.md doctor.md models.md agents.md changelog.md update.md
├── hooks/hooks.json                 # Claude hooks: SessionStart / SessionEnd / Stop
├── hooks.json                       # Codex hooks: SessionStart / Stop
├── prompts/                         # review, adversarial-review, handoff, stop-review-gate
├── scripts/
│   ├── agy-companion.mjs            # entry point: usage + subcommand switch
│   ├── session-lifecycle-hook.mjs   # SessionStart / SessionEnd handler
│   ├── stop-review-gate-hook.mjs    # Stop hook handler
│   ├── features/                    # one module per feature
│   │   ├── task.mjs review.mjs handoff.mjs jobs.mjs
│   │   ├── setup.mjs info.mjs update.mjs
│   │   └── shared.mjs               # CLI plumbing shared by features
│   └── lib/                         # logic and adapters, no CLI concerns
│       ├── agy.mjs                  # agy process, --tier, JSON envelope
│       ├── handoff.mjs usage.mjs    # hand-off loop, usage parsing
│       ├── state.mjs tracked-jobs.mjs job-control.mjs
│       ├── git.mjs git-update-check.mjs workspace.mjs
│       └── args.mjs fs.mjs process.mjs render.mjs codexbar.mjs
├── skills/                          # shared by both hosts: edit here once
│   ├── agy-companion-reference/     # subcommands and flags
│   └── gemini-3-prompting/          # prompt composition guidance
├── cc/skills/                       # Claude-only: agy-cli-runtime, agy-result-handling
└── codex/skills/                    # Codex-only: agy ($agy), agy-cli-runtime
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Contributors

Developed and maintained by **Vit129** and **Claude** (Anthropic).

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Releases up to
v1.5.1 were published under MIT and remain available under those terms (`LICENSE-MIT`). Keep
`LICENSE` and `NOTICE` when you redistribute, and mark the files you change.

Delegated agy runs use `--dangerously-skip-permissions` without agy terminal sandboxing. Parent environment restrictions still apply. For read-only reviews, state that constraint in the prompt. The `--sandbox` option is rejected.
