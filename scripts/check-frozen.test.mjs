import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkFrozen, parseList } from './check-frozen.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'check-frozen.mjs');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const temps = [];
/** A throwaway root with the given files and a list that records them; returns { dir, listFile }. */
function fixture(files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vande-check-frozen-')));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const listFile = join(dir, 'frozen.sha256');
  writeFileSync(listFile, `${Object.entries(files).map(([name, text]) => `${sha256(text)}  ${name}`).join('\n')}\n`);
  return { dir, listFile };
}
const run = (listFile, root) => spawnSync(process.execPath, [SCRIPT, '--list', listFile, '--root', root], { encoding: 'utf8' });

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('the physics freeze 5f list in this checkout', () => {
  it('holds the 25 files of src/physics and src/render3d/practice/frame.ts, and each has its recorded SHA-256', () => {
    const entries = parseList(readFileSync(join(ROOT, 'docs', 'FROZEN-5f.sha256'), 'utf8'));
    assert.equal(entries.length, 25);
    for (const { file } of entries) assert.ok(file.startsWith('src/physics/') || file === 'src/render3d/practice/frame.ts', file);
    const result = checkFrozen();
    assert.deepEqual(result.failures, []);
    assert.equal(result.ok, 25);
  });

  it('prints "25 of 25 OK" and exits 0', () => {
    const run25 = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run25.status, 0, run25.stderr);
    assert.equal(run25.stdout.trim(), '25 of 25 OK');
  });
});

describe('a throwaway copy', () => {
  it('passes while every file is as recorded', () => {
    const { dir, listFile } = fixture({ 'src/physics/a.ts': 'export const a = 1;\n', 'src/physics/b.ts': 'export const b = 2;\n' });
    const result = run(listFile, dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '2 of 2 OK');
  });

  it('exits 1 and names the file when one byte changes', () => {
    const { dir, listFile } = fixture({ 'src/physics/a.ts': 'export const a = 1;\n', 'src/physics/b.ts': 'export const b = 2;\n' });
    writeFileSync(join(dir, 'src/physics/b.ts'), 'export const b = 3;\n');
    const result = run(listFile, dir);
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trim(), '1 of 2 OK');
    assert.match(result.stderr, /FROZEN FILE src\/physics\/b\.ts: changed/);
  });

  it('exits 1 and names the file when it is missing', () => {
    const { dir, listFile } = fixture({ 'src/physics/a.ts': 'export const a = 1;\n', 'src/physics/b.ts': 'export const b = 2;\n' });
    rmSync(join(dir, 'src/physics/a.ts'));
    const result = run(listFile, dir);
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trim(), '1 of 2 OK');
    assert.match(result.stderr, /FROZEN FILE src\/physics\/a\.ts: missing/);
  });

  it('accepts CRLF line endings in the list and refuses a malformed, empty or unsafe list with exit 2', () => {
    const { dir, listFile } = fixture({ 'src/physics/a.ts': 'x\n' });
    writeFileSync(listFile, readFileSync(listFile, 'utf8').replace(/\n/g, '\r\n'));
    assert.equal(run(listFile, dir).status, 0);
    for (const bad of ['', 'not a hash  src/physics/a.ts\n', `${sha256('x\n')}  ../outside.ts\n`, `${sha256('x\n')}  /etc/passwd\n`]) {
      writeFileSync(listFile, bad);
      const result = run(listFile, dir);
      assert.equal(result.status, 2, JSON.stringify(bad));
      assert.match(result.stderr, /check-frozen:/);
    }
  });
});
