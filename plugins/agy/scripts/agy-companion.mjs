#!/usr/bin/env node

import process from "node:process";
import { handleSetup } from "./features/setup.mjs";
import { handleUpdate } from "./features/update.mjs";
import { handleAgents, handleChangelog, handleDoctor, handleModels } from "./features/info.mjs";
import { handleReviewCommand } from "./features/review.mjs";
import { handleTask, handleTaskResumeCandidate } from "./features/task.mjs";
import { handleHandoff } from "./features/handoff.mjs";
import { handleCancel, handleResult, handleStatus, handleTaskWorker } from "./features/jobs.mjs";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/agy-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/agy-companion.mjs models [--json]",
      "  node scripts/agy-companion.mjs agents [--json]",
      "  node scripts/agy-companion.mjs doctor [--json]",
      "  node scripts/agy-companion.mjs changelog [--json]",
      "  node scripts/agy-companion.mjs update [--pull|--dismiss] [--json]",
      "  node scripts/agy-companion.mjs review [--wait|--background] [--dry-run] [--deep] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <name>|--tier <low|medium|high>] [--effort <low|medium|high>] [--project <id>|--new-project] [--dangerously-skip-permissions] [--add-dir <path>] [--log-file <path>] [--print-timeout <duration>]",
      "  node scripts/agy-companion.mjs adversarial-review [--wait|--background] [--dry-run] [--deep] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <name>|--tier <low|medium|high>] [--effort <low|medium|high>] [--project <id>|--new-project] [--dangerously-skip-permissions] [--add-dir <path>] [--log-file <path>] [--print-timeout <duration>] [focus text]",
      "  node scripts/agy-companion.mjs handoff [--background] [--dry-run] [--verify <cmd>] [--tests <a,b>] [--fixups <n>] [--model <name>|--tier <low|medium|high>] [--effort <low|medium|high>] [--print-timeout <duration>] [--requirement-file <path>] [requirement]",
      "  node scripts/agy-companion.mjs task [--background] [--dry-run] [--continue|--resume-last|--resume|--fresh] [--conversation <id>] [--model <name>|--tier <low|medium|high>] [--effort <low|medium|high>] [--project <id>|--new-project] [--dangerously-skip-permissions] [--add-dir <path>] [--log-file <path>] [--print-timeout <duration>] [prompt]",
      "  node scripts/agy-companion.mjs task-worker --job-id <id>",
      "  node scripts/agy-companion.mjs task-resume-candidate [--json]",
      "  node scripts/agy-companion.mjs status [job-id] [--wait] [--all] [--json]",
      "  node scripts/agy-companion.mjs result [job-id] [--json]",
      "  node scripts/agy-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "models":
      handleModels(argv);
      break;
    case "doctor":
      handleDoctor(argv);
      break;
    case "changelog":
      handleChangelog(argv);
      break;
    case "agents":
      handleAgents(argv);
      break;
    case "update":
      await handleUpdate(argv);
      break;
    case "review":
      await handleReviewCommand(argv, { reviewName: "Review" });
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, { reviewName: "Adversarial Review" });
      break;
    case "task":
      await handleTask(argv);
      break;
    case "handoff":
      await handleHandoff(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
