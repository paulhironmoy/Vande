import { defineConfig } from 'vitest/config';

/** Unit tests of the render service (no browser, no ffmpeg, no network): npx vitest run --config render-service/vitest.config.ts */
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
