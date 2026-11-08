import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { promoteExclusively } from './android-exclusive-promote.mjs';

function fixture(t) {
  const root = realpathSync(resolve(mkdtempSync(join(tmpdir(), 'vande-promote-test-'))));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('exclusive promotion hard-links every source without overwriting', (t) => {
  const root = fixture(t);
  const source = join(root, 'source.apk');
  const target = join(root, 'target.apk');
  writeFileSync(source, 'sealed');
  const result = promoteExclusively([{ source, target }]);
  assert.equal(result.length, 1);
  assert.equal(readFileSync(target, 'utf8'), 'sealed');
});

test('a target created in the absence-check/link race is preserved', (t) => {
  const root = fixture(t);
  const source = join(root, 'source.apk');
  const target = join(root, 'target.apk');
  writeFileSync(source, 'ours');
  assert.throws(
    () => promoteExclusively([{ source, target }], {
      beforeLink: () => writeFileSync(target, 'racer', { flag: 'wx' }),
    }),
    /EEXIST|already exists/u,
  );
  assert.equal(readFileSync(target, 'utf8'), 'racer');
});

test('later-pair failure removes only exact links created by this invocation', (t) => {
  const root = fixture(t);
  const one = join(root, 'one');
  const two = join(root, 'two');
  const targetOne = join(root, 'target-one');
  const targetTwo = join(root, 'target-two');
  writeFileSync(one, 'one');
  writeFileSync(two, 'two');
  assert.throws(
    () => promoteExclusively([{ source: one, target: targetOne }, { source: two, target: targetTwo }], {
      beforeLink: (_pair, index) => { if (index === 1) writeFileSync(targetTwo, 'racer', { flag: 'wx' }); },
    }),
    /EEXIST|already exists/u,
  );
  assert.throws(() => readFileSync(targetOne), /ENOENT/u);
  assert.equal(readFileSync(targetTwo, 'utf8'), 'racer');
});

test('a prior hard-linked source mutation fails and rolls back exact owned targets', (t) => {
  const root = fixture(t);
  const sourceOne = join(root, 'source-one');
  const sourceTwo = join(root, 'source-two');
  const targetOne = join(root, 'target-one');
  const targetTwo = join(root, 'target-two');
  writeFileSync(sourceOne, 'one');
  writeFileSync(sourceTwo, 'two');

  assert.throws(
    () => promoteExclusively(
      [{ source: sourceOne, target: targetOne }, { source: sourceTwo, target: targetTwo }],
      {
        beforeLink: (_pair, index) => {
          if (index === 1) writeFileSync(sourceOne, 'mutated-after-first-link');
        },
      },
    ),
    /changed before promotion transaction completion/u,
  );
  assert.throws(() => readFileSync(targetOne), /ENOENT/u);
  assert.throws(() => readFileSync(targetTwo), /ENOENT/u);
  assert.equal(readFileSync(sourceOne, 'utf8'), 'mutated-after-first-link');
});

test('a source-path swap before link is rejected and its wrong link is removed', (t) => {
  const root = fixture(t);
  const source = join(root, 'source');
  const saved = join(root, 'source.saved');
  const target = join(root, 'target');
  writeFileSync(source, 'prepared');

  assert.throws(
    () => promoteExclusively([{ source, target }], {
      beforeLink: () => {
        renameSync(source, saved);
        writeFileSync(source, 'replacement');
      },
    }),
    /does not share the source identity/u,
  );
  assert.throws(() => readFileSync(target), /ENOENT/u);
  assert.equal(readFileSync(source, 'utf8'), 'replacement');
  assert.equal(readFileSync(saved, 'utf8'), 'prepared');
});
