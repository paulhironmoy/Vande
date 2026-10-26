import { defineConfig, devices } from '@playwright/test';

/**
 * Four suites:
 * - `chromium`: the offline-capable app as shipped without an API URL (dist/ from `npm run build`), port 4173.
 * - `social`: social-*.spec.ts against an API-enabled build (VITE_API_LOCAL=1) whose API the tests mock, port 4175.
 * - `practice`: practice-*.spec.ts against a build with the Practice test hooks (VITE_PRACTICE_TEST_HOOKS=1), port 4176.
 * - `flow` (FLOW=1 only): flow-*.spec.ts, two phones against the real backend in process on 127.0.0.1:8787 and a
 *   VITE_API_LOCAL=1 build on 4174.
 * Parallel agents isolate their runs with E2E_PORT / E2E_DIST (chromium), E2E_API_PORT / E2E_API_DIST (social) and
 * E2E_OUT (results), so two runs never share a server, a build or results.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const DIST = process.env.E2E_DIST ?? 'dist';
const API_PORT = Number(process.env.E2E_API_PORT ?? 4175);
const API_DIST = process.env.E2E_API_DIST ?? 'dist-api';
const FLOW = Boolean(process.env.FLOW);
const FLOW_PORT = 4174;
const FLOW_SPEC = /flow-.*\.spec\.ts$/;
const SOCIAL_SPEC = /social-.*\.spec\.ts$/;
/** Practice journeys: a build with the test hooks (VITE_PRACTICE_TEST_HOOKS=1) previewed on 4176, phones and desktop. */
const PRACTICE_SPEC = /practice-.*\.spec\.ts$/;
const PRACTICE_PORT = Number(process.env.E2E_PRACTICE_PORT ?? 4176);
const PRACTICE_DIST = process.env.E2E_PRACTICE_DIST ?? 'dist-practice';
/** Projects named on the command line (--project x / --project=x); none means all, so only their servers start. */
const REQUESTED = process.argv.flatMap((arg, i, all) => (arg.startsWith('--project=') ? [arg.slice(10)] : arg === '--project' ? [all[i + 1]] : []));
const wants = (project: string) => REQUESTED.length === 0 || REQUESTED.includes(project);
const serverFor = <T,>(project: string, server: T): T[] => (wants(project) ? [server] : []);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: FLOW ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: process.env.E2E_OUT ? `${process.env.E2E_OUT}-report` : 'playwright-report' }]],
  ...(process.env.E2E_OUT ? { outputDir: process.env.E2E_OUT } : {}),
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
    colorScheme: 'dark',
  },
  projects: FLOW
    ? [{ name: 'flow', testMatch: FLOW_SPEC, use: { ...devices['Pixel 7'], baseURL: `http://localhost:${FLOW_PORT}`, serviceWorkers: 'block' } }]
    : [
        { name: 'chromium', testIgnore: [FLOW_SPEC, SOCIAL_SPEC, PRACTICE_SPEC], use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
        { name: 'practice', testMatch: PRACTICE_SPEC, use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PRACTICE_PORT}` } },
        { name: 'social', testMatch: SOCIAL_SPEC, use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${API_PORT}` } },
      ],
  webServer: FLOW
    ? [
        {
          command: `node backend/local/serve.mjs --engine real --web-origin http://localhost:${FLOW_PORT}`,
          url: 'http://127.0.0.1:8787/v1/health',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: `VITE_API_LOCAL=1 npx vite build --outDir dist-flow --emptyOutDir && npx vite preview --outDir dist-flow --port ${FLOW_PORT} --strictPort`,
          url: `http://localhost:${FLOW_PORT}`,
          reuseExistingServer: false,
          timeout: 300_000,
        },
      ]
    : [
        ...serverFor('chromium', {
          command: `npx vite preview --outDir ${DIST} --port ${PORT} --strictPort`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        }),
        ...serverFor('social', {
          command: `VITE_API_LOCAL=1 npx vite build --outDir ${API_DIST} --emptyOutDir && npx vite preview --outDir ${API_DIST} --port ${API_PORT} --strictPort`,
          url: `http://localhost:${API_PORT}`,
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
        }),
        ...serverFor('practice', {
          command: `VITE_PRACTICE_TEST_HOOKS=1 npx vite build --outDir ${PRACTICE_DIST} --emptyOutDir && npx vite preview --outDir ${PRACTICE_DIST} --port ${PRACTICE_PORT} --strictPort`,
          url: `http://localhost:${PRACTICE_PORT}`,
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
        }),
      ],
});
