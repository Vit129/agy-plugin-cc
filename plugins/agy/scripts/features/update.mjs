import process from "node:process";
import { checkGitCloneUpdate, dismissUpdate } from "../lib/git-update-check.mjs";
import { runCommand } from "../lib/process.mjs";
import { outputCommandResult, parseCommandInput, resolveCommandCwd } from "./shared.mjs";

// Ported from agy-plugin-codex so both hosts share one update flow:
// Claude runs it as /agy:update, Codex as `$agy update`.
export function renderUpdateReport(report) {
  if (!report.checked) {
    return report.reason === "not-a-git-checkout"
      ? "Not a git checkout — skip.\n"
      : `Update check failed: ${report.reason}\n`;
  }
  if (!report.updateAvailable) {
    return `Up to date (v${report.currentVersion}).\n`;
  }
  if (report.dismissed) {
    return `Update v${report.remoteVersion} available but dismissed. Run the update command with --pull to pull it.\n`;
  }
  if (report.dirty) {
    return `Update available (v${report.currentVersion} -> v${report.remoteVersion}), but the working tree has uncommitted changes. Pull manually later.\n`;
  }
  return (
    `Update available (v${report.currentVersion} -> v${report.remoteVersion}, ${report.updated}): ${report.summary}\n` +
    "Ask the user to confirm, then run the update command with --pull to pull, or --dismiss to silence this until the next version.\n"
  );
}

export async function handleUpdate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "pull", "dismiss"]
  });
  const cwd = resolveCommandCwd(options);
  const report = await checkGitCloneUpdate(cwd);

  if (options.dismiss) {
    if (report.updateAvailable) {
      dismissUpdate(report.remoteVersion);
    }
    outputCommandResult(report, "Update dismissed until a newer version ships.\n", options.json);
    return;
  }

  if (options.pull) {
    if (!report.checked || !report.updateAvailable) {
      outputCommandResult(report, "No update to pull.\n", options.json);
      return;
    }
    if (report.dirty) {
      outputCommandResult(
        report,
        "Working tree has uncommitted changes — commit or stash before pulling.\n",
        options.json
      );
      process.exitCode = 1;
      return;
    }
    const pull = runCommand("git", ["pull", "origin", "main"], { cwd: report.gitRoot });
    const ok = !pull.error && pull.status === 0;
    outputCommandResult(
      { ...report, pull: { ok, stdout: pull.stdout, stderr: pull.stderr } },
      ok ? `Pulled successfully:\n${pull.stdout}` : `git pull failed:\n${pull.stderr || pull.stdout}`,
      options.json
    );
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  outputCommandResult(report, renderUpdateReport(report), options.json);
}
