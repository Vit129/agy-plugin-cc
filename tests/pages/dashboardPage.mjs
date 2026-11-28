import { NOW } from '../fixtures/agent-usage/quotaData.mjs';

const tabIds = { general: 'tab_settingsGeneral_monitorPage', notifications: 'tab_settingsNotifications_monitorPage', accounts: 'tab_settingsAccounts_monitorPage', route: 'tab_settingsRoute_monitorPage' };

// Page object for the Agent Usage dashboard: the only place that knows its DOM.
export class DashboardPage {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
    this.alertTitle = page.locator('#alert-title');
    this.rows = page.locator('#quota-rows .plan-row');
    this.routes = page.getByTestId('lbl_quotaRoutes_monitorPage');
    this.scheduleRows = page.locator('#reset-checks li');
    this.dialog = page.getByTestId('dlg_alertSettings_monitorPage');
    this.settingsButton = page.getByTestId('btn_openAlertSettings_monitorPage');
    this.creditPrompt = page.locator('#claude-credit-prompt');
  }

  async open(hash = '') {
    await this.page.clock.install({ time: NOW });
    await this.page.goto(this.baseUrl + hash);
    await this.alertTitle.filter({ hasNotText: 'Loading' }).waitFor();
  }

  tab(name) { return this.page.getByTestId(tabIds[name]); }
  signInButton(provider) { return this.page.getByTestId(`btn_signIn${provider}Account_monitorPage`); }
  row(provider) { return this.page.locator(`#quota-rows .plan-row[data-provider="${provider}"]`); }

  async openSettings() { await this.settingsButton.click(); }
  async selectTab(name) { await this.tab(name).click(); }
  async cancelSettings() { await this.page.getByTestId('btn_cancelAlertSettings_monitorPage').click(); }
  async selectedTabs() {
    return this.page.locator('[role="tab"][aria-selected="true"]').evaluateAll(tabs => tabs.map(tab => tab.textContent));
  }
  async hash() { return this.page.evaluate(() => location.hash); }
  async setHash(hash) { await this.page.evaluate(next => { location.hash = next; }, hash); }
  async hasHorizontalScroll() {
    return this.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  }
  async tabOrientation() { return this.page.getByTestId('nav_settings_monitorPage').getAttribute('aria-orientation'); }
}
