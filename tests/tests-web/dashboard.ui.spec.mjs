import { expect, test } from '@playwright/test';
import { claudeCreditPromptResponse, emptyQuotaResponse, quotaResponse } from '../fixtures/agent-usage/quotaData.mjs';
import { startFixtureServer } from '../fixtures/agent-usage/fixtureServer.mjs';
import { DashboardPage } from '../pages/dashboardPage.mjs';

let server;
test.beforeAll(async () => { server = await startFixtureServer(); });
test.afterAll(async () => { await server.close(); });
test.beforeEach(() => { server.setQuota(quotaResponse()); });

async function dashboard(page, hash, quota) {
  if (quota) server.setQuota(quota);
  const view = new DashboardPage(page, server.url);
  await view.open(hash);
  return view;
}

test('[TC-AGU-69][FE-IT][Success] renders quota rows, alert notice, routes and schedule', async ({ page }) => {
  const view = await dashboard(page);
  await expect(view.rows).toHaveCount(3);
  await expect(view.alertTitle).toHaveText('2 quota alerts');
  await expect(view.row('claude')).toContainText('72%');
  await expect(view.row('agy')).toContainText('Critical');
  await expect(view.routes).toContainText('Claude→agy · Diverted');
  await expect(view.routes).toContainText('agy→Claude · Allowed');
  await expect(view.scheduleRows).toHaveCount(4);
  await expect(view.scheduleRows.first()).toContainText('07:00 GMT+7');
});

test.describe('London viewer', () => {
  test.use({ timezoneId: 'Europe/London' });
  test('[TC-AGU-70][FE-IT][Edge] shows scheduled checks in the viewer time zone with no ICT label', async ({ page }) => {
    const view = await dashboard(page);
    await expect(view.scheduleRows.first()).toContainText('00:00 GMT');
    await expect(view.scheduleRows.first()).not.toContainText('ICT');
  });
});

test('[TC-AGU-71][FE-IT][Success] opens settings with its four tabs and switches between them', async ({ page }) => {
  const view = await dashboard(page);
  await view.openSettings();
  await expect(view.dialog).toBeVisible();
  for (const name of ['general', 'notifications', 'accounts', 'route']) await expect(view.tab(name)).toBeVisible();
  expect(await view.selectedTabs()).toEqual(['General']);
  await view.selectTab('route');
  expect(await view.selectedTabs()).toEqual(['Auto-Route']);
  await expect(page.locator('#settings-route-state li')).toHaveCount(2);
});

test('[TC-AGU-72][FE-IT][Alternative] prompts for the Claude credit expiry when none is saved', async ({ page }) => {
  const view = await dashboard(page, '', claudeCreditPromptResponse);
  await view.openSettings();
  await view.selectTab('notifications');
  await expect(view.creditPrompt).toBeVisible();
  await expect(view.creditPrompt).toContainText('claude.ai/settings/usage');
});

test('[TC-AGU-73][FE-IT][Success] offers a Sign in button for every provider account', async ({ page }) => {
  const view = await dashboard(page);
  await view.openSettings();
  await view.selectTab('accounts');
  for (const provider of ['Claude', 'Agy', 'Copilot', 'Codex']) await expect(view.signInButton(provider)).toBeVisible();
});

test('[TC-AGU-74][FE-IT][Alternative] shows an enable-provider note and no rows when nothing is monitored', async ({ page }) => {
  const view = await dashboard(page, '', emptyQuotaResponse);
  await expect(view.alertTitle).toHaveText('No providers enabled');
  await expect(view.rows).toHaveCount(0);
});

test.describe('narrow viewport', () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test('[TC-AGU-75][FE-IT][Edge] keeps the page free of horizontal scroll and lays settings tabs out horizontally', async ({ page }) => {
    const view = await dashboard(page);
    expect(await view.hasHorizontalScroll()).toBe(false);
    await view.openSettings();
    expect(await view.tabOrientation()).toBe('horizontal');
  });
});

test('[TC-AGU-76][FE-IT][Success] #settings opens the settings dialog on the first tab', async ({ page }) => {
  const view = await dashboard(page, '#settings');
  await expect(view.dialog).toBeVisible();
  expect(await view.selectedTabs()).toEqual(['General']);
});

for (const [id, section, tab] of [[77, 'general', 'General'], [78, 'notifications', 'Notifications'], [79, 'accounts', 'Accounts'], [80, 'auto-route', 'Auto-Route']]) {
  test(`[TC-AGU-${id}][FE-IT][Success] #settings/${section} selects the ${tab} tab`, async ({ page }) => {
    const view = await dashboard(page, `#settings/${section}`);
    await expect(view.dialog).toBeVisible();
    expect(await view.selectedTabs()).toEqual([tab]);
  });
}

test('[TC-AGU-81][FE-IT][Edge] an unknown settings section opens the first tab and other hashes open nothing', async ({ page }) => {
  const view = await dashboard(page, '#settings/bogus');
  await expect(view.dialog).toBeVisible();
  expect(await view.selectedTabs()).toEqual(['General']);
  const other = await dashboard(await page.context().newPage(), '#elsewhere');
  await expect(other.dialog).toBeHidden();
});

test('[TC-AGU-82][FE-IT][Alternative] a hash change while settings is open switches tab, and closing clears the hash', async ({ page }) => {
  const view = await dashboard(page, '#settings');
  await view.setHash('#settings/accounts');
  await expect.poll(() => view.selectedTabs()).toEqual(['Accounts']);
  await view.cancelSettings();
  await expect(view.dialog).toBeHidden();
  expect(await view.hash()).toBe('');
  await view.setHash('#settings/notifications');
  await expect(view.dialog).toBeVisible();
  expect(await view.selectedTabs()).toEqual(['Notifications']);
});
