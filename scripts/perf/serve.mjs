/**
 * Serves a production build the way static hosting does (gzip, SPA fallback, immutable hashed assets) on a free
 * local port, for the measurements in this folder. `const s = await serveBuild('dist'); … s.url … await s.close();`
 */
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function serveBuild(dir = 'dist', port = 0) {
  const root = resolve(ROOT, dir);
  if (!existsSync(join(root, 'index.html'))) throw new Error(`No build in ${root}: run "npx vite build --outDir ${dir}" first.`);
  const cache = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = join(root, decodeURIComponent(url.pathname));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) p = extname(url.pathname) ? '' : join(root, 'index.html');
    if (!p || !existsSync(p)) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = cache.get(p);
    if (!body) {
      body = gzipSync(readFileSync(p), { level: 9 });
      cache.set(p, body);
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream',
      'Content-Encoding': 'gzip',
      'Cache-Control': p.includes(`${join(root, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  });
  return new Promise((ok) =>
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      ok({ url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`, close: () => new Promise((done) => server.close(() => done())) });
    }),
  );
}

/** Playwright's Chromium from the repo's own dev dependency (works from any working directory). */
export async function chromium() {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const req = createRequire(join(ROOT, 'package.json'));
  const mod = await import(pathToFileURL(req.resolve('@playwright/test')).href);
  return mod.chromium ?? mod.default.chromium;
}
