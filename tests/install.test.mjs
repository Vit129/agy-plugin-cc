import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildInstallPlan,
  detectInstalledClis,
  findOnPath,
  formatSummary,
  main,
  parseInstallArgs,
  runInstallPlan
} from "../scripts/install.mjs";

test("findOnPath and detectInstalledClis detect executable binaries on PATH", () => {
  const env = { PATH: ["/usr/local/bin", "/opt/bin"].join(path.delimiter) };
  const files = new Map([
    ["/usr/local/bin/claude", { isFile: () => true, mode: 0o755 }],
    ["/opt/bin/agy", { isFile: () => true, mode: 0o755 }],
    ["/opt/bin/codex", { isFile: () => true, mode: 0o644 }] // not executable on POSIX
  ]);

  const deps = {
    env,
    platform: "darwin",
    exists: (p) => files.has(p),
    stat: (p) => files.get(p)
  };

  assert.equal(findOnPath("claude", deps), "/usr/local/bin/claude");
  assert.equal(findOnPath("agy", deps), "/opt/bin/agy");
  assert.equal(findOnPath("codex", deps), null);

  assert.deepEqual(detectInstalledClis(deps), {
    claude: true,
    codex: false,
    agy: true
  });
});

test("parseInstallArgs handles target flags, --all, --dry-run, --help, and unknown flags", () => {
  assert.deepEqual(parseInstallArgs(["--agy", "--claude", "--agy"]), {
    targets: ["claude", "agy"],
    dryRun: false,
    help: false
  });

  assert.deepEqual(parseInstallArgs(["--all", "--dry-run"]), {
    targets: ["claude", "codex", "agy"],
    dryRun: true,
    help: false
  });

  assert.deepEqual(parseInstallArgs(["--help"]), {
    targets: [],
    dryRun: false,
    help: true
  });

  assert.throws(() => parseInstallArgs(["--bogus"]), /Unknown option: --bogus/);
});

test("buildInstallPlan generates expected commands per target", () => {
  const repoRoot = "/tmp/agent-bridge";
  const plan = buildInstallPlan(["claude", "codex", "agy"], repoRoot);

  assert.equal(plan.length, 3);
  assert.deepEqual(plan[0].steps, [
    {
      cmd: "claude",
      args: ["plugin", "marketplace", "add", repoRoot],
      fallback: { cmd: "claude", args: ["plugin", "marketplace", "update", "agent-bridge"] }
    },
    {
      cmd: "claude",
      args: ["plugin", "install", "agy@agent-bridge"],
      fallback: { cmd: "claude", args: ["plugin", "update", "agy@agent-bridge"] }
    }
  ]);

  assert.deepEqual(plan[1].steps, [
    {
      cmd: "codex",
      args: ["plugin", "marketplace", "add", "Vit129/agent-bridge"],
      fallback: { cmd: "codex", args: ["plugin", "marketplace", "upgrade", "agent-bridge"] }
    },
    {
      cmd: "codex",
      args: ["plugin", "add", "agy@agent-bridge"]
    }
  ]);

  assert.deepEqual(plan[2].steps, [
    {
      cmd: "agy",
      args: ["plugin", "install", path.join(repoRoot, "plugins", "cc-for-agy")]
    }
  ]);
});

test("runInstallPlan supports dry-run without invoking commands", () => {
  const plan = buildInstallPlan(["claude", "agy"], "/repo");
  const calls = [];
  const logs = [];

  const results = runInstallPlan(plan, {
    dryRun: true,
    runCommand: (cmd, args) => {
      calls.push([cmd, args]);
      return { ok: true, error: null };
    },
    log: (line) => logs.push(line)
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(
    results.map((r) => r.status),
    ["dry-run", "dry-run"]
  );
  assert.match(logs.join("\n"), /claude plugin marketplace add \/repo/);
  assert.match(logs.join("\n"), /agy plugin install \/repo\/plugins\/cc-for-agy/);
});

test("runInstallPlan uses fallback on failure and continues after target failure", () => {
  const plan = buildInstallPlan(["claude", "codex", "agy"], "/repo");
  const calls = [];

  const results = runInstallPlan(plan, {
    dryRun: false,
    log: () => {},
    runCommand: (cmd, args) => {
      calls.push([cmd, ...args].join(" "));
      if (cmd === "claude" && args[2] === "add") return { ok: false, error: "already exists" };
      if (cmd === "codex" && args[1] === "add") return { ok: false, error: "codex failed" };
      return { ok: true, error: null };
    }
  });

  assert.deepEqual(calls, [
    "claude plugin marketplace add /repo",
    "claude plugin marketplace update agent-bridge",
    "claude plugin install agy@agent-bridge",
    "codex plugin marketplace add Vit129/agent-bridge",
    "codex plugin add agy@agent-bridge",
    "agy plugin install /repo/plugins/cc-for-agy"
  ]);

  assert.deepEqual(
    results.map((r) => [r.id, r.status]),
    [
      ["claude", "ok"],
      ["codex", "failed"],
      ["agy", "ok"]
    ]
  );

  const summary = formatSummary(results);
  assert.match(summary, /Claude Code\s+ok/);
  assert.match(summary, /Codex\s+failed\s+codex failed/);
  assert.match(summary, /agy\s+ok/);
  assert.match(summary, /Hint: Restart Claude Code to load the plugin\./);
});

test("main prints usage and exits 1 in non-TTY without target flags", async () => {
  const logs = [];
  const code = await main({
    argv: [],
    isTTY: false,
    log: (line) => logs.push(line),
    errorLog: (line) => logs.push(line)
  });

  assert.equal(code, 1);
  assert.match(logs.join("\n"), /Usage: node scripts\/install\.mjs/);
});
