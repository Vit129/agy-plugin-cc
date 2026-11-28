import { providerMark } from './provider-icons.mjs';
import { availableResetCredits, creditExpiryLabel } from './reset-credits.mjs';

const labels = { healthy: 'Healthy', watch: 'Watch', low: 'Low', critical: 'Critical', unknown: 'Unavailable' };
const states = { live: 'Live', aging: 'Stale', reset_assumed: 'Awaiting fresh quota', exhausted: 'Cooldown reported', unknown: 'Unavailable' };
const severity = { watch: 1, low: 2, critical: 3 };
const windows = { '5h': '5-hour window', '7d': '7-day window', monthly: 'Monthly credits' };
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const clock = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const localClock = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
const notificationError = document.querySelector('#alert-details');
const form = document.querySelector('#quota-settings');
const providerSwitches = [...form.querySelectorAll('[data-monitor-provider]')];
const titleProviders = [...form.querySelectorAll('[data-title-provider]')];
const settingToggles = [...form.querySelectorAll('[data-setting-toggle]')];
const settingMirrors = [...form.querySelectorAll('[data-setting-mirror]')];
const accountSettings = form.querySelector('.account-settings');
const accountGroups = [...accountSettings.querySelectorAll('[data-account-provider]')];
const manualGroups = [...accountSettings.querySelectorAll('[data-manual-provider]')];
const accountResult = document.querySelector('#account-result');
const accountTemplate = form.querySelector('#account-row-template');
const creditSettings = form.querySelector('#claude-credit-settings');
const dialog = document.querySelector('.settings-dialog');
const settingsNav = form.querySelector('.settings-nav');
const settingsTabs = [...settingsNav.querySelectorAll('[role="tab"]')];
const narrowSettings = matchMedia('(max-width: 620px)');
const modelButtons = [...document.querySelectorAll('[data-model-days]')];
for (const mark of document.querySelectorAll('[data-provider-icon]')) {
  mark.innerHTML = providerMark(mark.dataset.providerIcon);
}
let settings;
let claudeCreditAccounts = [];
let modelRequest = 0;
let quotaRequest = 0;
let savingSettings = false;
const inventoryKeys = new WeakMap();

function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function request(endpoint, options) {
  const response = await fetch(endpoint, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

function chip(level, text = labels[level]) {
  return `<span class="level-label level" data-level="${level}"><span class="dot" aria-hidden="true"></span>${escapeHTML(text)}</span>`;
}

function renderSchedule(schedule, checks) {
  const output = document.querySelector('#reset-checks');
  if (!schedule?.times?.length) {
    output.innerHTML = '<li><span>No scheduled checks.</span></li>';
    return;
  }
  output.innerHTML = schedule.times.map(time => {
    const result = checks[time];
    let status = 'Scheduled';
    if (result?.checkedAt) status = result.windows.some(window => window.state === 'live') ? 'Checked · fresh snapshot found' : 'Checked · waiting for fresh quota';
    if (result?.missedAt) status = 'Missed';
    if (result?.skippedAt) status = 'Skipped · no providers enabled';
    return `<li><time datetime="${new Date(time).toISOString()}">${localClock.format(time)} ICT</time><span>${status}</span></li>`;
  }).join('');
}

function displayQuotaPercent(remaining) {
  return Math.floor(remaining);
}

function renderResetCredits(quota) {
  const panel = document.querySelector('#reset-credits');
  const now = Date.now();
  let showClaudeUsage = false;
  const rows = quota.flatMap(row => {
    const summary = row.rateLimitResetCredits;
    const available = availableResetCredits(summary, now).sort((first, second) =>
      (first.expiresAt ?? Infinity) - (second.expiresAt ?? Infinity));
    if (summary?.credits === null && summary.availableCount > 0) {
      return [`<li><span>${escapeHTML(row.label)}</span><span>${summary.availableCount} available · expiry details unavailable</span></li>`];
    }
    return available.map(credit => {
      if (credit.provider === 'claude') showClaudeUsage = true;
      const account = row.accountId || credit.provider === 'claude' ? `${escapeHTML(row.label)} · ` : '';
      const label = creditExpiryLabel(credit.expiresAt, now).replace(/^expires /, 'Expires ');
      const expiry = credit.expiresAt === null ? label : `<time datetime="${new Date(credit.expiresAt * 1000).toISOString()}">${escapeHTML(label)}</time>`;
      return `<li><span>${account}${escapeHTML(credit.title || 'Rate limit reset')} · ${expiry}</span></li>`;
    });
  });
  panel.hidden = rows.length === 0;
  panel.querySelector('ul').innerHTML = rows.join('');
  panel.querySelector('a').hidden = !showClaudeUsage;
}

function renderQuota(data) {
  settings = data.settings;
  claudeCreditAccounts = data.claudeFullResetAccounts ?? [];
  const { quota, schedule, checks, routes } = data;
  const active = new Set(data.active?.map(entry => entry.provider));
  renderAccountInventory(data.accounts ?? {});
  const alerts = [];
  document.querySelector('.plan-columns').hidden = quota.length === 0;
  document.querySelector('.legend').innerHTML = ['watch', 'low', 'critical'].map(level => chip(level, `${labels[level]} ≤${settings[level]}%`)).join('');
  document.querySelector('#quota-rows').innerHTML = quota.map(row => {
    const bars = row.windows.map(window => {
      if (window.state === 'live' && severity[window.level]) alerts.push({ ...window, provider: row.label });
      const level = window.state === 'live' ? window.level : 'unknown';
      const label = window.state === 'live' ? labels[level] : states[window.state] || states.unknown;
      const amount = window.remaining === null ? '—' : `${displayQuotaPercent(window.remaining)}%`;
      const resetPrefix = window.state === 'reset_assumed' ? 'Last reported reset' : 'Resets';
      const reset = Number.isFinite(window.resetsAt) && window.resetsAt > 0 ? `${resetPrefix} ${clock.format(window.resetsAt * 1000)}` : 'Reset time unavailable';
      const bar = window.remaining === null ? '<div class="rail" aria-hidden="true"></div>' : `<div class="rail" role="meter" aria-label="${escapeHTML(row.label)}, ${windows[window.short]} remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${displayQuotaPercent(window.remaining)}"><span style="width: ${window.remaining}%"></span></div>`;
      return `<div class="window level" data-window="${window.short}" data-level="${level}"><div class="window-head"><span><span class="mobile-window">${window.short === 'monthly' ? 'Monthly' : window.short} · </span><strong>${amount}</strong></span>${chip(level, label)}</div>${bar}<p class="reset">${reset}</p></div>`;
    }).join('');
    const captured = Number.isFinite(row.capturedAt) ? `Updated ${clock.format(row.capturedAt * 1000)}` : 'Waiting for a quota snapshot';
    const target = row.capacity === null ? 'unknown' : row.capacity >= settings.target ? 'met' : 'short';
    const status = row.state === 'error' ? chip('critical', `Error · ${row.error}`) : captured;
    const login = row.login ? `<small class="account-login">${escapeHTML(row.login)}</small>` : '';
    const badge = active.has(row.provider) ? '<span class="active-badge">Active now</span>' : '';
    return `<div class="plan-grid plan-row" data-provider="${row.provider}" data-state="${row.state ?? 'ready'}"><div class="plan-provider ${row.provider}"><h3 class="provider"><span class="provider-mark" aria-hidden="true">${providerMark(row.provider)}</span>${escapeHTML(row.label)}</h3>${login}${badge}<small>${status}</small></div>${bars}<div class="capacity" data-target="${target}"><strong>${row.capacity ?? '—'}</strong><span>sessions estimated · target ${settings.target}</span></div></div>`;
  }).join('');
  const directions = [
    { label: 'Claude→agy', requested: 'agy', decision: routes.claudeToAgy },
    { label: 'agy→Claude', requested: 'claude', decision: routes.agyToClaude },
  ].map(({ label, requested, decision }) => ({
    label, reason: escapeHTML(decision.reason),
    status: settings.autoRoute === false ? 'Off' : decision.target === requested ? 'Allowed' : 'Diverted',
  }));
  document.querySelector('#settings-route-state').innerHTML = directions.map(({ label, status, reason }) =>
    `<li><h4>${label} · ${status}</h4><p class="plan-caption">${reason}</p></li>`).join('');
  document.querySelector('#quota-routes').innerHTML = directions.map(({ label, status, reason }) =>
    `<div><strong>${label}</strong> · ${status} · ${reason}</div>`).join('');
  const anyLive = quota.some(row => row.windows.some(window => window.state === 'live'));
  alerts.sort((first, second) => severity[second.level] - severity[first.level]);
  document.querySelector('.notice').dataset.level = alerts[0]?.level ?? (anyLive ? 'healthy' : 'unknown');
  document.querySelector('#alert-title').textContent = quota.length === 0 ? 'No providers enabled'
    : alerts.length ? `${alerts.length} quota ${alerts.length === 1 ? 'alert' : 'alerts'}`
    : anyLive ? 'No active quota alerts' : 'Waiting for fresh quota';
  const remaining = alerts.map(alert => `${alert.provider} ${alert.short} · ${displayQuotaPercent(alert.remaining)}% ${labels[alert.level].toLowerCase()}`);
  if (data.notificationError) remaining.push('macOS notification delivery failed. See the local server log.');
  notificationError.textContent = remaining.join('  /  ');
  document.querySelector('#estimate-note').textContent = quota.length
    ? `Estimates assume ${settings.cost}% of quota per session. Enabled providers refresh every ${settings.refreshMinutes} min.`
    : 'Enable a provider in Settings to show its quota.';
  renderResetCredits(quota);
  renderSchedule(schedule, checks);
}

async function loadQuota() {
  if (savingSettings) return;
  const current = ++quotaRequest;
  try {
    const data = await request('/api/quota');
    if (quotaRequest === current) renderQuota(data);
  } catch {
    if (quotaRequest === current) document.querySelector('#alert-title').textContent = 'Local quota unavailable';
  }
}

async function loadModels(days) {
  const current = ++modelRequest;
  const output = document.querySelector('.model-table tbody');
  output.innerHTML = '<tr><td class="no-models" colspan="5">Reading local model usage…</td></tr>';
  try {
    const { models } = await request(`/api/models?days=${days}`);
    if (current !== modelRequest) return;
    const highest = models[0]?.tokens || 1;
    output.innerHTML = models.map(model => {
      const time = model.avgMs === null ? '—' : model.avgMs < 1000 ? `${Math.round(model.avgMs)}ms` : `${(model.avgMs / 1000).toFixed(1)}s`;
      const ok = model.okPct === null ? '—' : `${model.okPct}%`;
      const account = model.label ? `<small class="model-account">${escapeHTML(model.label)}</small>` : '';
      return `<tr class="${model.provider}"><th scope="row"><span class="model-label"><span class="dot" aria-hidden="true"></span>${escapeHTML(model.model)}</span>${account}</th><td class="model-numeric">${model.calls}</td><td class="model-numeric">${ok}</td><td><span class="model-tokens"><span>${compact.format(model.tokens)}</span><span class="rail" aria-hidden="true"><span style="width: ${model.tokens / highest * 100}%"></span></span></span></td><td class="model-numeric">${time}</td></tr>`;
    }).join('') || '<tr><td class="no-models" colspan="5">No model usage found in this range.</td></tr>';
  } catch {
    if (current === modelRequest) output.innerHTML = '<tr><td class="no-models" colspan="5">Could not read local model usage.</td></tr>';
  }
}

for (const button of modelButtons) {
  button.addEventListener('click', () => {
    for (const other of modelButtons) other.setAttribute('aria-pressed', String(other === button));
    void loadModels(Number(button.dataset.modelDays));
  });
}

function renderAccountInventory(accounts) {
  const kindLabel = { current: 'Current CLI account', default: 'Default folder', manual: 'Configured folder', managed: 'Managed account' };
  for (const group of accountGroups) {
    const provider = group.dataset.accountProvider;
    const profiles = (accounts[provider] ?? []).filter(profile => profile.login || profile.kind === 'managed');
    const key = JSON.stringify(profiles.map(({ id, login, kind }) => [id, login, kind]));
    if (inventoryKeys.get(group) === key) continue;
    inventoryKeys.set(group, key);
    const primary = profiles[0];
    const login = primary ? primary.login ?? 'Waiting for sign-in' : 'No sign-in detected';
    group.querySelector('.account-login').textContent = profiles.length > 1
      ? `${login} · +${profiles.length - 1} more`
      : login;
    const manual = manualGroups.find(group => group.dataset.manualProvider === provider);
    if (!manual) continue;
    manual.querySelector('.detected-accounts').innerHTML = profiles.map(profile => {
      const login = profile.login ?? 'Waiting for sign-in';
      const remove = profile.kind === 'managed'
        ? `<button class="action" type="button" data-remove-managed="${profile.id}" aria-label="Remove ${escapeHTML(login)}" data-testid="btn_removeManagedAccount-${profile.id}_monitorPage">Remove</button>`
        : '';
      return `<li><div><span class="account-login">${escapeHTML(login)}</span><small>${kindLabel[profile.kind]}</small></div>${remove}</li>`;
    }).join('');
  }
}

async function changeManagedAccount(provider, button) {
  const id = button.dataset.removeManaged;
  const removing = Boolean(id);
  if (removing && !window.confirm('Remove this managed account and delete its local CLI configuration and session files?')) return;
  button.disabled = true;
  accountResult.textContent = removing ? 'Removing managed account…' : 'Opening macOS Terminal…';
  try {
    const endpoint = removing ? '/api/accounts/remove' : '/api/accounts/sign-in';
    const body = removing ? { provider, id, confirm: true } : { provider };
    await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    accountResult.textContent = removing ? 'Managed account removed.' : 'Finish signing in in Terminal. The account will appear here when ready.';
    await loadQuota();
  } catch (error) {
    accountResult.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function addAccount(group, account = { id: crypto.randomUUID(), label: '', home: '' }) {
  const row = accountTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.accountId = account.id;
  const label = row.querySelector('[data-account-label]');
  const home = row.querySelector('[data-account-home]');
  const provider = group.dataset.manualProvider;
  label.value = account.label;
  home.value = account.home;
  label.dataset.testid = `txt_${provider}AccountLabel_monitorPage`;
  home.dataset.testid = `txt_${provider}AccountHome_monitorPage`;
  row.querySelector('[data-remove-account]').dataset.testid = `btn_remove${provider[0].toUpperCase()}${provider.slice(1)}Account_monitorPage`;
  group.querySelector('.account-rows').append(row);
  return label;
}

function localDateTime(expiresAt) {
  if (!expiresAt) return '';
  const date = new Date(expiresAt);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function renderClaudeCreditSettings() {
  document.querySelector('#claude-credit-prompt').hidden =
    claudeCreditAccounts.length > 0 && claudeCreditAccounts.every(account => account.expiresAt);
  const [primary, ...additional] = claudeCreditAccounts.map(account => {
    const id = account.accountUuid;
    const login = escapeHTML(account.login ?? 'Claude account');
    const value = localDateTime(account.expiresAt);
    const status = { available: 'Available', used: 'Used', unknown: 'Status unknown' }[account.status];
    return `<div class="claude-credit-row" data-credit-account="${id}" data-saved-expiry="${account.expiresAt ?? ''}">
      <label>Claude full reset expires <small>${login}</small><input type="datetime-local" value="${value}" data-testid="txt_claudeFullResetExpiry-${id}_monitorPage"></label>
      <button type="button" class="action" data-credit-used data-testid="btn_claudeFullResetUsed-${id}_monitorPage" ${!value || account.used ? 'disabled' : ''}>Used it</button>
      <small role="status">${value ? status : ''}</small>
    </div>`;
  });
  creditSettings.innerHTML = primary ?? '';
  if (additional.length) {
    creditSettings.insertAdjacentHTML('beforeend', `<details class="account-advanced">
      <summary data-testid="btn_additionalClaudeCredits_monitorPage">Other Claude accounts</summary>
      ${additional.join('')}
    </details>`);
  }
}

creditSettings.addEventListener('click', async event => {
  const button = event.target.closest('[data-credit-used]');
  if (!button || savingSettings) return;
  const row = button.closest('[data-credit-account]');
  const account = claudeCreditAccounts.find(item => item.accountUuid === row.dataset.creditAccount);
  const status = row.querySelector('[role=status]');
  if (!account?.expiresAt || account.expiresAt !== row.dataset.savedExpiry) {
    status.textContent = 'Expiry changed. Reopen Settings to view it.';
    return;
  }
  const field = row.querySelector('input');
  if (field.value !== field.defaultValue) {
    status.textContent = 'Save the new expiry before marking it used.';
    return;
  }
  savingSettings = true;
  button.disabled = true;
  try {
    ++quotaRequest;
    const response = await request('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeFullReset: { [account.accountUuid]: { expiresAt: account.expiresAt, used: true } } }),
    });
    renderQuota(response);
    const current = claudeCreditAccounts.find(item => item.accountUuid === account.accountUuid);
    status.textContent = current?.status === 'available' ? 'Available · CLI status is current' : 'Used';
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  } finally {
    savingSettings = false;
  }
});

accountSettings.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const group = button.closest('[data-manual-provider]');
  if (button.matches('[data-sign-in]')) void changeManagedAccount(button.closest('[data-account-provider]').dataset.accountProvider, button);
  if (button.matches('[data-remove-managed]')) void changeManagedAccount(group.dataset.manualProvider, button);
  if (button.hasAttribute('data-add-account')) addAccount(group).focus();
  if (button.hasAttribute('data-remove-account')) {
    button.closest('.account-row').remove();
    group.querySelector('[data-add-account]').focus();
  }
});

function selectSettingsTab(selected) {
  for (const tab of settingsTabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  }
}

function updateSettingsOrientation() {
  settingsNav.setAttribute('aria-orientation', narrowSettings.matches ? 'horizontal' : 'vertical');
}

updateSettingsOrientation();
narrowSettings.addEventListener('change', updateSettingsOrientation);
settingsNav.addEventListener('click', event => {
  if (settingsTabs.includes(event.target)) selectSettingsTab(event.target);
});
settingsNav.addEventListener('keydown', event => {
  const index = settingsTabs.indexOf(event.target);
  if (index < 0) return;
  const [previous, next] = narrowSettings.matches ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  const target = {
    Home: 0,
    End: settingsTabs.length - 1,
    [previous]: (index - 1 + settingsTabs.length) % settingsTabs.length,
    [next]: (index + 1) % settingsTabs.length,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  selectSettingsTab(settingsTabs[target]);
  settingsTabs[target].focus();
});

for (const mirror of settingMirrors) {
  const field = form.elements.namedItem(mirror.dataset.settingMirror);
  field.addEventListener('input', () => { mirror.value = field.value; });
  mirror.addEventListener('input', () => { field.value = mirror.value; });
}

document.querySelector('#open-settings').addEventListener('click', () => {
  if (!settings) return;
  for (const field of form.querySelectorAll('input[type="number"][name]')) field.value = settings[field.name];
  for (const mirror of settingMirrors) mirror.value = settings[mirror.dataset.settingMirror];
  for (const input of providerSwitches) input.checked = settings.providers[input.dataset.monitorProvider];
  for (const input of titleProviders) input.checked = settings.titleProviders?.[input.dataset.titleProvider] ?? true;
  const toggleDefaults = { thresholdWarnings: true, paceWarnings: false, resetCreditReminders: true, notificationSound: false, autoRoute: true };
  for (const input of settingToggles) input.checked = settings[input.dataset.settingToggle] ?? toggleDefaults[input.dataset.settingToggle];
  for (const group of manualGroups) {
    group.querySelector('.account-rows').replaceChildren();
    for (const account of settings.accounts?.[group.dataset.manualProvider] ?? []) addAccount(group, account);
  }
  renderClaudeCreditSettings();
  for (const details of form.querySelectorAll('details[open]')) details.open = false;
  accountResult.textContent = '';
  document.querySelector('#notification-result').textContent = '';
  form.querySelector('.form-error').textContent = '';
  selectSettingsTab(settingsTabs[0]);
  dialog.showModal();
  settingsTabs[0].focus();
});
document.querySelector('#cancel-settings').addEventListener('click', () => dialog.close());
const testNotification = document.querySelector('#test-notification');
testNotification.addEventListener('click', async () => {
  const result = document.querySelector('#notification-result');
  testNotification.disabled = true;
  try {
    await request('/api/notifications/test', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    result.textContent = 'Test sent to macOS Notification Center.';
  } catch {
    result.textContent = 'Test delivery failed. Check the Agent Usage server log.';
  } finally {
    testNotification.disabled = false;
  }
});
function revealSettingsField(field) {
  const panel = field.closest('[role="tabpanel"]');
  selectSettingsTab(document.getElementById(panel.getAttribute('aria-labelledby')));
  for (let parent = field.parentElement; parent !== panel; parent = parent.parentElement) {
    if (parent.matches('details')) parent.open = true;
  }
  field.focus();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (savingSettings) return;
  const invalid = form.querySelector('input:invalid');
  if (invalid) {
    revealSettingsField(invalid);
    invalid.reportValidity();
    return;
  }
  const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, Number(value)]));
  const formError = form.querySelector('.form-error');
  if (!(values.critical < values.low && values.low < values.watch)) {
    revealSettingsField(form.elements.namedItem(values.critical >= values.low ? 'critical' : 'watch'));
    formError.textContent = 'Critical must be below warning, and warning below watch.';
    return;
  }
  formError.textContent = '';
  const claudeFullReset = {};
  for (const row of creditSettings.querySelectorAll('[data-credit-account]')) {
    const id = row.dataset.creditAccount;
    const field = row.querySelector('input');
    const value = field.value;
    if (value === field.defaultValue) continue;
    const date = new Date(value);
    if (value && (!Number.isFinite(date.getTime()) || localDateTime(date) !== value)) {
      revealSettingsField(field);
      formError.textContent = 'Enter a valid expiry in your local time.';
      return;
    }
    claudeFullReset[id] = { expiresAt: value ? date.toISOString() : null, used: false };
  }
  if (Object.keys(claudeFullReset).length) values.claudeFullReset = claudeFullReset;
  values.providers = Object.fromEntries(providerSwitches.map(input => [input.dataset.monitorProvider, input.checked]));
  values.titleProviders = Object.fromEntries(titleProviders.map(input => [input.dataset.titleProvider, input.checked]));
  for (const input of settingToggles) values[input.dataset.settingToggle] = input.checked;
  values.accounts = Object.fromEntries(manualGroups.map(group => [
    group.dataset.manualProvider,
    [...group.querySelectorAll('.account-row')].map(row => ({
      id: row.dataset.accountId,
      label: row.querySelector('[data-account-label]').value,
      home: row.querySelector('[data-account-home]').value,
    })),
  ]));
  const submitButton = form.querySelector('[type=submit]');
  savingSettings = true;
  submitButton.disabled = true;
  try {
    const current = ++quotaRequest;
    const response = await request('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    if (quotaRequest === current) renderQuota(response);
    void loadModels(Number(modelButtons.find(button => button.getAttribute('aria-pressed') === 'true').dataset.modelDays));
    dialog.close();
  } catch (error) {
    formError.textContent = error.message;
  } finally {
    savingSettings = false;
    submitButton.disabled = false;
  }
});

const theme = document.querySelector('.theme');
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  theme.setAttribute('aria-pressed', String(dark));
  theme.textContent = dark ? 'Light mode' : 'Dark mode';
}
theme.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme !== 'dark'));
applyTheme(true);
void loadQuota();
void loadModels(7);
setInterval(loadQuota, 15_000);
