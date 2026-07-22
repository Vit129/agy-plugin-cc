import { spawnSync } from "node:child_process";
import process from "node:process";

import { binaryAvailable } from "./process.mjs";

export function getCodexBarAvailability(cwd) {
  return binaryAvailable("codexbar", ["--version"], { cwd });
}

export function runCodexBarAntigravityQuota(cwd, options = {}) {
  const result = spawnSync("codexbar", ["usage", "--provider", "antigravity", "--json"], {
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
