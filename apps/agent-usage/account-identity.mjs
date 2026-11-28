import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cliHome, defaultCliHome } from './accounts.mjs';

async function readConfig(file, leadingComments = false) {
  try {
    const text = await readFile(file, 'utf8');
    return JSON.parse(leadingComments ? text.replace(/^(?:[^\S\r\n]*\/\/[^\r\n]*\r?\n)+/, '') : text);
  } catch {
    return undefined;
  }
}

function email(value) {
  return typeof value === 'string' && value.length <= 254 &&
    /^[^\s\p{C}@]+@[^\s\p{C}@]+$/u.test(value) ? value : undefined;
}

export async function readAccountLogin(provider, home, env) {
  if (provider === 'claude') {
    const scoped = await readConfig(path.join(home, '.claude.json'));
    const login = email(scoped?.oauthAccount?.emailAddress);
    if (login || home !== defaultCliHome(provider, env)) return login;
    const legacy = await readConfig(path.join(home, '..', '.claude.json'));
    return email(legacy?.oauthAccount?.emailAddress);
  }
  if (provider === 'codex') {
    const auth = await readConfig(path.join(home, 'auth.json'));
    if (typeof auth?.tokens?.id_token !== 'string') return undefined;
    const parts = auth.tokens.id_token.split('.');
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return undefined;
    try {
      return email(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.email);
    } catch {
      return undefined;
    }
  }
  if (provider === 'copilot') {
    const config = await readConfig(path.join(home, 'config.json'), true);
    const user = config?.lastLoggedInUser ??
      (config?.loggedInUsers?.length === 1 ? config.loggedInUsers[0] : undefined);
    const login = user?.login;
    return typeof login === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(login) ? login : undefined;
  }
  if (provider === 'agy') {
    const scoped = await readConfig(path.join(home, 'google_accounts.json'));
    const login = email(scoped?.active);
    if (login || home !== defaultCliHome(provider, env)) return login;
    return email((await readConfig(path.join(home, '..', 'google_accounts.json')))?.active);
  }
  return undefined;
}

export async function discoverAccounts(provider, manual, managed, env) {
  const currentHome = cliHome(provider, env);
  const defaultHome = defaultCliHome(provider, env);
  const local = [{ kind: 'current', home: currentHome }];
  if (defaultHome !== currentHome) local.push({ kind: 'default', home: defaultHome });
  const profiles = [
    ...local,
    ...manual.map(account => ({ ...account, kind: 'manual' })),
    ...managed.map(account => ({ ...account, kind: 'managed' })),
  ];
  const logins = new Map(profiles.map(({ home }) => [home, undefined]));
  await Promise.all([...logins.keys()].map(async home => {
    logins.set(home, await readAccountLogin(provider, home, env));
  }));
  return {
    currentLogin: logins.get(currentHome),
    profiles: profiles.map(profile => ({ ...profile, login: logins.get(profile.home) }))
      .filter(profile => profile.login || profile.kind === 'manual' || profile.kind === 'managed'),
  };
}
