// Vitest config for scripts/director-corpus-export.ts: one file, node environment, '@' -> src and '@tests' -> tests, one worker, and a
// timeout for a complete 490-plan export on a shared machine.
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export default {
  root,
  resolve: { alias: { '@': `${root}src`, '@tests': `${root}tests` } },
  test: {
    environment: 'node',
    include: ['scripts/director-corpus-export.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    fileParallelism: false,
  },
};
