import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 180000,
  retries: 1,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // WebGL flags for headless Chromium
        launchOptions: {
          args: [
            '--enable-webgl',
            '--use-gl=swiftshader',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--no-sandbox',
          ],
        },
      },
    },
  ],
  use: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx vite --port 3001',
    port: 3001,
    timeout: 30000,
    reuseExistingServer: true,
  },
  outputDir: './test-results',
});
