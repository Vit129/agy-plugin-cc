import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const STATE_VERSION = 1;
const MAX_JOBS = 50;

export function nowIso() {
  return new Date().toISOString();
}

export function resolveWorkspaceRoot(cwd = process.cwd()) {
  const startDir = path.resolve(cwd || process.cwd());
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8"
  });
  if (git.status === 0 && git.stdout.trim()) {
    return path.resolve(git.stdout.trim());
  }
  return startDir;
}

export function resolveStateDir(cwd, env = process.env) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonical = workspaceRoot;
  try {
    canonical = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonical = workspaceRoot;
  }
  const slug =
    (path.basename(workspaceRoot) || "workspace")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const pluginData = env.PLUGIN_DATA || env.CC_PLUGIN_AGY_DATA;
  const stateRoot = pluginData
    ? path.join(pluginData, "state")
    : path.join(os.tmpdir(), "claude-companion");
  return path.join(stateRoot, `${slug}-${hash}`);
}

export function resolveJobsDir(cwd, env = process.env) {
  return path.join(resolveStateDir(cwd, env), "jobs");
}

export function resolveJobFile(cwd, jobId, env = process.env) {
  return path.join(resolveJobsDir(cwd, env), `${jobId}.json`);
}

export function resolveJobLogFile(cwd, jobId, env = process.env) {
  return path.join(resolveJobsDir(cwd, env), `${jobId}.log`);
}

export function ensureStateDir(cwd, env = process.env) {
  fs.mkdirSync(resolveJobsDir(cwd, env), { recursive: true });
}

export function loadState(cwd, env = process.env) {
  const stateFile = path.join(resolveStateDir(cwd, env), "state.json");
  if (!fs.existsSync(stateFile)) {
    return { version: STATE_VERSION, jobs: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      version: STATE_VERSION,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return { version: STATE_VERSION, jobs: [] };
  }
}

export function saveState(cwd, state, env = process.env) {
  const prevJobs = loadState(cwd, env).jobs;
  ensureStateDir(cwd, env);
  const nextJobs = [...(state.jobs ?? [])]
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
  const retained = new Set(nextJobs.map((j) => j.id));
  for (const job of prevJobs) {
    if (retained.has(job.id)) continue;
    for (const f of [resolveJobFile(cwd, job.id, env), job.logFile]) {
      if (f && fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {
          // Ignore
        }
      }
    }
  }
  const stateFile = path.join(resolveStateDir(cwd, env), "state.json");
  const tmp = `${stateFile}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: STATE_VERSION, jobs: nextJobs }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, stateFile);
  return { version: STATE_VERSION, jobs: nextJobs };
}

export function generateJobId(prefix = "job") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertJob(cwd, patch, env = process.env) {
  const state = loadState(cwd, env);
  const ts = nowIso();
  const idx = state.jobs.findIndex((j) => j.id === patch.id);
  if (idx === -1) {
    state.jobs.unshift({ createdAt: ts, updatedAt: ts, ...patch });
  } else {
    state.jobs[idx] = { ...state.jobs[idx], ...patch, updatedAt: ts };
  }
  return saveState(cwd, state, env);
}

export function listJobs(cwd, env = process.env) {
  const state = loadState(cwd, env);
  let changed = false;
  for (const job of state.jobs) {
    if (job.status !== "running") continue;
    let alive = false;
    if (Number.isInteger(job.pid) && job.pid > 0) {
      try {
        process.kill(job.pid, 0);
        alive = true;
      } catch (err) {
        alive = err?.code === "EPERM";
      }
    }
    if (!alive) {
      job.status = "failed";
      job.phase = "failed";
      job.note = "Detached worker process is no longer running.";
      job.updatedAt = nowIso();
      changed = true;
    }
  }
  return changed ? saveState(cwd, state, env).jobs : state.jobs;
}

export function writeJobFile(cwd, jobId, payload, env = process.env) {
  ensureStateDir(cwd, env);
  const file = resolveJobFile(cwd, jobId, env);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

export function readJobFile(cwd, jobId, env = process.env) {
  const file = resolveJobFile(cwd, jobId, env);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function appendUsageLog(cwd, record, env = process.env) {
  const dir = resolveStateDir(cwd, env);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, "usage.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

export function sumUsage(entries) {
  const list = entries.filter(Boolean);
  if (list.length === 0) return null;
  const tokens = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_tokens: 0
  };
  let durationSeconds = 0;
  let numTurns = 0;
  let totalCostUsd = 0;
  let hasCost = false;
  for (const e of list) {
    for (const k of Object.keys(tokens)) {
      tokens[k] += Number(e.tokens?.[k]) || 0;
    }
    durationSeconds += Number(e.durationSeconds) || 0;
    numTurns += Number(e.numTurns) || 0;
    if (typeof e.totalCostUsd === "number") {
      totalCostUsd += e.totalCostUsd;
      hasCost = true;
    }
  }
  return {
    ...list.at(-1),
    tokens,
    durationSeconds,
    numTurns,
    totalCostUsd: hasCost ? totalCostUsd : null,
    calls: list.length
  };
}

export function formatUsage(usage) {
  if (!usage?.tokens) return "";
  const n = (v) => Number(v).toLocaleString("en-US");
  const t = usage.tokens;
  const parts = [`${n(t.input_tokens)} in / ${n(t.output_tokens)} out`];
  if (t.cache_read_tokens) parts.push(`cache ${n(t.cache_read_tokens)}`);
  if (usage.model) parts.push(usage.model);
  if (usage.durationSeconds) parts.push(`${usage.durationSeconds.toFixed(1)}s`);
  if (usage.calls > 1) parts.push(`${usage.calls} claude calls`);
  return parts.join(" · ");
}

export function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch (err) {
    if (err?.code === "ESRCH") return false;
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}
