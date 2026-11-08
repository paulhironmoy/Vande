import { defineConfig, devices } from '@playwright/test';

/**
 * Mouse checks in Firefox and WebKit (owner's second brief, section 4; DoD CTR-04; ruling R-22). The same hooks build the
 * `practice` project uses, served by the caller (CONTROLS' runner starts `vite preview` on E2E_PRACTICE_PORT), so this file
 * starts no server and builds nothing. Chromium is covered by the main config's `practice` project. Install the browsers once
 * with `npx playwright install firefox webkit`. Edge and real Safari are not covered (UNPROVEN).
 *
 *   E2E_PRACTICE_PORT=4313 E2E_OUT=test-results-controls npx playwright test -c playwright.controls.config.ts
 */
const PORT = Number(process.env.E2E_PRACTICE_PORT ?? 4313);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /controls-mouse\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: process.env.E2E_OUT ?? 'test-results-controls',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
    colorScheme: 'dark',
  },
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
