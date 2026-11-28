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

const planLabels = new Map(Object.entries({
  free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', max: 'Max', max_5x: 'Max 5×', max_20x: 'Max 20×',
  ultra: 'Ultra', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu',
}));

function claudeIdentity(config) {
  const account = config?.oauthAccount;
  const login = email(account?.emailAddress);
  const organization = account?.organizationType;
  const tier = typeof organization === 'string' && organization.startsWith('claude_') ? organization.slice(7) : undefined;
  const accountUuid = typeof account?.accountUuid === 'string' ? account.accountUuid : undefined;
  return {
    login, plan: planLabels.get(account?.seatTier) ?? planLabels.get(tier),
    accountUuid, resetCache: config?.unusedLimitResetStatusCache,
  };
}

async function readAccountIdentity(provider, home, env) {
  if (provider === 'claude') {
    const scoped = claudeIdentity(await readConfig(path.join(home, '.claude.json')));
    if (home !== defaultCliHome(provider, env)) return scoped;
    const legacy = claudeIdentity(await readConfig(path.join(home, '..', '.claude.json')));
    if (!scoped.accountUuid && !scoped.login) return legacy;
    if (scoped.accountUuid && scoped.accountUuid === legacy.resetCache?.accountUuid && !scoped.resetCache) {
      return { ...scoped, resetCache: legacy.resetCache };
    }
    return scoped;
  }
  if (provider === 'codex') {
    const auth = await readConfig(path.join(home, 'auth.json'));
    if (typeof auth?.tokens?.id_token !== 'string') return {};
    const parts = auth.tokens.id_token.split('.');
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return {};
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return {
        login: email(payload?.email),
        plan: planLabels.get(payload?.['https://api.openai.com/auth']?.chatgpt_plan_type),
      };
    } catch {
      return {};
    }
  }
  if (provider === 'copilot') {
    const config = await readConfig(path.join(home, 'config.json'), true);
    const user = config?.lastLoggedInUser ??
      (config?.loggedInUsers?.length === 1 ? config.loggedInUsers[0] : undefined);
    const login = user?.login;
    return { login: typeof login === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(login) ? login : undefined };
  }
  if (provider === 'agy') {
    const scoped = await readConfig(path.join(home, 'google_accounts.json'));
    const login = email(scoped?.active);
    if (login || home !== defaultCliHome(provider, env)) return { login };
    return { login: email((await readConfig(path.join(home, '..', 'google_accounts.json')))?.active) };
  }
  return {};
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
  const homes = new Set(profiles.map(profile => profile.home));
  const identities = new Map(await Promise.all([...homes].map(async home => {
    return [home, await readAccountIdentity(provider, home, env)];
  })));
  return {
    current: identities.get(currentHome),
    profiles: profiles.map(profile => ({ ...profile, ...identities.get(profile.home) }))
      .filter(profile => profile.login || profile.accountUuid || profile.kind === 'manual' || profile.kind === 'managed'),
  };
}
