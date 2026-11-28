import { availableResetCredits, creditExpiryLabel } from './reset-credits.mjs';

const labels = { healthy: 'Healthy', watch: 'Watch', low: 'Low', critical: 'Critical', unknown: 'Unavailable' };
const states = { live: 'Live', aging: 'Stale', reset_assumed: 'Awaiting fresh quota', exhausted: 'Cooldown reported', unknown: 'Unavailable' };
const severity = { watch: 1, low: 2, critical: 3 };
const marks = { claude: 'C', agy: 'A', copilot: 'G', codex: 'O' };
const windows = { '5h': '5-hour window', '7d': '7-day window', monthly: 'Monthly credits' };
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const clock = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const localClock = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
const notificationError = document.querySelector('#alert-details');
const form = document.querySelector('#quota-settings');
const providerSwitches = [...form.querySelectorAll('[data-monitor-provider]')];
const accountSettings = form.querySelector('.account-settings');
const accountGroups = [...accountSettings.querySelectorAll('[data-account-provider]')];
const accountTemplate = form.querySelector('#account-row-template');
const dialog = document.querySelector('.settings-dialog');
const modelButtons = [...document.querySelectorAll('[data-model-days]')];
let settings;
let modelRequest = 0;
let quotaRequest = 0;
let savingSettings = false;

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
  const rows = quota.flatMap(row => {
    const summary = row.rateLimitResetCredits;
    const available = availableResetCredits(summary, now).sort((first, second) =>
      (first.expiresAt ?? Infinity) - (second.expiresAt ?? Infinity));
    if (summary?.credits === null && summary.availableCount > 0) {
      return [`<li><span>${escapeHTML(row.label)}</span><span>${summary.availableCount} available · expiry details unavailable</span></li>`];
    }
    return available.map(credit => {
      const account = row.accountId ? `${escapeHTML(row.label)} · ` : '';
      const label = creditExpiryLabel(credit.expiresAt, now);
      const expiry = credit.expiresAt === null ? label : `<time datetime="${new Date(credit.expiresAt * 1000).toISOString()}">${escapeHTML(label)}</time>`;
      return `<li><span>${account}${escapeHTML(credit.title || 'Rate limit reset')}</span><span>${expiry}</span></li>`;
    });
  });
  panel.hidden = rows.length === 0;
  panel.querySelector('ul').innerHTML = rows.join('');
}

function renderQuota(data) {
  settings = data.settings;
  const { quota, schedule, checks, routes } = data;
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
    return `<div class="plan-grid plan-row" data-provider="${row.provider}" data-state="${row.state ?? 'ready'}"><div class="plan-provider ${row.provider}"><h3 class="provider"><span class="provider-mark" aria-hidden="true">${marks[row.provider]}</span>${escapeHTML(row.label)}</h3><small>${status}</small></div>${bars}<div class="capacity" data-target="${target}"><strong>${row.capacity ?? '—'}</strong><span>sessions estimated · target ${settings.target}</span></div></div>`;
  }).join('');
  const directions = [
    { label: 'Claude→agy', requested: 'agy', decision: routes.claudeToAgy },
    { label: 'agy→Claude', requested: 'claude', decision: routes.agyToClaude },
  ];
  document.querySelector('#quota-routes').innerHTML = directions.map(({ label, requested, decision }) => {
    const status = decision.target === requested ? 'Allowed' : 'Diverted';
    return `<div><strong>${label}</strong> · ${status} · ${escapeHTML(decision.reason)}</div>`;
  }).join('');
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

function addAccount(group, account = { id: crypto.randomUUID(), label: '', home: '' }) {
  const row = accountTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.accountId = account.id;
  const label = row.querySelector('[data-account-label]');
  const home = row.querySelector('[data-account-home]');
  const provider = group.dataset.accountProvider;
  label.value = account.label;
  home.value = account.home;
  label.dataset.testid = `txt_${provider}AccountLabel_monitorPage`;
  home.dataset.testid = `txt_${provider}AccountHome_monitorPage`;
  row.querySelector('[data-remove-account]').dataset.testid = `btn_remove${provider[0].toUpperCase()}${provider.slice(1)}Account_monitorPage`;
  group.querySelector('.account-rows').append(row);
  return label;
}

accountSettings.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const group = button.closest('[data-account-provider]');
  if (button.hasAttribute('data-add-account')) addAccount(group).focus();
  if (button.hasAttribute('data-remove-account')) {
    button.closest('.account-row').remove();
    group.querySelector('[data-add-account]').focus();
  }
});

document.querySelector('#open-settings').addEventListener('click', () => {
  if (!settings) return;
  for (const field of form.querySelectorAll('input[type="number"]')) field.value = settings[field.name];
  for (const input of providerSwitches) input.checked = settings.providers[input.dataset.monitorProvider];
  for (const group of accountGroups) {
    group.querySelector('.account-rows').replaceChildren();
    for (const account of settings.accounts?.[group.dataset.accountProvider] ?? []) addAccount(group, account);
  }
  form.querySelector('.form-error').textContent = '';
  dialog.showModal();
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
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (savingSettings) return;
  const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, Number(value)]));
  values.providers = Object.fromEntries(providerSwitches.map(input => [input.dataset.monitorProvider, input.checked]));
  values.accounts = Object.fromEntries(accountGroups.map(group => [
    group.dataset.accountProvider,
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
    form.querySelector('.form-error').textContent = error.message;
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
