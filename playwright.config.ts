import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:1420', viewport: { width: 1280, height: 860 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run web:dev', url: 'http://127.0.0.1:1420', reuseExistingServer: !process.env.CI },
});
