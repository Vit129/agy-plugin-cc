import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { getAgyAuthStatus, getAgyAvailability, runAgyAgents, runAgyChangelog, runAgyModels } from "../lib/agy.mjs";
import { ROOT_DIR, outputCommandResult, parseCommandInput, parseModelLines, resolveCommandCwd } from "./shared.mjs";

export function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// One plugin tree serves both hosts, so the host comes from the environment:
// Claude Code sets CLAUDECODE in every shell it runs.
export function detectHost(env = process.env) {
  return env.CLAUDECODE ? "claude" : "codex";
}

export function findPluginManifest(host = detectHost()) {
  const candidates = [
    path.join(ROOT_DIR, host === "codex" ? ".codex-plugin" : ".claude-plugin", "plugin.json"),
    path.join(ROOT_DIR, ".claude-plugin", "plugin.json")
  ];
  const manifestPath = candidates.find((candidate) => fs.existsSync(candidate));
  return {
    path: manifestPath ?? null,
    manifest: manifestPath ? readJsonIfExists(manifestPath) : null
  };
}

export function buildHostDoctor(manifestVersion) {
  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
  const claudeMarketplacePath = path.join(
    os.homedir(),
    ".claude",
    "plugins",
    "marketplaces",
    "agent-bridge.json"
  );
  const codexConfig = fs.existsSync(codexConfigPath)
    ? fs.readFileSync(codexConfigPath, "utf8")
    : "";
  const host = detectHost();

  if (host === "codex") {
    const skillPathMatches = [
      ...codexConfig.matchAll(
        /path = "([^"]*agent-bridge\/agy\/([^"]+)\/skills\/[^"]+\/SKILL\.md)"/g
      )
    ];
    const skillPaths = skillPathMatches.map((match) => match[1]);
    const staleSkillPaths = skillPathMatches
      .filter((match) => manifestVersion && match[2] !== manifestVersion)
      .map((match) => match[1]);
    return {
      host,
      configPath: codexConfigPath,
      configExists: Boolean(codexConfig),
      pluginEnabled: /\[plugins\."agy@agent-bridge"\][\s\S]*?enabled = true/.test(codexConfig),
      skillPaths,
      staleSkillPaths
    };
  }

  const pointer = readJsonIfExists(claudeMarketplacePath);
  return {
    host,
    marketplacePointerPath: claudeMarketplacePath,
    marketplacePointerExists: Boolean(pointer),
    marketplacePointer: pointer
  };
}

export function buildDoctorReport(cwd) {
  const { path: manifestPath, manifest } = findPluginManifest();
  const agy = getAgyAvailability(cwd);
  const auth = getAgyAuthStatus(cwd);
  const modelsResult = agy.available ? runAgyModels(cwd, { timeout: 10000 }) : null;
  const models = modelsResult?.exitCode === 0 ? parseModelLines(modelsResult.stdout) : [];
  const host = buildHostDoctor(manifest?.version ?? null);

  return {
    ready: Boolean(agy.available && auth.loggedIn !== false && manifest),
    plugin: {
      root: ROOT_DIR,
      manifestPath,
      version: manifest?.version ?? null,
      name: manifest?.name ?? null
    },
    host,
    agy,
    auth,
    models: {
      ok: modelsResult ? modelsResult.exitCode === 0 : false,
      count: models.length,
      items: models,
      error:
        modelsResult && modelsResult.exitCode !== 0
          ? (modelsResult.stderr || modelsResult.stdout || "agy models failed").trim()
          : null
    }
  };
}

export function renderModelsReport(models) {
  if (models.length === 0) {
    return "No agy models reported.\n";
  }
  return models.join("\n") + "\n";
}

export function renderDoctorReport(report) {
  const lines = [
    "# agy Doctor",
    "",
    "Ready: " + (report.ready ? "yes" : "no"),
    "Plugin: " + (report.plugin.name ?? "unknown") + " " + (report.plugin.version ?? "unknown"),
    "Host: " + report.host.host,
    "agy: " + (report.agy.available ? report.agy.detail : "missing (" + report.agy.detail + ")"),
    "auth: " + (report.auth.loggedIn ? "ok" : report.auth.detail),
    "models: " + (report.models.ok ? report.models.count + " available" : report.models.error ?? "not checked")
  ];

  if (report.host.host === "codex") {
    lines.push(
      "Codex config: " + (report.host.configExists ? report.host.configPath : "missing"),
      "Codex plugin enabled: " + (report.host.pluginEnabled ? "yes" : "no"),
      "Skill paths: " + report.host.skillPaths.length,
      "Stale skill paths: " + report.host.staleSkillPaths.length
    );
    for (const stalePath of report.host.staleSkillPaths) {
      lines.push("- stale: " + stalePath);
    }
  } else {
    lines.push(
      "Claude marketplace pointer: " +
        (report.host.marketplacePointerExists ? report.host.marketplacePointerPath : "missing")
    );
  }

  if (report.models.items.length > 0) {
    lines.push("", "Models:");
    for (const model of report.models.items) {
      lines.push("- " + model);
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function handleModels(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const result = runAgyModels(cwd, { timeout: 10000 });
  const models = result.exitCode === 0 ? parseModelLines(result.stdout) : [];
  const payload = { ok: result.exitCode === 0, models, exitCode: result.exitCode, stderr: result.stderr };
  outputCommandResult(
    payload,
    result.exitCode === 0 ? renderModelsReport(models) : (result.stderr || result.stdout || "agy models failed\n"),
    options.json,
    result.exitCode
  );
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

export function handleDoctor(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const report = buildDoctorReport(cwd);
  outputCommandResult(report, renderDoctorReport(report), options.json);
}

export function handleChangelog(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const result = runAgyChangelog(cwd, { timeout: 10000 });
  const payload = { ok: result.exitCode === 0, text: result.stdout, exitCode: result.exitCode, stderr: result.stderr };
  outputCommandResult(
    payload,
    result.exitCode === 0 ? result.stdout : (result.stderr || result.stdout || "agy changelog failed\n"),
    options.json,
    result.exitCode
  );
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

export function handleAgents(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const result = runAgyAgents(cwd, { timeout: 10000 });
  const payload = { ok: result.exitCode === 0, text: result.stdout, exitCode: result.exitCode, stderr: result.stderr };
  outputCommandResult(
    payload,
    result.exitCode === 0 ? result.stdout : (result.stderr || result.stdout || "agy agents failed\n"),
    options.json,
    result.exitCode
  );
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}
