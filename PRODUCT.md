# Product

One plugin that packages the Antigravity `agy` companion for both Claude Code and OpenAI Codex CLI. It provides manifests for each host, commands and skills, hooks, and a local companion that drives the `agy` CLI.

## Users and interface

The users are developers running Claude Code or Codex with Antigravity installed and authenticated. The interface is the plugin's commands (`/agy:*`, `$agy`), skills, hooks, and status messages. Agent Usage is a local web dashboard that can run alongside both CLIs.

## Capabilities

- Delegation: one-shot tasks, rescue, background jobs, resume, `--tier` model levels, test-gated hand-offs, session transfer to agy.
- Quota Auto-Route: divert critical delegations to a provider with fresh headroom and record the decision.
- Review: review and adversarial review of the current diff, `--deep`, and an optional stop-time review gate.
- Web and media through agy: image generation, cited web research, page scraping, screenshot-based design review, document-to-Markdown.
- Measurement uses per-job token counts and a `usage.jsonl` ledger. Agent Usage displays quota and model usage by account and reminds users before Codex reset credits expire. The dashboard detects local sign-ins and can open Terminal to sign in to additional accounts. The macOS menu bar shows active providers and their remaining quota alongside routes and credit expiry.

Out of scope by decision: audio/video transcription (the `watch` plugin covers it), multi-round research engines, browser recording, cloud-specific debugging.

## Delivery

`npm test` runs the Node test suite, `npm run check` validates JavaScript syntax and that every manifest carries the package version, and `npm run build` combines those checks with `npm pack --dry-run`. `make start` runs the safe preview gate. Releases go through a release pull request, then a tag and GitHub release. Runtime review requires a separate test Claude Code profile.
