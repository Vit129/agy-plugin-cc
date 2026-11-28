import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { serverCommand, stableNodePath, writeLauncher } from '../apps/agent-usage/launcher.mjs';

test('[TC-AGU-27][BE-UT] prefers a PATH node that resolves to the running binary over the versioned Cellar path', () => {
  const real = '/opt/homebrew/Cellar/node/26.8.2/bin/node';
  const links = { '/opt/homebrew/bin/node': real, '/usr/bin/node': '/usr/bin/node' };
  const realpath = file => links[file] ?? file;
  assert.equal(stableNodePath({ execPath: real, pathEnv: '/usr/bin', realpath }), '/opt/homebrew/bin/node');
  assert.equal(stableNodePath({ execPath: '/other/node', pathEnv: '/usr/bin', realpath }), '/other/node');
});

test('[TC-AGU-29][BE-UT] starts the server with the stable node path, not the versioned Cellar binary', () => {
  const real = '/opt/homebrew/Cellar/node/26.8.2/bin/node';
  const links = { '/opt/homebrew/bin/node': real, '/usr/bin/node': '/usr/bin/node' };
  const realpath = file => links[file] ?? file;
  assert.deepEqual(serverCommand({ execPath: real, pathEnv: '/usr/bin:/opt/homebrew/bin', cli: '/x/cli.mjs', realpath }), {
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
