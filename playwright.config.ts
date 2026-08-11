import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './packages/vscode-extension/test/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node packages/vscode-extension/test/e2e/server.mjs',
    port: 8979,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
