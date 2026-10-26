#!/usr/bin/env node
/**
 * Runs the VANDE Cricket API locally, in process, with in-memory D1 (SQLite), Durable Objects, R2 and Queues:
 *
 *   node backend/local/serve.mjs [--port 8787] [--host 127.0.0.1] [--engine auto|real|fake] [--web-origin <url>]
 *
 * The TypeScript sources (and the `@/` alias) are loaded through Vite's SSR module loader, so no build step is
 * needed. --engine auto (default) uses the real `@/engine` when it works and the platform's fake engine otherwise.
 * --web-origin (env LOCAL_WEB_ORIGIN, default http://localhost:5173) is the app under test: invite and highlight
 * links point at it and it is added to the allowed origins. Readiness: GET /v1/health answers 200 once listening.
 * Then start the app with VITE_API_LOCAL=1 (docs/INFRASTRUCTURE.md). Development only; nothing is persisted.
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(arg('port', process.env.PORT ?? '8787'));
const host = arg('host', '127.0.0.1');
const mode = arg('engine', 'auto');
const webOrigin = arg('web-origin', process.env.LOCAL_WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '');
try {
  if (!/^https?:$/.test(new URL(webOrigin).protocol)) throw new Error('not http(s)');
} catch {
  console.error(`--web-origin must be an http(s) origin, got ${webOrigin}`);
  process.exit(1);
}

const vite = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { '@': resolve(root, 'src') } },
  optimizeDeps: { noDiscovery: true, include: [] },
});

let engine = null;
let helpers = null;
let label = 'fake';
if (mode !== 'fake') {
  try {
    const mod = await vite.ssrLoadModule('/src/engine/index.ts');
    const real = mod.engine;
    const conditions = { pitch: 'hard', weather: 'clear' };
    real.revealDelivery(real.autoOver('probe', conditions), 0, conditions);
    engine = real;
    const ranking = await vite.ssrLoadModule('/src/engine/ranking.ts');
    const advice = await vite.ssrLoadModule('/src/engine/advice.ts');
    helpers = { timingAudit: mod.timingAudit, dailyCommits: mod.dailyCommits, updateRatings: ranking.updateRatings, rankTop100: ranking.rankTop100, matchEligibility: ranking.matchEligibility, autoXiSeed: mod.autoXiSeed, unlocksEarned: advice.unlocksEarned };
    label = `real v${real.ENGINE_VERSION}`;
  } catch (e) {
    if (mode === 'real') {
      console.error(`The real engine is not usable yet: ${e?.message ?? e}`);
      process.exit(1);
    }
  }
}
if (!engine) {
  const fake = await vite.ssrLoadModule('/backend/test/fakeEngine.ts');
  engine = fake.fakeEngine;
  helpers = fake.fakeHelpers;
}

const { startDevServer } = await vite.ssrLoadModule('/backend/local/devServer.ts');
const server = await startDevServer({ engine, helpers, port, host, engineLabel: label, webOrigin });
console.log(`VANDE Cricket API (local, ${label} engine): ${server.url}   health: ${server.url}/v1/health`);
const stop = async () => {
  await server.close();
  await vite.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
