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

test("[TC-INS-01][BE-UT] findOnPath and detectInstalledClis detect executable binaries on PATH", () => {
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
    agy: true,
    usage: true
  });
  assert.equal(detectInstalledClis({ ...deps, platform: "linux" }).usage, false);
});

test("[TC-INS-02][BE-UT] parseInstallArgs handles target flags, --all, --dry-run, --help, and unknown flags", () => {
  assert.deepEqual(parseInstallArgs(["--agy", "--claude", "--agy"]), {
    targets: ["claude", "agy"],
    dryRun: false,
    help: false,
    allowWorktree: false,
    usageExplicit: false
  });

  assert.deepEqual(parseInstallArgs(["--all", "--dry-run"]), {
    targets: ["claude", "codex", "agy", "usage"],
    dryRun: true,
    help: false,
    allowWorktree: false,
    usageExplicit: false
  });

  assert.deepEqual(parseInstallArgs(["--help"]), {
    targets: [],
    dryRun: false,
    help: true,
    allowWorktree: false,
    usageExplicit: false
  });
  assert.deepEqual(parseInstallArgs(["--usage", "--allow-worktree"]), {
    targets: ["usage"], dryRun: false, help: false, allowWorktree: true, usageExplicit: true
  });

  assert.throws(() => parseInstallArgs(["--bogus"]), /Unknown option: --bogus/);
});

test("[TC-INS-03][BE-UT] buildInstallPlan generates expected commands per target", () => {
  const repoRoot = "/tmp/agent-bridge";
  const plan = buildInstallPlan(["claude", "codex", "agy", "usage"], repoRoot);

  assert.equal(plan.length, 4);
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

  assert.deepEqual(plan[1].steps.map(({ cmd, args, fallback }) => [cmd, args.join(" "), fallback?.args.join(" ")]), [
    ["codex", "plugin marketplace add Vit129/agent-bridge", "plugin marketplace upgrade agent-bridge"],
    ["codex", "plugin marketplace upgrade agent-bridge", undefined],
    ["codex", "plugin add agy@agent-bridge", undefined],
    ["codex", "plugin list", undefined]
  ]);

  assert.deepEqual(plan[2].steps, [
    {
      cmd: "agy",
      args: ["plugin", "install", path.join(repoRoot, "plugins", "cc-for-agy")]
    }
  ]);

  const cli = path.join(repoRoot, "apps", "agent-usage", "cli.mjs");
  assert.deepEqual(plan[3].steps.map(({ cmd, args }) => [cmd, ...args]), [
    ["/usr/bin/xcode-select", "-p"],
    [process.execPath, cli, "install-launcher"],
    [process.execPath, cli, "install-launch-agents"],
    ["npm", "--prefix", repoRoot, "run", "menubar:install"],
    [process.execPath, cli, "ensure-running"],
    [process.execPath, cli, "health"]
  ]);
  const [usage] = buildInstallPlan(["usage"], repoRoot, { allowWorktree: true });
  assert.deepEqual(usage.steps.map(({ args }) => args.at(-1)), [
    "-p", "--allow-worktree", "--allow-worktree", "--allow-worktree", "--allow-worktree", "health"
  ]);
});

test("[TC-AGU-55][BE-UT] stops before installation when xcode-select cannot find developer tools", async () => {
  const calls = [];
  const logs = [];
  const code = await main({
    argv: ["--usage"], platform: "darwin",
    runCommand: (cmd, args) => {
      calls.push([cmd, ...args]);
      return { ok: false, error: "no developer tools" };
    },
    log: line => logs.push(line)
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, [["/usr/bin/xcode-select", "-p"]]);
  assert.match(logs.join("\n"), /xcode-select --install/);
});

test("[TC-AGU-50][BE-UT] includes Usage on macOS only and leaves dry-run homes untouched", async () => {
  const logs = [];
  const options = { log: line => logs.push(line), errorLog: line => logs.push(line),
    runCommand: () => assert.fail("dry run executed a command") };
  assert.equal(await main({ ...options, argv: ["--all", "--dry-run"], platform: "linux" }), 0);
  assert.doesNotMatch(logs.join("\n"), /menubar:install/);
  assert.equal(await main({ ...options, argv: ["--usage", "--dry-run"], platform: "linux" }), 1);
  assert.match(logs.join("\n"), /requires macOS/);
  assert.equal(await main({ ...options, argv: ["--usage", "--dry-run"], platform: "darwin" }), 0);
  assert.match(logs.join("\n"), /menubar:install/);
});

test("[TC-INS-04][BE-IT] runInstallPlan supports dry-run without invoking commands", () => {
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

test("[TC-INS-05][BE-IT] runInstallPlan uses fallback on failure and continues after target failure", () => {
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
    "codex plugin marketplace upgrade agent-bridge",
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

test("[TC-INS-06][BE-IT] main prints usage and exits 1 in non-TTY without target flags", async () => {
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

const codexList = (version, status = "installed, enabled") => [
  "Marketplace `agent-bridge`",
  "PLUGIN                STATUS              VERSION  SOURCE",
  `agy@agent-bridge      ${status}  ${version}    /x/plugins/agy`
].join("\n");

test("[TC-AGU-86][BE-UT] Codex plan always upgrades the marketplace and verifies the installed version", () => {
  const [codex] = buildInstallPlan(["codex"], "/tmp/agent-bridge", { version: "2.3.0" });
  const commands = codex.steps.map((step) => `${step.cmd} ${step.args.join(" ")}`);
  assert.deepEqual(commands.slice(1), [
    "codex plugin marketplace upgrade agent-bridge", "codex plugin add agy@agent-bridge", "codex plugin list"
  ]);
  assert.ok(commands.indexOf("codex plugin marketplace upgrade agent-bridge") < commands.indexOf("codex plugin add agy@agent-bridge"));
  const verify = codex.steps.at(-1).verify;
  assert.deepEqual(verify(codexList("2.3.0")), { ok: true, error: null });
  assert.match(verify(codexList("2.2.0")).error, /runs agy@agent-bridge 2\.2\.0, expected 2\.3\.0/);
  assert.match(verify(codexList("", "not installed")).error, /not installed/);
  assert.match(verify("PLUGIN STATUS").error, /not listed/);
});

test("[TC-AGU-87][BE-IT] a Codex version mismatch fails the target with the manual upgrade command", () => {
  const plan = buildInstallPlan(["codex"], "/tmp/agent-bridge", { version: "2.3.0" });
  const run = (listed) => runInstallPlan(plan, {
    log: () => {},
    runCommand: (cmd, args) => ({ ok: true, error: null, output: args[1] === "list" ? codexList(listed) : "" })
  });
  assert.equal(run("2.3.0")[0].status, "ok");
  const [stale] = run("2.2.0");
  assert.equal(stale.status, "failed");
  assert.match(stale.error, /codex plugin marketplace upgrade agent-bridge && codex plugin add agy@agent-bridge/);
});
