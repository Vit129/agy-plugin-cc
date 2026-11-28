import os from 'node:os';
import path from 'node:path';

export const accountHomeVariables = Object.freeze({
  claude: 'CLAUDE_CONFIG_DIR', copilot: 'COPILOT_HOME', codex: 'CODEX_HOME',
});

const defaultHomePaths = {
  claude: '.claude', copilot: '.copilot', codex: '.codex', agy: '.gemini/antigravity-cli',
};

export function defaultCliHome(provider, env) {
  return path.resolve(env.HOME || os.homedir(), defaultHomePaths[provider]);
}

export function cliHome(provider, env) {
  const variable = provider === 'agy' ? 'AGY_HOME' : accountHomeVariables[provider];
  return env[variable] ? path.resolve(env[variable]) : defaultCliHome(provider, env);
}

const authOverrides = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_SESSION_ACCESS_TOKEN'],
  copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
  codex: ['CODEX_API_KEY', 'OPENAI_API_KEY', 'CODEX_ACCESS_TOKEN'],
};
const accountFields = ['id', 'label', 'home'];
const controlCharacters = /[\u0000-\u001f\u007f]/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeHome(home) {
  const expanded = home.startsWith('~/') ? path.join(os.homedir(), home.slice(2)) : home;
  return path.isAbsolute(expanded) ? path.resolve(expanded) : null;
}

export function normalizeAccounts(input = {}) {
  if (!isObject(input)) return null;
  const accounts = {};
  for (const [provider, profiles] of Object.entries(input)) {
    if (!Object.hasOwn(accountHomeVariables, provider) || !Array.isArray(profiles)) return null;
    const ids = new Set();
    const homes = new Set();
    const normalized = [];
    for (const account of profiles) {
      if (!isObject(account) || Object.keys(account).length !== accountFields.length ||
        !accountFields.every(key => Object.hasOwn(account, key) && typeof account[key] === 'string')) return null;
      const { id, label, home } = account;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || id === 'default' || ids.has(id)) return null;
      if (!label.trim() || label.length > 80 || controlCharacters.test(label)) return null;
      if (!home || home.length > 4096 || controlCharacters.test(home)) return null;
      const directory = normalizeHome(home);
      if (!directory || homes.has(directory)) return null;
      ids.add(id);
      homes.add(directory);
      normalized.push({ id, label: label.trim(), home: directory });
    }
    accounts[provider] = normalized;
  }
  return accounts;
}

export function accountsForProvider(settings, provider) {
  const manual = settings.accounts?.[provider] ?? [];
  const managed = settings.managedAccounts?.[provider] ?? [];
  return [...(manual.length ? manual : [null]), ...managed];
}

export function accountAuthOverrides(provider) {
  return authOverrides[provider];
}

export function accountEnvironment(provider, account, env) {
  if (!account) return env;
  const scoped = { ...env, [accountHomeVariables[provider]]: account.home };
  // Use the profile's saved authentication, which inherited tokens can override.
  for (const key of accountAuthOverrides(provider)) delete scoped[key];
  return scoped;
}
