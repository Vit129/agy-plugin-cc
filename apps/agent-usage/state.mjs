import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function stateDirectory(env = process.env) {
  if (env.AGENT_USAGE_STATE_DIR) return env.AGENT_USAGE_STATE_DIR;
  return path.join(env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'agent-usage');
}

export function readState(directory, file, fallback) {
  try {
    return JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') process.stderr.write(`Agent Usage · ${file}: ${error.message}\n`);
    return fallback;
  }
}

export function writeState(directory, file, value) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, file);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, destination);
}
