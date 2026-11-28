import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fallbackNodeDirs = ['/opt/homebrew/bin', '/usr/local/bin'];
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function requirePersistentCheckout({ root = repoRoot, allowWorktree = false } = {}) {
  if (allowWorktree || !statSync(path.join(root, '.git'), { throwIfNoEntry: false })?.isFile()) return;
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const [gitDir, commonDir] = git(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']).trimEnd().split('\n');
  if (gitDir === commonDir) return;
  const primary = git(['worktree', 'list', '--porcelain', '-z']).split('\0', 1)[0].slice('worktree '.length);
  throw new Error(`Agent Usage cannot install or start from a linked Git worktree. Use the main checkout at ${primary}. Pass --allow-worktree to opt in explicitly.`);
}

const versionedDirs = ['/Cellar/', '/.volta/tools/image/', '/.nvm/versions/', '/.fnm/'];
const isVersioned = dir => versionedDirs.some(marker => `${dir}/`.includes(marker));

// Prefer a node path that survives upgrades (Cellar, Volta image, nvm and fnm paths embed the version).
// Order: Volta shim, Homebrew, /usr/local, then an unversioned PATH entry, else the running binary.
// A shim or link is accepted by name: only the version-independent path matters, not what it resolves to today.
export function stableNodePath({ execPath, pathEnv = '', home = homedir(), exists = file => statSync(file, { throwIfNoEntry: false }) !== undefined }) {
  const dirs = [path.join(home, '.volta', 'bin'), ...fallbackNodeDirs, ...pathEnv.split(path.delimiter).filter(dir => dir && !isVersioned(dir))];
  for (const dir of dirs) {
    const candidate = path.join(dir, 'node');
    if (exists(candidate)) return candidate;
  }
  return execPath;
}

// The server outlives the shell that started it, so it must not inherit a versioned Cellar path.
export function serverCommand({ execPath, pathEnv = '', cli, ...options }) {
  return { command: stableNodePath({ execPath, pathEnv, ...options }), args: [cli, 'serve'] };
}

const quote = value => `'${String(value).replaceAll("'", `'\\''`)}'`;

export function writeLauncher({ file, node, cli }) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\nexec ${quote(node)} ${quote(cli)} "$@"\n`, { mode: 0o755 });
  chmodSync(file, 0o755);
  return file;
}
