/**
 * Serves the built web app (render.html and its assets) on 127.0.0.1 inside the container, GET only, no directory
 * listings, no path traversal. The render page talks to nothing else: renderer.ts aborts every other request.
 */
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.wav': 'audio/wav',
};

/** The file a request path maps to inside `root`, or null when it would leave it. */
export function safePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = resolve(root);
  const full = resolve(base, `.${normalize(`/${decoded}`)}`);
  return full === base || full.startsWith(base + sep) ? full : null;
}

export async function serveStatic(root: string): Promise<{ server: Server; origin: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      const path = safePath(root, req.url ?? '/');
      try {
        if (!path || !(await stat(path)).isFile()) throw new Error('not found');
        const body = await readFile(path);
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('static server has no port');
  return { server, origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((ok) => server.close(() => ok())) };
}
