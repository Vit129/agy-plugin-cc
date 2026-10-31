# Graph Report - delivery-workflow-completion  (2026-10-31)

## Corpus Check
- 75 files · ~31,284 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 451 nodes · 846 edges · 58 communities (48 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bcf85513`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## God Nodes (most connected - your core abstractions)
1. `handleTask()` - 21 edges
2. `handleReviewCommand()` - 19 edges
3. `resolveWorkspaceRoot()` - 17 edges
4. `parseCommandInput()` - 15 edges
5. `resolveCommandCwd()` - 14 edges
6. `main()` - 14 edges
7. `handleCancel()` - 13 edges
8. `outputCommandResult()` - 12 edges
9. `saveState()` - 12 edges
10. `What You Must Do When Invoked` - 12 edges

## Cross-Cutting Nodes (span the most distinct areas of the codebase)
A high-degree node isn't always architecturally central - a widely-used
utility/config file can rack up more edges than a real coupler while only
ever touching one area. This ranks by how many DIFFERENT communities a
node's neighbors span, not by raw edge count.
1. `handleCancel()` - bridges 4 areas (13 edges)
2. `executeReviewRun()` - bridges 4 areas (10 edges)
3. `handleTaskWorker()` - bridges 4 areas (10 edges)
4. `handleReviewCommand()` - bridges 3 areas (19 edges)
5. `resolveWorkspaceRoot()` - bridges 3 areas (17 edges)
6. `getAgyAvailability()` - bridges 3 areas (10 edges)
7. `handleSetup()` - bridges 3 areas (9 edges)
8. `executeTaskRun()` - bridges 3 areas (9 edges)
9. `getConfig()` - bridges 3 areas (8 edges)
10. `handleTask()` - bridges 2 areas (21 edges)

## Surprising Connections (you probably didn't know these)
- `resolveCommandWorkspace()` --calls--> `resolveWorkspaceRoot()`  [EXTRACTED]
  plugins/agy/scripts/agy-companion.mjs → plugins/agy/scripts/lib/workspace.mjs
- `buildSetupReport()` --calls--> `getConfig()`  [EXTRACTED]
  plugins/agy/scripts/agy-companion.mjs → plugins/agy/scripts/lib/state.mjs
- `buildSetupReport()` --calls--> `resolveWorkspaceRoot()`  [EXTRACTED]
  plugins/agy/scripts/agy-companion.mjs → plugins/agy/scripts/lib/workspace.mjs
- `handleSetup()` --calls--> `renderSetupReport()`  [EXTRACTED]
  plugins/agy/scripts/agy-companion.mjs → plugins/agy/scripts/lib/render.mjs
- `handleSetup()` --calls--> `setConfig()`  [EXTRACTED]
  plugins/agy/scripts/agy-companion.mjs → plugins/agy/scripts/lib/state.mjs

## Import Cycles
- None detected.

## Communities (58 total, 10 thin omitted)

### Community 0 - "agy-companion.mjs"
Cohesion: 0.08
Nodes (61): buildAgyRunOptions(), buildDoctorReport(), buildDryRunReport(), buildHostDoctor(), buildQuotaLines(), buildReviewPrompt(), buildStopGatePrompt(), buildTaskJob() (+53 more)

### Community 1 - "git-update-check.mjs"
Cohesion: 0.15
Nodes (23): executeReviewRun(), getCodexBarAvailability(), detectDefaultBranch(), ensureGitRepository(), getCurrentBranch(), git(), gitChecked(), isWorkingTreeDirty() (+15 more)

### Community 2 - "agy-plugin-cc"
Cohesion: 0.05
Nodes (37): [1.0.0] - 2026-05-27, [1.1.0] - 2026-05-28, [1.4.0] - 2026-07-22, [1.5.0] - 2026-08-23, [1.5.1] - 2026-09-15, Added, Added, Added (+29 more)

### Community 3 - "job-control.mjs"
Cohesion: 0.15
Nodes (31): buildSingleJobSnapshot(), buildStatusSnapshot(), enrichJob(), filterJobsForCurrentSession(), formatElapsedDuration(), getCurrentSessionId(), getJobTypeLabel(), inferLegacyJobPhase() (+23 more)

### Community 4 - "state.mjs"
Cohesion: 0.11
Nodes (43): createTrackedProgress(), enqueueBackgroundTask(), handleCancel(), handleTaskWorker(), spawnDetachedTaskWorker(), formatUpdateNotice(), readStoredJob(), defaultState() (+35 more)

### Community 5 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 6 - "agy.mjs"
Cohesion: 0.21
Nodes (16): buildSetupReport(), ensureAgyAvailable(), executeTaskRun(), firstMeaningfulLine(), agyCommand(), buildAgyArgs(), getAgyAuthStatus(), getAgyAvailability() (+8 more)

### Community 7 - "agy-companion.mjs"
Cohesion: 0.24
Nodes (18): buildAgyArgs(), ensureStateDir(), findExecutable(), getAgyPath(), getAgyVersion(), handleSetup(), handleTask(), handleTaskResumeCandidate() (+10 more)

### Community 8 - "package.json"
Cohesion: 0.11
Nodes (17): description, engines, node, files, license, name, private, scripts (+9 more)

### Community 9 - "lib.test.mjs"
Cohesion: 0.15
Nodes (11): config, generateJobId: carries the prefix and is unique, parseArgs: boolean --flag=false, unknown flags stay positional, missing value throws, parseArgs: -- passes everything through as positionals, parseArgs: value, boolean, alias, inline and repeatable options, splitRawArgumentString: quotes, escapes and whitespace, state: a corrupt state file falls back to defaults, state: empty workspace yields the default state (+3 more)

### Community 10 - "agy-plugin-cc — Agent Instructions"
Cohesion: 0.18
Nodes (10): Agent Memory, agy-plugin-cc — Agent Instructions, Global-First Rule, graphify, Project Context (auto-loaded every session), Project Summary, Session Start, Skill Routing (domain-based, not keyword-based) (+2 more)

### Community 11 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 12 - "Gemini 3 Prompting for agy"
Cohesion: 0.29
Nodes (6): Do, Don't, Effective prompt structure, Gemini 3 Prompting for agy, Prompt antipatterns, Research / Audit / Comparison Tasks (exception to "scope narrowly")

### Community 13 - "agy-plugin-cc — System Architecture"
Cohesion: 0.33
Nodes (5): agy-plugin-cc — System Architecture, Constraints & Objectives, Structure deviations, Subsystems, Verification Invariants

### Community 14 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 15 - "Security Policy"
Cohesion: 0.33
Nodes (5): Reporting a Vulnerability, Response Expectations, Scope Notes, Security Policy, Supported Versions

### Community 16 - "Gemini 3 Prompting for agy"
Cohesion: 0.33
Nodes (5): Do, Don't, Effective prompt structure, Gemini 3 Prompting for agy, Prompt antipatterns

### Community 17 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 18 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 19 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 52 - "check.yml"
Cohesion: 0.22
Nodes (8): jobs, check, name, on, pull_request, push, permissions, contents

### Community 53 - "Design"
Cohesion: 0.50
Nodes (3): Design, Interaction model, Principles

### Community 54 - "Product"
Cohesion: 0.50
Nodes (3): Delivery, Product, Users and interface

### Community 55 - "render.mjs"
Cohesion: 0.31
Nodes (9): appendActiveJobsTable(), escapeMarkdownCell(), formatJobLine(), pushJobDetails(), renderCancelReport(), renderJobStatusReport(), renderReviewResult(), renderSetupReport() (+1 more)

### Community 56 - "check-version.mjs"
Cohesion: 0.33
Nodes (3): changelog, root, updater

### Community 57 - "set-release-version.mjs"
Cohesion: 0.47
Nodes (4): scriptPath, setVersion(), updateReleaseVersion(), release metadata updates semver and build surfaces together

## Knowledge Gaps
- **154 isolated node(s):** `name`, `pull_request`, `push`, `contents`, `check` (+149 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `resolveWorkspaceRoot()` connect `job-control.mjs` to `agy-companion.mjs`, `state.mjs`, `agy.mjs`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `parseArgs()` connect `agy-companion.mjs` to `lib.test.mjs`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `splitRawArgumentString()` connect `agy-companion.mjs` to `lib.test.mjs`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `name`, `pull_request`, `push` to the rest of the system?**
  _154 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `agy-companion.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08461538461538462 - nodes in this community are weakly interconnected._
- **Should `agy-plugin-cc` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._
- **Should `job-control.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.14962121212121213 - nodes in this community are weakly interconnected._