# agy-plugin-cc

A Claude Code plugin that integrates the Antigravity (`agy`) CLI—Google's successor to the Gemini CLI (v1.0.2)—into Claude Code. 

This plugin follows the same design patterns as `codex-plugin-cc` and `gemini-plugin-cc`.

## Prerequisites

The Antigravity CLI must be installed on your system and authenticated before using this plugin.

1. **Install agy CLI globally:**
   ```bash
   npm install -g @google/agy
   ```
   *(Alternatively, run via `npx @google/agy`)*

2. **Authenticate with your Google account:**
   ```bash
   agy auth
   ```

## Installation

Install the plugin from within Claude Code:

```text
/plugin install agy@agy-plugin-cc
/reload-plugins
```

## Commands & Usage

### `/agy:setup`
Verifies that the `agy` CLI is installed and authenticated.

**Example:**
```text
/agy:setup
```

### `/agy:agy [task]`
Runs a one-shot `agy` task directly.

**Example:**
```text
/agy:agy "List all active projects in the current GCP organization"
```

### `/agy:rescue [task]`
Delegates code/system investigation or issue remediation to `agy`.

**Example:**
```text
/agy:rescue "Fix the memory leak in the WebSocket connection handler"
```

#### Flags & Options
The `/agy:rescue` command supports the following operational flags:

- `--background`: Run the rescue execution in the background, allowing you to continue using Claude Code without blocking.
- `--continue`: Resume or continue a previous investigation or task from the last saved state.
- `--fresh`: Force a fresh run, starting the investigation from scratch and ignoring any cached or previous context.

**Example with flags:**
```text
/agy:rescue "Triage production database slow query logs" --background
/agy:rescue "Complete the API migration" --continue
/agy:rescue "Analyze code path for security vulnerabilities" --fresh
```
