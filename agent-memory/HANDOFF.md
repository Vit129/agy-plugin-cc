From: claude-code
To: (open)
Suggested skills: none — implementation done, only shipping decision left

Note:
Done, uncommitted, working tree has these 5 modified files:
- `plugins/agy/scripts/agy-companion.mjs` — added `ensureValidModel(cwd, agyOptions)`: validates `--model` against a live `agy models` call before `task`/`review`/`adversarial-review` run, throws with the current model list on typo/unknown name. Added `--dry-run` flag to the same three commands: prints resolved options + live model list (selected one marked `(selected)`), exits 0, no agy call made. Helpers added: `ensureValidModel`, `buildDryRunReport`, `renderDryRunReport` (reuses existing `runAgyModels`/`parseModelLines`/`describeAgyRunOptions`).
- `plugins/agy/skills/agy-cli-runtime/SKILL.md` — documents both behaviors under "Extended agy CLI Passthrough" (symlinked from `skills/agy-cli-runtime/SKILL.md`, don't edit that copy separately).
- `plugins/agy/commands/agy.md`, `review.md`, `adversarial-review.md` — `argument-hint` updated with `--dry-run`; review/adversarial-review also get an execution-mode rule so `--dry-run` skips the wait/background `AskUserQuestion` prompt.

Verified: `node --check` passes; 9 manual smoke-test cases against the real local `agy` binary all passed (bogus model rejected on task/review/adversarial-review, valid model accepted + marked selected, `--json` output parses, missing-prompt and `--project`+`--new-project` mutex errors still fire under `--dry-run`, omitting `--model` doesn't force a fake selection). No automated test file — this script's logic is thin wrapping around real CLI/process calls, so smoke-test-against-real-binary was judged the right-sized check (see ponytail rule in project CLAUDE.md).

Left to do: nothing functional. Only decision pending is whether to `git commit` (not done — repo convention is never commit without explicit user go-ahead) and whether to push/open a PR.
