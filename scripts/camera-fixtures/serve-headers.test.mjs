/** Tests of the header-faithful static server (scripts/camera-fixtures/serve-headers.mjs). Plain node:test, no browser. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { get } from 'node:http';
import { fileURLToPath } from 'node:url';
import { headersFor, parseHeaders, startHeaderServer } from './serve-headers.mjs';

const SAMPLE = `/*
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(self), microphone=()
  Cache-Control: public, max-age=60

/admin.html
  Cache-Control: no-store
  X-Robots-Tag: noindex

/assets/*
  ! Permissions-Policy
  Cache-Control: public, max-age=31536000, immutable

/models/:set/*
  X-Pack: yes
`;

test('parses blocks, indented header lines and detach lines', () => {
  const blocks = parseHeaders(SAMPLE);
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks[0].set[1], ['Permissions-Policy', 'camera=(self), microphone=()']);
  assert.deepEqual(blocks[2].remove, ['permissions-policy']);
});

test('a splat matches across slashes, a placeholder matches one segment', () => {
  const blocks = parseHeaders(SAMPLE);
  assert.equal(headersFor(blocks, '/models/pose/0.10.35/engine.bin').get('x-pack')?.value, 'yes');
  assert.equal(headersFor(blocks, '/models/engine.bin').get('x-pack'), undefined);
  assert.equal(headersFor(blocks, '/x/y/z').get('x-content-type-options')?.value, 'nosniff');
});

test('values set by several matching blocks are joined, and a detach removes an earlier header', () => {
  const blocks = parseHeaders(SAMPLE);
  assert.equal(headersFor(blocks, '/admin.html').get('cache-control')?.value, 'public, max-age=60, no-store');
  const asset = headersFor(blocks, '/assets/app.js');
  assert.equal(asset.get('permissions-policy'), undefined);
  assert.match(asset.get('cache-control').value, /immutable/);
});

test('the repository _headers sends the camera policy the production host will send', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const text = readFileSync(resolve(here, '..', '..', 'public', '_headers'), 'utf8');
  const policy = headersFor(parseHeaders(text), '/').get('permissions-policy')?.value ?? '';
  // Whatever the file says today, the parser must find a Permissions-Policy that mentions the camera on the root path.
  assert.match(policy, /camera=/);
});

test('serves files with the right headers, an SPA fallback, and refuses to leave the folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdr-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, '_headers'), SAMPLE);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
  writeFileSync(join(dir, 'assets', 'a.js'), 'export default 1');
  writeFileSync(join(dir, 'engine.wasm'), Buffer.from([0, 97, 115, 109]));
  const s = await startHeaderServer({ dir, port: 0 });
  try {
    const root = await fetch(s.origin + '/');
    assert.equal(root.status, 200);
    assert.equal(root.headers.get('permissions-policy'), 'camera=(self), microphone=()');
    assert.match(root.headers.get('content-type'), /text\/html/);
    const js = await fetch(s.origin + '/assets/a.js');
    assert.equal(js.headers.get('permissions-policy'), null);
    assert.match(js.headers.get('content-type'), /javascript/);
    const wasm = await fetch(s.origin + '/engine.wasm');
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    const route = await fetch(s.origin + '/practice/play');
    assert.equal(route.status, 200);
    assert.match(await route.text(), /<title>x<\/title>/);
    assert.equal((await fetch(s.origin + '/_headers')).status, 404);
    assert.equal((await fetch(s.origin + '/missing.png')).status, 404);
    // A percent-encoded `..` is not removed by URL parsing: the server itself must refuse to leave its folder.
    const raw = (path) =>
      new Promise((ok, fail) =>
        get({ host: '127.0.0.1', port: s.port, path }, (r) => {
          let body = '';
          r.on('data', (c) => (body += c));
          r.on('end', () => ok({ status: r.statusCode, body }));
        }).on('error', fail),
      );
    assert.equal((await raw('/..%2f..%2f..%2f..%2fetc/passwd')).status, 403);
    // A literal `..` is resolved by the URL parser into the site root, which never reaches outside it.
    const plain = await raw('/../../../../etc/passwd');
    assert.doesNotMatch(plain.body, /root:/);
  } finally {
    await s.close();
  }
});

test('an override replaces a header everywhere (the negative control for the camera policy)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdr-'));
  writeFileSync(join(dir, '_headers'), SAMPLE);
  writeFileSync(join(dir, 'index.html'), 'x');
  const s = await startHeaderServer({ dir, port: 0, overrides: ['Permissions-Policy: camera=()'] });
  try {
    const r = await fetch(s.origin + '/');
    assert.equal(r.headers.get('permissions-policy'), 'camera=()');
  } finally {
    await s.close();
  }
});
