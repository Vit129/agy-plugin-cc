#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const STATE_DIR = path.join(os.homedir(), ".claude", "agy-companion");
const SESSION_FILE = path.join(STATE_DIR, "last-session.json");

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readLastSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeLastSession(data) {
  ensureStateDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

function getAgyPath() {
  const result = spawnSync("which", ["agy"], { encoding: "utf8" });
  return result.stdout.trim() || null;
}

function getAgyVersion() {
  const result = spawnSync("agy", ["--version"], { encoding: "utf8" });
  return result.stdout.trim() || result.stderr.trim() || null;
}

function parseArgs(argv) {
  const opts = {
    background: false,
    continue: false,
    fresh: false,
    json: false,
    model: null,
    positionals: []
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--background") {
      opts.background = true;
    } else if (arg === "--continue" || arg === "-c") {
      opts.continue = true;
    } else if (arg === "--fresh") {
      opts.fresh = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--model" || arg === "-m") {
      opts.model = argv[++i] ?? null;
    } else if (arg.startsWith("--model=")) {
      opts.model = arg.slice("--model=".length);
    } else {
      opts.positionals.push(arg);
    }
    i++;
  }

  return opts;
}

function buildAgyArgs(prompt, opts) {
  const args = [];
  if (opts.continue) {
    args.push("--continue");
  }
  args.push("--print", prompt);
  return args;
}

async function runAgyForeground(prompt, opts) {
  const agyPath = getAgyPath();
  if (!agyPath) {
    process.stderr.write("agy is not installed. Run: curl -fsSL https://antigravity.google/cli/install.sh | bash\n");
    process.exitCode = 1;
    return;
  }

  const args = buildAgyArgs(prompt, opts);
  const startedAt = new Date().toISOString();

  return new Promise((resolve) => {
    const child = spawn(agyPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      stdout += s;
      process.stdout.write(s);
    });

    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderr += s;
      process.stderr.write(s);
    });

    child.on("close", (code) => {
      writeLastSession({
        prompt,
        startedAt,
        completedAt: new Date().toISOString(),
        exitCode: code,
        continued: opts.continue
      });
      if (code !== 0) {
        process.exitCode = code;
      }
      resolve();
    });
  });
}

function runAgyBackground(prompt, opts) {
  const agyPath = getAgyPath();
  if (!agyPath) {
    process.stderr.write("agy is not installed. Run: curl -fsSL https://antigravity.google/cli/install.sh | bash\n");
    process.exitCode = 1;
    return;
  }

  ensureStateDir();
  const jobId = `agy-${Date.now()}`;
  const logFile = path.join(STATE_DIR, `${jobId}.log`);
  const args = buildAgyArgs(prompt, opts);

  const child = spawn(agyPath, args, {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: ["ignore", fs.openSync(logFile, "w"), fs.openSync(logFile, "a")]
  });
  child.unref();

  const session = {
    jobId,
    prompt,
    startedAt: new Date().toISOString(),
    pid: child.pid,
    logFile,
    status: "running",
    continued: opts.continue
  };

  writeLastSession(session);
  process.stdout.write(`agy task started in background as ${jobId}. Log: ${logFile}\n`);
}

function handleSetup() {
  const agyPath = getAgyPath();
  const version = agyPath ? getAgyVersion() : null;
  const ready = Boolean(agyPath);

  const report = {
    ready,
    agy: { available: ready, path: agyPath, version },
    nextSteps: ready ? [] : ["Install agy with: curl -fsSL https://antigravity.google/cli/install.sh | bash"]
  };

  if (ready) {
    process.stdout.write(`agy is ready.\n  Path: ${agyPath}\n  Version: ${version ?? "unknown"}\n`);
  } else {
    process.stdout.write(`agy is NOT installed.\n  Install with: curl -fsSL https://antigravity.google/cli/install.sh | bash\n`);
    process.exitCode = 1;
  }

  return report;
}

function handleTaskResumeCandidate(opts) {
  const last = readLastSession();
  const available = Boolean(last && last.completedAt && last.prompt);

  const payload = {
    available,
    candidate: available
      ? {
          prompt: last.prompt,
          completedAt: last.completedAt,
          exitCode: last.exitCode
        }
      : null
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stdout.write(
      available
        ? `Resumable agy session found (completed ${last.completedAt}).\n`
        : "No resumable agy session found.\n"
    );
  }
}

async function handleTask(argv) {
  const opts = parseArgs(argv);
  const prompt = opts.positionals.join(" ").trim();

  if (!prompt && !opts.continue) {
    process.stderr.write("Provide a prompt or use --continue to resume.\n");
    process.exitCode = 1;
    return;
  }

  if (opts.background) {
    runAgyBackground(prompt, opts);
  } else {
    await runAgyForeground(prompt, opts);
  }
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);

  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    process.stdout.write(
      [
        "Usage:",
        "  node scripts/agy-companion.mjs setup [--json]",
        "  node scripts/agy-companion.mjs task [--background] [--continue|--fresh] [--model <model>] [prompt]",
        "  node scripts/agy-companion.mjs task-resume-candidate [--json]"
      ].join("\n") + "\n"
    );
    return;
  }

  switch (subcommand) {
    case "setup":
      handleSetup();
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-resume-candidate": {
      const opts = parseArgs(argv);
      handleTaskResumeCandidate(opts);
      break;
    }
    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
