import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', {
      open: 'never',
      outputFolder: path.resolve(__dirname, '..', '..', '..', '..', 'e2e-report', 'vscode-e2e'),
    }],
  ],
  globalSetup: path.resolve(__dirname, 'global-setup.mjs'),
  globalTeardown: path.resolve(__dirname, 'global-teardown.mjs'),
  use: {
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'vscode-e2e',
    },
  ],
});
