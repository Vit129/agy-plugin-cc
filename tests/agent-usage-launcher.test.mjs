import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverCommand, stableNodePath, writeLauncher } from '../apps/agent-usage/launcher.mjs';
import { launchAgentDefinitions, launchAgentPaths, renderLaunchAgent } from '../apps/agent-usage/launch-agents.mjs';
import { providerIcons, providerMark } from '../apps/agent-usage/ui/provider-icons.mjs';

test('[TC-AGU-27][BE-UT] prefers a version-independent node path over the running versioned binary', () => {
  const home = '/home/u';
  const volta = `${home}/.volta/tools/image/node/24.22.3/bin/node`;
  const present = list => file => list.includes(file);
  const pick = (files, pathEnv = '') => stableNodePath({ execPath: volta, pathEnv, home, exists: present(files) });
  assert.equal(pick([`${home}/.volta/bin/node`, '/opt/homebrew/bin/node']), `${home}/.volta/bin/node`);
  assert.equal(pick(['/opt/homebrew/bin/node', '/usr/local/bin/node']), '/opt/homebrew/bin/node');
  assert.equal(pick(['/usr/local/bin/node']), '/usr/local/bin/node');
  const versioned = ['/opt/homebrew/Cellar/node/26/bin', `${home}/.volta/tools/image/node/24/bin`, `${home}/.nvm/versions/node/v20/bin`, `${home}/.fnm/node-versions/v22/bin`];
  const pathEnv = [...versioned, '/srv/tools'].join(path.delimiter);
  assert.equal(pick([...versioned.map(dir => `${dir}/node`), '/srv/tools/node'], pathEnv), '/srv/tools/node');
  assert.equal(pick(versioned.map(dir => `${dir}/node`), pathEnv), volta);
});

test('[TC-AGU-51][BE-UT] renders portable LaunchAgent templates for all three roles', () => {
  const home = '/home/example & friends';
  const root = '/opt/Example <checkout>';
  const directory = path.join(home, 'usage-state');
  const prefix = 'org.example';
  const node = '/opt/bin/node';
  const paths = launchAgentPaths({ home, prefix });
  const definitions = launchAgentDefinitions({ paths, root, directory, node, env: { PATH: '/opt/bin', AGENT_USAGE_PORT: '12345' } });
  assert.deepEqual(paths.labels, {
    server: 'org.example.agent-usage', reset: 'org.example.agent-usage-reset', menubar: 'org.example.agent-usage-bar',
  });
  assert.equal(launchAgentPaths({ home, prefix: 'com.vit129' }).labels.menubar, 'com.vit129.agent-usage-bar');
  assert.throws(() => launchAgentPaths({ prefix: '../bad' }), /AGENT_USAGE_LABEL_PREFIX/);
  const cli = path.join(root, 'apps', 'agent-usage', 'cli.mjs');
  assert.deepEqual(definitions.server.ProgramArguments, [node, cli, 'serve']);
  assert.deepEqual(definitions.reset.ProgramArguments, [node, cli, 'check-reset', '--scheduled']);
  assert.equal(definitions.reset.StartInterval, 60);
  assert.deepEqual(definitions.menubar.ProgramArguments, [path.join(home, 'Applications', 'Agent Usage Bar.app', 'Contents', 'MacOS', 'AgentUsageBar')]);
  for (const definition of Object.values(definitions)) {
    assert.equal(definition.WorkingDirectory, root);
    assert.equal(definition.EnvironmentVariables.HOME, home);
    assert.equal(definition.EnvironmentVariables.AGENT_USAGE_PORT, '12345');
    const xml = renderLaunchAgent(definition);
    assert.match(xml, /\/home\/example &amp; friends/);
    assert.match(xml, /\/opt\/Example &lt;checkout&gt;/);
    assert.doesNotMatch(xml, /\/Users\//);
    if (process.platform === 'darwin') {
      execFileSync('/usr/bin/plutil', ['-lint', '--', '-'], { input: xml });
    }
  }
});

test('[TC-AGU-52][FE-UT] prefers inline vector art and falls back to two letters for an unknown provider', () => {
  assert.deepEqual(Object.keys(providerIcons).sort(), ['agy', 'claude', 'codex', 'copilot']);
  for (const provider of Object.keys(providerIcons)) {
    assert.match(providerMark(provider), /^<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M/);
  }
  assert.equal(providerMark('aider'), 'AI');
  assert.equal(providerMark('constructor'), 'CO');
  assert.equal(providerMark('<>'), 'AG');
});

test('[TC-AGU-53][BE-IT] blocks launcher, menu bar and startup from a linked checkout before changing state', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = path.join(root, '.tmp');
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'worktree-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const main = path.join(directory, 'main checkout');
  const linked = path.join(directory, 'linked checkout');
  const home = path.join(directory, 'home');
  await mkdir(home);
  const env = { ...process.env, HOME: home, AGENT_USAGE_STATE_DIR: path.join(home, 'state'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', args, { env, stdio: 'pipe' });
  git('init', main);
  git('-C', main, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
    'commit', '--allow-empty', '-m', 'fixture');
  git('-C', main, 'worktree', 'add', '--detach', linked);
  await cp(path.join(root, 'apps', 'agent-usage'), path.join(linked, 'apps', 'agent-usage'), { recursive: true });
  await cp(path.join(root, 'plugins', 'agy'), path.join(linked, 'plugins', 'agy'), { recursive: true });
  await cp(path.join(root, 'package.json'), path.join(linked, 'package.json'));
  const cli = path.join(linked, 'apps', 'agent-usage', 'cli.mjs');
  for (const [command, args] of [
    [process.execPath, [cli, 'install-launcher']],
    [process.execPath, [cli, 'ensure-running']],
    ['npm', ['--prefix', linked, 'run', 'menubar:install']],
  ]) {
    const result = spawnSync(command, args, { env, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /linked Git worktree/);
    assert.ok(result.stderr.includes(main), result.stderr);
  }
  await assert.rejects(readFile(path.join(home, '.local', 'bin', 'agent-usage')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(home, 'state', 'server.log')), { code: 'ENOENT' });
  const launcher = execFileSync(process.execPath, [cli, 'install-launcher', '--allow-worktree'], { env, encoding: 'utf8' }).trim();
  assert.match(await readFile(launcher, 'utf8'), /linked checkout\/apps\/agent-usage\/cli\.mjs/);
});

test('[TC-AGU-29][BE-UT] starts the server with the stable node path, not the versioned Cellar binary', () => {
  const real = '/opt/homebrew/Cellar/node/26.8.2/bin/node';
  const exists = file => file === '/opt/homebrew/bin/node';
  assert.deepEqual(serverCommand({ execPath: real, pathEnv: '/usr/bin', cli: '/x/cli.mjs', home: '/home/u', exists }), {
    command: '/opt/homebrew/bin/node',
    args: ['/x/cli.mjs', 'serve'],
  });
});

test('[TC-AGU-28][BE-IT] writes an executable launcher that execs the node with a quoted cli path and forwards arguments', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-usage-launcher-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'bin', 'agent-usage');
  const cli = path.join(directory, "it's", 'cli.mjs');
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, 'console.log(JSON.stringify(process.argv.slice(2)));');
  writeLauncher({ file, node: process.execPath, cli });
  const text = await readFile(file, 'utf8');
  assert.equal(text, `#!/bin/sh\nexec '${process.execPath}' '${cli.replaceAll("'", "'\\''")}' "$@"\n`);
  assert.equal(statSync(file).mode & 0o777, 0o755);
  assert.equal(execFileSync('/bin/sh', [file, 'a b'], { encoding: 'utf8' }), '["a b"]\n');
});
