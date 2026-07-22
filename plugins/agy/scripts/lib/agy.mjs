import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

import { binaryAvailable } from "./process.mjs";

export function getAgyAvailability(cwd) {
  const result = binaryAvailable("agy", ["--version"], { cwd });
  if (result.available) {
    return { available: true, detail: `agy ${result.detail}` };
  }
  return result;
}

export function getAgyAuthStatus(cwd) {
  const avail = getAgyAvailability(cwd);
  if (!avail.available) {
    return { loggedIn: false, detail: "agy not installed" };
  }
  return { loggedIn: true, detail: "agy is available (auth managed by agy itself)" };
}

export function buildAgyArgs(prompt, options = {}) {
  const args = [];

  if (options.resumeLast) {
    args.push("--continue");
  }

  if (options.conversation) {
    args.push("--conversation", options.conversation);
  }

  if (options.sandbox) {
    args.push("--sandbox");
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.effort) {
    args.push("--effort", options.effort);
  }

  if (options.newProject) {
    args.push("--new-project");
  } else if (options.project) {
    args.push("--project", options.project);
  }

  if (options.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  for (const dir of options.addDirs ?? []) {
    args.push("--add-dir", dir);
  }

  if (options.logFile) {
    args.push("--log-file", options.logFile);
  }

  if (options.printTimeout) {
    args.push("--print-timeout", options.printTimeout);
  }

  const effectivePrompt = prompt || (options.resumeLast ? "Continue." : "");
  if (effectivePrompt) {
    args.push("--print", effectivePrompt);
  }

  return args;
}

export async function runAgyTask(cwd, prompt, options = {}) {
  const args = buildAgyArgs(prompt, options);

  if (!args.length) {
    throw new Error("No prompt or action provided for agy.");
  }

  return new Promise((resolve) => {
      const child = spawn("agy", args, {
        cwd: cwd || process.cwd(),
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      stdout += s;
      options.onProgress?.({ message: s.trim().split("\n")[0] ?? "" });
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ exitCode: 1, stdout, stderr: error.message });
    });

    child.on("close", (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

export function runAgyTaskSync(cwd, prompt, options = {}) {
  const args = buildAgyArgs(prompt, options);

  const result = spawnSync("agy", args, {
    cwd: cwd || process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout
  });

  if (result.error?.code === "ETIMEDOUT") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "agy task timed out.",
      timedOut: true
    };
  }

  return {
    exitCode: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: false
  };
}

export function runAgyModels(cwd, options = {}) {
  const result = spawnSync("agy", ["models"], {
    cwd: cwd || process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout
  });

  return {
    exitCode: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

export function runAgyAgents(cwd, options = {}) {
  const result = spawnSync("agy", ["agents"], {
    cwd: cwd || process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout
  });

  return {
    exitCode: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

export function runAgyChangelog(cwd, options = {}) {
  const result = spawnSync("agy", ["changelog"], {
    cwd: cwd || process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout
  });

  return {
    exitCode: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}
