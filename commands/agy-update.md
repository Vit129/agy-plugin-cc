---
description: Check for a newer git-clone version of this plugin and pull it after confirmation
allowed-tools: Bash, AskUserQuestion
---

This plugin is installed via `git clone`, not npm. Check `version.json` on the `main` branch of `Vit129/agy-plugin-cc` on GitHub against the `CURRENT_VERSION` constant in `plugins/agy/scripts/lib/git-update-check.mjs`, and pull only with explicit confirmation.

Steps:

1. Find the git checkout root and confirm it is clean:

```bash
cd "${CLAUDE_PLUGIN_ROOT}/../.." 2>/dev/null || true
git rev-parse --show-toplevel
git status --short --untracked-files=normal
```

If the working tree is not clean (the status command prints anything), stop and tell the user there are uncommitted changes — they must commit/stash and re-run this command themselves. Do not offer to pull.

2. Fetch the remote version file:

```bash
curl -fsSL --max-time 3 https://raw.githubusercontent.com/Vit129/agy-plugin-cc/main/version.json
```

If this fails (offline/blocked/timeout), tell the user the version check failed and why, and stop.

3. Read `CURRENT_VERSION` from `plugins/agy/scripts/lib/git-update-check.mjs` and compare to the fetched `version` field.

- If the remote version is not greater than `CURRENT_VERSION`, tell the user they're already up to date and stop.
- If the remote version is greater, use `AskUserQuestion` to ask the user whether to pull now, showing the remote `summary` and `updated` date. Options: "Pull now" and "Not now".

4. If the user chooses "Pull now", run `git pull origin main` in the checkout root and report the result verbatim (success, or the conflict/error output so the user can resolve it themselves).

5. If the user chooses "Not now" (or the question is answered in a non-interactive context with no reply), do not pull. Instead remember the dismissal so the session-start hook stops repeating this notice until a newer version ships:

```bash
mkdir -p "$HOME/.config/agy-plugin-cc"
printf '%s\n' "<remote version number>" > "$HOME/.config/agy-plugin-cc/update-dismissed"
```
