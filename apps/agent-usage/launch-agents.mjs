import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot, serverCommand } from './launcher.mjs';
import { stateDirectory } from './state.mjs';

const launchctl = '/bin/launchctl';
const appName = 'Agent Usage Bar.app';
const environmentKeys = [
  'PATH', 'AGENT_USAGE_PORT', 'AGENT_USAGE_STATE_DIR', 'XDG_STATE_HOME', 'AI_QUOTA_DIR',
  'CLAUDE_CONFIG_DIR', 'AGY_HOME', 'COPILOT_HOME', 'CODEX_HOME',
];

export function launchAgentPaths({ home = os.homedir(), prefix = process.env.AGENT_USAGE_LABEL_PREFIX ?? 'com.vit129' } = {}) {
  if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(prefix)) {
    throw new Error('AGENT_USAGE_LABEL_PREFIX must contain only dot-separated letters, digits, or hyphens.');
  }
  const server = `${prefix}.agent-usage`;
  return {
    launcher: path.join(home, '.local', 'bin', 'agent-usage'),
    application: path.join(home, 'Applications', appName),
    agents: path.join(home, 'Library', 'LaunchAgents'),
    labels: { server, reset: `${server}-reset`, menubar: `${server}-bar` },
  };
}

export function launchAgentDefinitions({ paths, root, directory, node, env, allowWorktree = false }) {
  const cli = path.join(root, 'apps', 'agent-usage', 'cli.mjs');
  const environment = {
    HOME: path.dirname(path.dirname(paths.agents)),
    ...Object.fromEntries(environmentKeys.filter(key => env[key]).map(key => [key, env[key]])),
  };
  environment.AGENT_USAGE_LABEL_PREFIX = paths.labels.server.slice(0, -'.agent-usage'.length);
  const service = (label, args, log, extra) => ({
    Label: label,
    ProgramArguments: args,
    WorkingDirectory: root,
    EnvironmentVariables: environment,
    StandardOutPath: path.join(directory, log),
    StandardErrorPath: path.join(directory, log),
    ...extra,
  });
  return {
    server: service(paths.labels.server, [node, cli, 'serve'], 'server.log', {
      RunAtLoad: true,
      KeepAlive: { SuccessfulExit: false },
      ProcessType: 'Background',
    }),
    reset: service(paths.labels.reset, [node, cli, 'check-reset', '--scheduled', ...(allowWorktree ? ['--allow-worktree'] : [])], 'reset.log', {
      StartInterval: 60,
      ProcessType: 'Background',
    }),
    menubar: service(paths.labels.menubar, [
      path.join(paths.application, 'Contents', 'MacOS', 'AgentUsageBar'),
      ...(allowWorktree ? ['--allow-worktree'] : []),
    ], 'menubar.log', {
      RunAtLoad: true,
      ProcessType: 'Interactive',
    }),
  };
}

function plistValue(value) {
  if (typeof value === 'string') {
    const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return `<string>${escaped}</string>`;
  }
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
  if (typeof value === 'number') return `<integer>${value}</integer>`;
  if (Array.isArray(value)) return `<array>${value.map(plistValue).join('\n')}</array>`;
  return `<dict>\n${Object.entries(value).map(([key, item]) =>
    `<key>${key}</key>${plistValue(item)}`).join('\n')}\n</dict>`;
}

export function renderLaunchAgent(definition) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistValue(definition)}\n</plist>\n`;
}

function guiDomain() {
  if (process.platform !== 'darwin') throw new Error('Agent Usage LaunchAgents require macOS.');
  return `gui/${process.getuid()}`;
}

function registered(service) {
  return spawnSync(launchctl, ['print', service], { stdio: 'ignore' }).status === 0;
}

export function startInstalledServer() {
  if (process.platform !== 'darwin') return false;
  const paths = launchAgentPaths();
  if (!existsSync(path.join(paths.agents, `${paths.labels.server}.plist`))) return false;
  const service = `${guiDomain()}/${paths.labels.server}`;
  if (!registered(service)) return false;
  execFileSync(launchctl, ['kickstart', service], { stdio: 'pipe' });
  return true;
}

function unload(domain, label) {
  const service = `${domain}/${label}`;
  if (registered(service)) execFileSync(launchctl, ['bootout', service], { stdio: 'pipe' });
}

export function installLaunchAgents(roles, { allowWorktree = false } = {}) {
  const domain = guiDomain();
  const paths = launchAgentPaths();
  const directory = stateDirectory();
  const cli = path.join(repoRoot, 'apps', 'agent-usage', 'cli.mjs');
  const { command: node } = serverCommand({ execPath: process.execPath, pathEnv: process.env.PATH, cli });
  const definitions = launchAgentDefinitions({ paths, root: repoRoot, directory, node, env: process.env, allowWorktree });
  mkdirSync(paths.agents, { recursive: true });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const role of roles) {
    const definition = definitions[role];
    const file = path.join(paths.agents, `${definition.Label}.plist`);
    unload(domain, definition.Label);
    if (role === 'menubar') installApplication(paths.application);
    writeFileSync(file, renderLaunchAgent(definition), { mode: 0o644 });
    execFileSync(launchctl, ['bootstrap', domain, file], { stdio: 'pipe' });
    console.log(`Registered ${definition.Label}`);
  }
}

function installApplication(destination) {
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(path.join(parent, '.agent-usage-'));
  const next = path.join(staging, appName);
  const previous = path.join(staging, 'previous.app');
  try {
    execFileSync('/usr/bin/ditto', [path.join(repoRoot, '.tmp', 'menubar', appName), next], { stdio: 'pipe' });
    if (existsSync(destination)) renameSync(destination, previous);
    try {
      renameSync(next, destination);
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, destination);
      throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function uninstallUsage() {
  const domain = guiDomain();
  const paths = launchAgentPaths();
  for (const label of [paths.labels.menubar, paths.labels.reset, paths.labels.server]) {
    unload(domain, label);
    rmSync(path.join(paths.agents, `${label}.plist`), { force: true });
  }
  rmSync(paths.application, { recursive: true, force: true });
  rmSync(paths.launcher, { force: true });
}
