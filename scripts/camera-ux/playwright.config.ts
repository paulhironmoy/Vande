/**
 * Evidence run for the camera's screens (CAMERA-UX): the gallery page in Chromium at the phone and laptop sizes, at normal
 * and 200% text. Its own port and output folder (RULINGS R-23): `E2E_PRACTICE_PORT=4316 E2E_OUT=test-results-camux`.
 *   npx playwright test -c scripts/camera-ux/playwright.config.ts
 * Not part of the product's test projects (npm run test:e2e never sees this file).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.E2E_PRACTICE_PORT ?? 4316);
const root = path.resolve(here, '../..');
const out = path.resolve(root, process.env.E2E_OUT ?? 'test-results-camux');

export default defineConfig({
  testDir: here,
  testMatch: /layout\.spec\.ts$/,
  outputDir: path.join(out, 'camera-ux'),
  timeout: 240_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium' },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: root,
    url: `http://127.0.0.1:${port}/scripts/camera-ux/gallery/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
