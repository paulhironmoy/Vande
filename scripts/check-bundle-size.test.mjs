import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-bundle-size.mjs', import.meta.url));

function dist(files) {
  const root = mkdtempSync(join(tmpdir(), 'vande-dist-'));
  for (const [rel, data] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), data);
  }
  return root;
}
const run = (root) => execFileSync(process.execPath, [script, root], { encoding: 'utf8' });

test('an on-demand pack under models/ is reported on its own line and is not part of the precache total', () => {
  const root = dist({
    'index.html': '<script src="/assets/app.js"></script>',
    'assets/app.js': 'console.log(1);'.repeat(100),
    'models/pose/1.0.0/model.bin': randomBytes(3 * 1024 * 1024),
  });
  try {
    const out = run(root);
    const total = Number(/Total precache[^:]*: ([\d.]+) kB/.exec(out)[1]);
    assert.ok(total < 5, `precache total ${total} kB must not include the 3 MB pack`);
    const pack = Number(/On-demand packs, not precached \(1 files\): ([\d.]+) kB/.exec(out)[1]);
    assert.ok(pack >= 3000, `pack line ${pack} kB`);
    assert.match(out, /Within budget/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('without a pack there is no on-demand line and the total is unchanged', () => {
  const root = dist({ 'index.html': '<script src="/assets/app.js"></script>', 'assets/app.js': 'x'.repeat(2000) });
  try {
    const out = run(root);
    assert.doesNotMatch(out, /On-demand packs/);
    assert.match(out, /Total precache/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
