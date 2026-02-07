import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'screenshot.spec.js',
  timeout: 180000,
  projects: [
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
  ],
  use: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
  },
});
