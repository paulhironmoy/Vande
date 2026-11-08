// Vitest config for scripts/camera-fixtures/classify-traces.ts: one file, node environment, '@' -> src, one worker (the same pattern
// as scripts/director-corpus-export.vitest.config.mjs). It is a measurement script, not part of `npm test`.
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default {
  root,
  resolve: { alias: { '@': `${root}src`, '@tests': `${root}tests` } },
  test: {
    environment: 'node',
    include: ['scripts/camera-fixtures/classify-traces.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
};
