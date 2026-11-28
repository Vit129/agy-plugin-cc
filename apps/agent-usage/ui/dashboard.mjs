import { providerMark } from './provider-icons.mjs';
import { accountKindLabels, creditStatusLabels, format, levelLabels, text } from './ui/strings.mjs';
import { parseSettingsHash, quotaViewModel } from './view-model.mjs';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
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

function chip(level, label = levelLabels[level]) {
  return `<span class="level-label level" data-level="${level}"><span class="dot" aria-hidden="true"></span>${escapeHTML(label)}</span>`;
}

function renderSchedule(rows) {
  const output = document.querySelector('#reset-checks');
  if (!rows.length) {
    output.innerHTML = `<li><span>${text.noScheduledChecks}</span></li>`;
    return;
  }
  output.innerHTML = rows.map(({ iso, time, status }) => `<li><time datetime="${iso}">${time}</time><span>${status}</span></li>`).join('');
}

function renderResetCredits({ rows, showClaudeUsage }) {
  const panel = document.querySelector('#reset-credits');
  const items = rows.map(row => {
    if (row.kind === 'summary') return `<li><span>${escapeHTML(row.label)}</span><span>${row.text}</span></li>`;
    const account = row.account ? `${escapeHTML(row.account)} · ` : '';
    const expiry = row.expiresAtIso === null ? row.expiry : `<time datetime="${row.expiresAtIso}">${escapeHTML(row.expiry)}</time>`;
    return `<li><span>${account}${escapeHTML(row.title)} · ${expiry}</span></li>`;
  });
  panel.hidden = items.length === 0;
  panel.querySelector('ul').innerHTML = items.join('');
  panel.querySelector('a').hidden = !showClaudeUsage;
}

function renderWindow(window) {
  const bar = window.meter
    ? `<div class="rail" role="meter" aria-label="${escapeHTML(window.meter.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${window.meter.value}"><span style="width: ${window.meter.percent}%"></span></div>`
    : '<div class="rail" aria-hidden="true"></div>';
  return `<div class="window level" data-window="${window.short}" data-level="${window.level}"><div class="window-head"><span><span class="mobile-window">${window.mobileName} · </span><strong>${window.amount}</strong></span>${chip(window.level, window.label)}</div>${bar}<p class="reset">${window.resetText}</p></div>`;
}

function renderRow(row) {
  const status = row.status.level ? chip(row.status.level, row.status.text) : row.status.text;
  const login = row.login ? `<small class="account-login">${escapeHTML(row.login)}</small>` : '';
  const badge = row.active ? `<span class="active-badge">${text.activeNow}</span>` : '';
  return `<div class="plan-grid plan-row" data-provider="${row.provider}" data-state="${row.state}"><div class="plan-provider ${row.provider}"><h3 class="provider"><span class="provider-mark" aria-hidden="true">${providerMark(row.provider)}</span>${escapeHTML(row.label)}</h3>${login}${badge}<small>${status}</small></div>${row.windows.map(renderWindow).join('')}<div class="capacity" data-target="${row.capacity.target}"><strong>${row.capacity.value}</strong><span>${row.capacity.note}</span></div></div>`;
}

function renderQuota(data) {
  settings = data.settings;
  claudeCreditAccounts = data.claudeFullResetAccounts ?? [];
  const view = quotaViewModel(data);
  renderAccountInventory(data.accounts ?? {});
  document.querySelector('.plan-columns').hidden = !view.hasProviders;
  document.querySelector('.legend').innerHTML = view.legend.map(({ level, text: label }) => chip(level, label)).join('');
  document.querySelector('#quota-rows').innerHTML = view.rows.map(renderRow).join('');
  document.querySelector('#settings-route-state').innerHTML = view.routes.map(({ label, status, reason }) =>
    `<li><h4>${label} · ${status}</h4><p class="plan-caption">${escapeHTML(reason)}</p></li>`).join('');
  document.querySelector('#quota-routes').innerHTML = view.routes.map(({ label, status, reason }) =>
    `<div><strong>${label}</strong> · ${status} · ${escapeHTML(reason)}</div>`).join('');
  document.querySelector('.notice').dataset.level = view.noticeLevel;
  document.querySelector('#alert-title').textContent = view.alertTitle;
  notificationError.textContent = view.alertDetails;
  document.querySelector('#estimate-note').textContent = view.estimateNote;
  renderResetCredits(view.credits);
  renderSchedule(view.schedule);
}

async function loadQuota() {
  if (savingSettings) return;
  const current = ++quotaRequest;
  try {
    const data = await request('/api/quota');
    if (quotaRequest === current) renderQuota(data);
  } catch {
    if (quotaRequest === current) document.querySelector('#alert-title').textContent = text.localQuotaUnavailable;
  }
}

async function loadModels(days) {
  const current = ++modelRequest;
  const output = document.querySelector('.model-table tbody');
  output.innerHTML = `<tr><td class="no-models" colspan="5">${text.readingModels}</td></tr>`;
  try {
    const { models } = await request(`/api/models?days=${days}`);
    if (current !== modelRequest) return;
    const highest = models[0]?.tokens || 1;
    output.innerHTML = models.map(model => {
      const time = model.avgMs === null ? '—' : model.avgMs < 1000 ? `${Math.round(model.avgMs)}ms` : `${(model.avgMs / 1000).toFixed(1)}s`;
      const ok = model.okPct === null ? '—' : `${model.okPct}%`;
      const account = model.label ? `<small class="model-account">${escapeHTML(model.label)}</small>` : '';
      return `<tr class="${model.provider}"><th scope="row"><span class="model-label"><span class="dot" aria-hidden="true"></span>${escapeHTML(model.model)}</span>${account}</th><td class="model-numeric">${model.calls}</td><td class="model-numeric">${ok}</td><td><span class="model-tokens"><span>${compact.format(model.tokens)}</span><span class="rail" aria-hidden="true"><span style="width: ${model.tokens / highest * 100}%"></span></span></span></td><td class="model-numeric">${time}</td></tr>`;
    }).join('') || `<tr><td class="no-models" colspan="5">${text.noModels}</td></tr>`;
  } catch {
    if (current === modelRequest) output.innerHTML = `<tr><td class="no-models" colspan="5">${text.modelsFailed}</td></tr>`;
  }
}

for (const button of modelButtons) {
  button.addEventListener('click', () => {
    for (const other of modelButtons) other.setAttribute('aria-pressed', String(other === button));
    void loadModels(Number(button.dataset.modelDays));
  });
}

function renderAccountInventory(accounts) {
  for (const group of accountGroups) {
    const provider = group.dataset.accountProvider;
    const profiles = (accounts[provider] ?? []).filter(profile => profile.login || profile.kind === 'managed');
    const key = JSON.stringify(profiles.map(({ id, login, kind }) => [id, login, kind]));
    if (inventoryKeys.get(group) === key) continue;
    inventoryKeys.set(group, key);
    const primary = profiles[0];
    const login = primary ? primary.login ?? text.waitingForSignIn : text.noSignIn;
    group.querySelector('.account-login').textContent = profiles.length > 1
      ? format.accountMore(login, profiles.length - 1)
      : login;
    const manual = manualGroups.find(group => group.dataset.manualProvider === provider);
    if (!manual) continue;
    manual.querySelector('.detected-accounts').innerHTML = profiles.map(profile => {
      const login = profile.login ?? text.waitingForSignIn;
      const remove = profile.kind === 'managed'
        ? `<button class="action" type="button" data-remove-managed="${profile.id}" aria-label="${escapeHTML(format.removeAccount(login))}" data-testid="btn_removeManagedAccount-${profile.id}_monitorPage">${text.remove}</button>`
        : '';
      return `<li><div><span class="account-login">${escapeHTML(login)}</span><small>${accountKindLabels[profile.kind]}</small></div>${remove}</li>`;
    }).join('');
  }
}

async function changeManagedAccount(provider, button) {
  const id = button.dataset.removeManaged;
  const removing = Boolean(id);
  if (removing && !window.confirm(text.confirmRemoveAccount)) return;
  button.disabled = true;
  accountResult.textContent = removing ? text.removingAccount : text.openingTerminal;
  try {
    const endpoint = removing ? '/api/accounts/remove' : '/api/accounts/sign-in';
    const body = removing ? { provider, id, confirm: true } : { provider };
    await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    accountResult.textContent = removing ? text.accountRemoved : text.finishSignIn;
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
    const login = escapeHTML(account.login ?? text.claudeAccount);
    const value = localDateTime(account.expiresAt);
    const status = creditStatusLabels[account.status];
    return `<div class="claude-credit-row" data-credit-account="${id}" data-saved-expiry="${account.expiresAt ?? ''}">
      <label>${text.claudeFullResetExpires} <small>${login}</small><input type="datetime-local" value="${value}" data-testid="txt_claudeFullResetExpiry-${id}_monitorPage"></label>
      <button type="button" class="action" data-credit-used data-testid="btn_claudeFullResetUsed-${id}_monitorPage" ${!value || account.used ? 'disabled' : ''}>${text.usedIt}</button>
      <small role="status">${value ? status : ''}</small>
    </div>`;
  });
  creditSettings.innerHTML = primary ?? '';
  if (additional.length) {
    creditSettings.insertAdjacentHTML('beforeend', `<details class="account-advanced">
      <summary data-testid="btn_additionalClaudeCredits_monitorPage">${text.otherClaudeAccounts}</summary>
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
    status.textContent = text.expiryChanged;
    return;
  }
  const field = row.querySelector('input');
  if (field.value !== field.defaultValue) {
    status.textContent = text.saveExpiryFirst;
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
    status.textContent = current?.status === 'available' ? text.creditStillAvailable : text.used;
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

function openSettings(tab = null) {
  if (!settings || dialog.open) return;
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
  const selected = document.getElementById(`settings-tab-${tab ?? 'general'}`);
  selectSettingsTab(selected);
  dialog.showModal();
  selected.focus();
}
document.querySelector('#open-settings').addEventListener('click', () => openSettings());

// Deep link from the menu bar: #settings, #settings/notifications|general|accounts|auto-route.
async function applySettingsHash() {
  const link = parseSettingsHash(location.hash);
  if (!link) return;
  await firstQuota;
  if (dialog.open && link.tab) selectSettingsTab(document.getElementById(`settings-tab-${link.tab}`));
  else openSettings(link.tab);
}
dialog.addEventListener('close', () => {
  if (parseSettingsHash(location.hash)) history.replaceState(null, '', location.pathname + location.search);
});
window.addEventListener('hashchange', () => void applySettingsHash());

document.querySelector('#cancel-settings').addEventListener('click', () => dialog.close());
const testNotification = document.querySelector('#test-notification');
testNotification.addEventListener('click', async () => {
  const result = document.querySelector('#notification-result');
  testNotification.disabled = true;
  try {
    await request('/api/notifications/test', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    result.textContent = text.testSent;
  } catch {
    result.textContent = text.testFailed;
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
    formError.textContent = text.thresholdOrder;
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
      formError.textContent = text.invalidExpiry;
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
  theme.textContent = dark ? text.lightMode : text.darkMode;
}
theme.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme !== 'dark'));
applyTheme(true);
const firstQuota = loadQuota();
void loadModels(7);
void applySettingsHash();
setInterval(loadQuota, 15_000);
