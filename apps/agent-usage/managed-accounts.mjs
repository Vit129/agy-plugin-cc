import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { accountAuthOverrides, accountHomeVariables } from './accounts.mjs';
import { executable } from './provider-quota.mjs';

const run = promisify(execFile);
const marker = '.agent-usage-managed';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const commands = { claude: ['auth', 'login'], codex: ['login'], copilot: ['login'] };
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export function isManagedProvider(provider) {
  return typeof provider === 'string' && Object.hasOwn(accountHomeVariables, provider);
}

export function isManagedId(id) {
  return typeof id === 'string' && uuid.test(id);
}

export async function openTerminalLogin({ provider, home, variable, args, env }) {
  if (process.platform !== 'darwin') throw new Error('Terminal is unavailable.');
  const envArgs = (accountAuthOverrides(provider) ?? []).flatMap(key => ['-u', key]);
  if (variable) envArgs.push(`${variable}=${home}`);
  if (provider === 'agy' && env.AGY_HOME) envArgs.push(`AGY_HOME=${path.resolve(env.AGY_HOME)}`);
  const argv = ['/usr/bin/env', ...envArgs, executable(provider, env), ...args];
  const command = `cd ${shellQuote(home)} && ${argv.map(shellQuote).join(' ')}`;
  await run('/usr/bin/osascript', ['-e', `on run argv
    tell application "Terminal"
      activate
      do script ("/bin/sh -c " & quoted form of (item 1 of argv))
    end tell
  end run`, command], { timeout: 15_000 });
}

export async function openAgySignIn(env, openLogin) {
  try {
    await openLogin({ provider: 'agy', home: env.HOME || homedir(), args: [], env });
    return { status: 200, opened: true };
  } catch {
    return { status: 503, error: 'Could not open the CLI sign-in in macOS Terminal.' };
  }
}

function providerDirectory(directory, provider, create = false) {
  const root = path.join(directory, 'accounts');
  const providerRoot = path.join(root, provider);
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const folder of [root, providerRoot]) {
    try {
      if (create) {
        try { mkdirSync(folder, { mode: 0o700 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      if (!lstatSync(folder).isDirectory()) return undefined;
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
  return providerRoot;
}

function ownsHome(home) {
  try {
    return lstatSync(home).isDirectory() && lstatSync(path.join(home, marker)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function managedHomes(directory, provider) {
  if (!isManagedProvider(provider)) return [];
  const parent = providerDirectory(directory, provider);
  if (!parent) return [];
  return readdirSync(parent).filter(isManagedId).sort().flatMap(id => {
    const home = path.join(parent, id);
    return ownsHome(home) ? [{ id, home }] : [];
  });
}

export async function createManagedHome(directory, provider, env, openLogin) {
  const parent = providerDirectory(directory, provider, true);
  if (!parent) return { status: 409, error: 'Managed account storage must use local directories.' };
  const id = randomUUID();
  const home = path.join(parent, id);
  mkdirSync(home, { mode: 0o700 });
  try {
    await openLogin({ provider, home, variable: accountHomeVariables[provider], args: commands[provider], env });
    writeFileSync(path.join(home, marker), '', { mode: 0o600, flag: 'wx' });
    return { status: 201, id };
  } catch {
    // The directory was created for this request. Never follow replacements or symlinks.
    if (providerDirectory(directory, provider) === parent && lstatSync(home, { throwIfNoEntry: false })?.isDirectory()) {
      rmSync(home, { recursive: true, force: true });
    }
    return { status: 503, error: 'Could not open the CLI sign-in in macOS Terminal.' };
  }
}

export function removeManagedHome(directory, provider, id) {
  const parent = providerDirectory(directory, provider);
  if (!parent) return false;
  const home = path.join(parent, id);
  if (!ownsHome(home)) return false;
  rmSync(home, { recursive: true });
  return true;
}
