/**
 * A small static server that applies a Cloudflare-Pages / Netlify style `_headers` file, so a test can prove what the production
 * host will do (for the camera: `Permissions-Policy: camera=(self)` in public/_headers). `vite preview` ignores `_headers`.
 *
 *   node scripts/camera-fixtures/serve-headers.mjs --dir dist-practice-synth --port 4315 [--headers dist/_headers]
 *        [--header "Permissions-Policy: camera=()"]   (repeatable; replaces that header on every response: a negative control)
 *
 * Or from a test: `const s = await startHeaderServer({ dir, port: 0 }); ... await s.close();` (port 0 = any free port).
 *
 * Rules implemented (the subset the repository's `_headers` uses, with the host's documented semantics):
 *  - a block starts with a path pattern at column 0; its header lines are indented, `Name: value`;
 *  - `*` in a pattern is a splat that matches anything, including `/`; `:name` matches one path segment;
 *  - every block whose pattern matches applies; when a header is set by more than one block the values are joined with ", ";
 *  - `! Name` in a block removes a header set by an earlier block.
 * Not implemented: redirects and `Link` preload rules (there are none in `_headers`). Unknown paths without a file extension get
 * index.html (the app is a single-page app). No directory listing, no `..` escape.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
};

/** Parses the text of a `_headers` file into [{ pattern, set: [[name, value]], remove: [name] }]. */
export function parseHeaders(text) {
  const blocks = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      cur = { pattern: raw.trim(), set: [], remove: [] };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    const line = raw.trim();
    if (line.startsWith('!')) {
      cur.remove.push(line.slice(1).trim().toLowerCase());
      continue;
    }
    const i = line.indexOf(':');
    if (i < 1) continue;
    cur.set.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return blocks;
}

function patternToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') re += '.*';
    else if (c === ':' && /[A-Za-z_]/.test(pattern[i + 1] ?? '')) {
      let j = i + 1;
      while (j < pattern.length && /[A-Za-z0-9_]/.test(pattern[j])) j++;
      re += '[^/]+';
      i = j - 1;
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

/** The headers the host would send for a path: a Map of lower-case name to { name, value }. */
export function headersFor(blocks, pathname) {
  const out = new Map();
  for (const b of blocks) {
    if (!patternToRegExp(b.pattern).test(pathname)) continue;
    for (const name of b.remove) out.delete(name);
    for (const [name, value] of b.set) {
      const key = name.toLowerCase();
      const had = out.get(key);
      out.set(key, { name, value: had && had.value !== value ? `${had.value}, ${value}` : value });
    }
  }
  return out;
}

export async function startHeaderServer({ dir, port = 0, headersFile, overrides = [], host = '127.0.0.1' }) {
  const root = resolve(dir);
  const file = headersFile ? resolve(headersFile) : join(root, '_headers');
  const blocks = existsSync(file) ? parseHeaders(readFileSync(file, 'utf8')) : [];
  const forced = overrides.map((h) => {
    const i = h.indexOf(':');
    return [h.slice(0, i).trim(), h.slice(i + 1).trim()];
  });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      let target = normalize(join(root, pathname));
      if (target !== root && !target.startsWith(root + sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      let info = await stat(target).catch(() => null);
      if (info?.isDirectory()) {
        target = join(target, 'index.html');
        info = await stat(target).catch(() => null);
      }
      if (!info && !extname(pathname)) {
        target = join(root, 'index.html');
        info = await stat(target).catch(() => null);
      }
      if (!info || pathname === '/_headers') {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const headers = {};
      for (const { name, value } of headersFor(blocks, pathname).values()) headers[name] = value;
      for (const [name, value] of forced) {
        for (const k of Object.keys(headers)) if (k.toLowerCase() === name.toLowerCase()) delete headers[k];
        headers[name] = value;
      }
      headers['Content-Type'] = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
      headers['Content-Length'] = String(info.size);
      res.writeHead(200, headers);
      if (req.method === 'HEAD') res.end();
      else res.end(await readFile(target));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e));
    }
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, ok);
  });
  const address = server.address();
  return {
    port: address.port,
    origin: `http://localhost:${address.port}`,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}

function cli() {
  const argv = process.argv.slice(2);
  const get = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const overrides = argv.flatMap((a, i) => (a === '--header' ? [argv[i + 1]] : []));
  const dir = get('--dir');
  if (!dir) {
    console.error('usage: node scripts/camera-fixtures/serve-headers.mjs --dir <dist> [--port n] [--headers file] [--header "Name: value"]');
    process.exit(2);
  }
  startHeaderServer({ dir, port: Number(get('--port') ?? 0), headersFile: get('--headers'), overrides }).then((s) => {
    console.log(`serving ${resolve(dir)} on ${s.origin} (headers from ${get('--headers') ?? join(dir, '_headers')})`);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => s.close().then(() => process.exit(0)));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) cli();
