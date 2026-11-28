#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const TARGETS = [
  { id: "claude", label: "Claude Code", bin: "claude" },
  { id: "codex", label: "Codex", bin: "codex" },
  { id: "agy", label: "agy", bin: "agy" },
  { id: "usage", label: "Agent Usage dashboard + menu bar", platform: "darwin" }
];

const REPO_SLUG = "Vit129/agent-bridge";
const MARKETPLACE_NAME = "agent-bridge";
const PLUGIN_REF = `agy@${MARKETPLACE_NAME}`;
const missingXcodeTools = "Xcode Command Line Tools are required. Run: xcode-select --install";

export function getUsage() {
  return [
    "Usage: node scripts/install.mjs [options]",
    "",
    "Interactive mode (TTY with no target flags):",
    "  Shows a checkbox list pre-selecting CLIs found on PATH and Agent Usage on macOS.",
    "",
    "Options:",
    "  --claude    Install/update plugin for Claude Code",
    "  --codex     Install/update plugin for Codex",
    "  --agy       Install/update agent-bridge plugin for agy",
    "  --usage     Install the Agent Usage dashboard and menu bar (macOS)",
    "  --all       Select all targets supported on this platform",
    "  --allow-worktree  Allow Agent Usage installation from a linked Git worktree",
    "  --dry-run   Print planned commands without executing them",
    "  -h, --help  Show this help message"
  ].join("\n");
}

export function findOnPath(
  bin,
  { env = process.env, exists = fs.existsSync, stat = fs.statSync, platform = process.platform } = {}
) {
  const pathEnv = env?.PATH || "";
  if (!pathEnv || !bin) return null;

  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exts =
    platform === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${bin}${ext}`);
      if (!exists(candidate)) continue;
      try {
        const st = stat(candidate);
        if (!st.isFile()) continue;
        if (platform !== "win32" && (st.mode & 0o111) === 0) continue;
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function detectInstalledClis(deps = {}) {
  const detected = {};
  for (const target of TARGETS) {
    detected[target.id] = target.platform
      ? target.platform === (deps.platform ?? process.platform)
      : Boolean(findOnPath(target.bin, deps));
  }
  return detected;
}

export function parseInstallArgs(argv = []) {
  const selected = new Set();
  let dryRun = false;
  let help = false;
  let allowWorktree = false;
  let all = false;

  for (const arg of argv) {
    if (arg === "--claude") {
      selected.add("claude");
    } else if (arg === "--codex") {
      selected.add("codex");
    } else if (arg === "--agy") {
      selected.add("agy");
    } else if (arg === "--usage") {
      selected.add("usage");
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--allow-worktree") {
      allowWorktree = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const targets = TARGETS.map((t) => t.id).filter((id) => all || selected.has(id));
  return { targets, dryRun, help, allowWorktree, usageExplicit: selected.has("usage") };
}

export function readPackageVersion(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

// `codex plugin list` prints columns separated by 2+ spaces: PLUGIN  STATUS  VERSION  SOURCE.
export function verifyCodexPluginVersion(output, expected, plugin = PLUGIN_REF) {
  const line = String(output).split("\n").find((row) => row.startsWith(`${plugin} `));
  if (!line) return { ok: false, error: `${plugin} is not listed by \`codex plugin list\`.` };
  const [, status, version] = line.trim().split(/\s{2,}/);
  if (!status?.startsWith("installed")) return { ok: false, error: `${plugin} is not installed in Codex (${status}).` };
  if (expected && version !== expected) {
    return { ok: false, error: `Codex runs ${plugin} ${version || "(unknown version)"}, expected ${expected}. Run: codex plugin marketplace upgrade ${MARKETPLACE_NAME} && codex plugin add ${PLUGIN_REF}` };
  }
  return { ok: true, error: null };
}

export function buildTargetPlan(targetId, repoRoot, { allowWorktree = false, version = readPackageVersion(repoRoot) } = {}) {
  if (targetId === "claude") {
    return [
      {
        cmd: "claude",
        args: ["plugin", "marketplace", "add", repoRoot],
        fallback: {
          cmd: "claude",
          args: ["plugin", "marketplace", "update", MARKETPLACE_NAME]
        }
      },
      {
        cmd: "claude",
        args: ["plugin", "install", PLUGIN_REF],
        fallback: {
          cmd: "claude",
          args: ["plugin", "update", PLUGIN_REF]
        }
      }
    ];
  }

  if (targetId === "codex") {
    // Codex keeps the previously installed plugin unless the marketplace is upgraded before `plugin add`,
    // so upgrade always runs (not only as a fallback) and the installed version is verified afterwards.
    return [
      {
        cmd: "codex",
        args: ["plugin", "marketplace", "add", REPO_SLUG],
        fallback: {
          cmd: "codex",
          args: ["plugin", "marketplace", "upgrade", MARKETPLACE_NAME]
        }
      },
      { cmd: "codex", args: ["plugin", "marketplace", "upgrade", MARKETPLACE_NAME] },
      { cmd: "codex", args: ["plugin", "add", PLUGIN_REF] },
      {
        cmd: "codex",
        args: ["plugin", "list"],
        capture: true,
        verify: (output) => verifyCodexPluginVersion(output, version)
      }
    ];
  }

  if (targetId === "agy") {
    return [
      {
        cmd: "agy",
        args: ["plugin", "install", path.join(repoRoot, "plugins", "cc-for-agy")]
      }
    ];
  }

  if (targetId === "usage") {
    const cli = path.join(repoRoot, "apps", "agent-usage", "cli.mjs");
    const worktreeFlags = allowWorktree ? ["--allow-worktree"] : [];
    return [
      { cmd: "/usr/bin/xcode-select", args: ["-p"], failureMessage: missingXcodeTools },
      { cmd: process.execPath, args: [cli, "install-launcher", ...worktreeFlags] },
      { cmd: process.execPath, args: [cli, "install-launch-agents", ...worktreeFlags] },
      { cmd: "npm", args: ["--prefix", repoRoot, "run", "menubar:install", ...(allowWorktree ? ["--", ...worktreeFlags] : [])] },
      { cmd: process.execPath, args: [cli, "ensure-running", ...worktreeFlags] },
      { cmd: process.execPath, args: [cli, "health"] }
    ];
  }

  throw new Error(`Unknown target: ${targetId}`);
}

export function buildInstallPlan(targetIds, repoRoot, options) {
  const byId = new Map(TARGETS.map((t) => [t.id, t]));
  return targetIds.map((id) => {
    const target = byId.get(id);
    if (!target) throw new Error(`Unknown target: ${id}`);
    return {
      id: target.id,
      label: target.label,
      steps: buildTargetPlan(target.id, repoRoot, options)
    };
  });
}

export function formatCommand(cmd, args) {
  return [cmd, ...args]
    .map((part) => (/[\s"'\\]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

// `codex plugin list` prints every marketplace plugin (about 3 MB); the default 1 MB maxBuffer made it fail with ENOBUFS.
export const CAPTURE_MAX_BUFFER = 64 * 1024 * 1024;

export function defaultRunCommand(cmd, args, { capture = false } = {}) {
  try {
    if (capture) {
      const output = execFileSync(cmd, args, { encoding: "utf8", maxBuffer: CAPTURE_MAX_BUFFER, stdio: ["inherit", "pipe", "inherit"] });
      return { ok: true, error: null, output };
    }
    execFileSync(cmd, args, { stdio: "inherit" });
    return { ok: true, error: null };
  } catch (err) {
    const message = err?.stderr ? String(err.stderr).trim() : err?.message || "Command failed";
    return { ok: false, error: message };
  }
}

export function runInstallPlan(plan, { dryRun = false, runCommand = defaultRunCommand, log = console.log } = {}) {
  const results = [];

  for (const entry of plan) {
    if (dryRun) {
      log(`\n[${entry.label}] (dry-run)`);
      for (const step of entry.steps) {
        const primary = formatCommand(step.cmd, step.args);
        if (step.fallback) {
          log(`  ${primary}  # fallback: ${formatCommand(step.fallback.cmd, step.fallback.args)}`);
        } else {
          log(`  ${primary}`);
        }
      }
      results.push({ id: entry.id, label: entry.label, status: "dry-run", error: null });
      continue;
    }

    log(`\nInstalling for ${entry.label}...`);
    let targetOk = true;
    let targetError = null;

    for (const step of entry.steps) {
      log(`> ${formatCommand(step.cmd, step.args)}`);
      let res = runCommand(step.cmd, step.args, step.capture ? { capture: true } : undefined);
      if (!res.ok && step.fallback) {
        log(`> ${formatCommand(step.fallback.cmd, step.fallback.args)}`);
        res = runCommand(step.fallback.cmd, step.fallback.args);
      }
      if (res.ok && step.verify) res = step.verify(res.output ?? "");
      if (!res.ok) {
        targetOk = false;
        targetError = step.failureMessage || res.error || "Command failed";
        break;
      }
    }

    results.push({
      id: entry.id,
      label: entry.label,
      status: targetOk ? "ok" : "failed",
      error: targetError
    });
  }

  return results;
}

export function formatSummary(results) {
  const lines = ["", "Summary:", "Target        Status    Details", "------------  --------  ------------------------------"];
  for (const r of results) {
    const label = r.label.padEnd(12);
    const status = r.status.padEnd(8);
    const details = r.error ? r.error.split("\n")[0] : r.status === "dry-run" ? "Commands printed only" : "Installed/updated";
    lines.push(`${label}  ${status}  ${details}`);
  }

  const okIds = new Set(results.filter((r) => r.status === "ok").map((r) => r.id));
  const hints = [];
  if (okIds.has("claude")) hints.push("Claude Code");
  if (okIds.has("codex")) hints.push("Codex");
  if (hints.length > 0) {
    lines.push("", `Hint: Restart ${hints.join(" / ")} to load the plugin.`);
  }

  return lines.join("\n");
}

function renderCheckboxes(items, cursor) {
  const lines = ["Select targets to install/update:"];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const pointer = i === cursor ? ">" : " ";
    const box = item.checked ? "[x]" : "[ ]";
    if (!item.installed) {
      lines.push(`\x1b[2m${pointer} ${box} ${item.label} (${item.platform ? "macOS only" : "not installed"})\x1b[0m`);
    } else if (i === cursor) {
      lines.push(`\x1b[36m${pointer} ${box} ${item.label}\x1b[0m`);
    } else {
      lines.push(`${pointer} ${box} ${item.label}`);
    }
  }
  lines.push("", "\x1b[2m↑/↓ or j/k: move  space: toggle  a: all  enter: confirm  q: abort\x1b[0m");
  return lines;
}

export function promptTargets(installed, { stdin = process.stdin, stdout = process.stdout } = {}) {
  const items = TARGETS.map((t) => ({
    ...t,
    installed: Boolean(installed[t.id]),
    checked: Boolean(installed[t.id])
  }));
  let cursor = 0;
  let renderedLines = 0;

  const draw = () => {
    if (renderedLines > 0) {
      stdout.write(`\x1b[${renderedLines}A\x1b[0J`);
    }
    const lines = renderCheckboxes(items, cursor);
    stdout.write(`${lines.join("\n")}\n`);
    renderedLines = lines.length;
  };

  return new Promise((resolve) => {
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write("\x1b[?25l");
    draw();

    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\x1b[?25h");
    };

    const onKeypress = (_str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        resolve(null);
        return;
      }
      if (key.name === "q") {
        cleanup();
        resolve(null);
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(items.filter((i) => i.checked).map((i) => i.id));
        return;
      }
      if (key.name === "up" || key.name === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        draw();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % items.length;
        draw();
        return;
      }
      if (key.name === "space") {
        if (items[cursor].installed) {
          items[cursor].checked = !items[cursor].checked;
          draw();
        }
        return;
      }
      if (key.name === "a") {
        const installable = items.filter((i) => i.installed);
        const allChecked = installable.length > 0 && installable.every((i) => i.checked);
        for (const item of installable) {
          item.checked = !allChecked;
        }
        draw();
      }
    };

    stdin.on("keypress", onKeypress);
  });
}

export async function main({
  argv = process.argv.slice(2),
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  platform = process.platform,
  isTTY = Boolean(process.stdin.isTTY),
  detectClis = detectInstalledClis,
  prompt = promptTargets,
  runCommand = defaultRunCommand,
  log = console.log,
  errorLog = console.error
} = {}) {
  let parsed;
  try {
    parsed = parseInstallArgs(argv);
  } catch (err) {
    errorLog(err.message);
    errorLog("");
    errorLog(getUsage());
    return 1;
  }

  if (parsed.help) {
    log(getUsage());
    return 0;
  }

  let selectedTargets = parsed.targets;
  if (selectedTargets.length === 0) {
    if (!isTTY) {
      log(getUsage());
      return 1;
    }
    const installed = detectClis({ platform });
    selectedTargets = await prompt(installed);
    if (selectedTargets === null) {
      log("Aborted.");
      return 1;
    }
    if (selectedTargets.length === 0) {
      log("No targets selected.");
      return 0;
    }
  }

  if (platform !== "darwin") {
    if (parsed.usageExplicit) {
      errorLog("Agent Usage dashboard + menu bar setup requires macOS.");
      return 1;
    }
    selectedTargets = selectedTargets.filter(id => id !== "usage");
  }
  const plan = buildInstallPlan(selectedTargets, repoRoot, parsed);
  const results = runInstallPlan(plan, { dryRun: parsed.dryRun, runCommand, log });
  log(formatSummary(results));

  return results.some((r) => r.status === "failed") ? 1 : 0;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const code = await main();
  process.exit(code);
}
