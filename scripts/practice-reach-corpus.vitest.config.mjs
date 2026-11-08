// Vitest config for the Practice sim-v3 reach corpus (scripts/practice-reach-corpus.test.ts): one file, node environment,
// '@' -> src, no parallelism, and a timeout for a complete 7,560-case pass on a shared machine.
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export default {
  root,
  resolve: { alias: { '@': `${root}src` } },
  test: {
    environment: 'node',
    include: ['scripts/practice-reach-corpus.test.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
    fileParallelism: false,
  },
};
