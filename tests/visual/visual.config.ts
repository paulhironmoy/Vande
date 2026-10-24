import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * Standalone config for the screenshot capture against an isolated build (dist-visual on :4177),
 * so it never collides with an e2e run on :4173.
 *   npx vite build --outDir dist-visual && npx playwright test --config tests/visual/visual.config.ts
 */
const PORT = 4177;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  outputDir: `${ROOT}test-results-visual`,
  timeout: 600_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  workers: 2,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
    colorScheme: 'dark',
  },
  projects: [{ name: 'visual' }],
  webServer: {
    command: `npx vite preview --outDir dist-visual --port ${PORT} --strictPort`,
    cwd: ROOT,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
