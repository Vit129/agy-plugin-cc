import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fallbackNodeDirs = ['/opt/homebrew/bin', '/usr/local/bin'];

// Prefer a node path that survives Homebrew upgrades (the Cellar path is versioned).
// A candidate qualifies only when it resolves to the same binary that is running now.
export function stableNodePath({ execPath, pathEnv = '', realpath = realpathSync }) {
  const target = realpath(execPath);
  const dirs = [...fallbackNodeDirs, ...pathEnv.split(path.delimiter).filter(Boolean)];
  for (const dir of dirs) {
    const candidate = path.join(dir, 'node');
    try {
      if (realpath(candidate) === target) return candidate;
    } catch {
      // Not present or not readable: try the next directory.
    }
  }
  return execPath;
}

const quote = value => `'${String(value).replaceAll("'", `'\\''`)}'`;

export function writeLauncher({ file, node, cli }) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\nexec ${quote(node)} ${quote(cli)} "$@"\n`, { mode: 0o755 });
  chmodSync(file, 0o755);
  return file;
}
