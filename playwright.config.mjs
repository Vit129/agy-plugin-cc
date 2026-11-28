import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/tests-web',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: '.tmp/playwright',
  use: { browserName: 'chromium', locale: 'en-GB', timezoneId: 'Asia/Bangkok', viewport: { width: 1280, height: 900 } },
});
