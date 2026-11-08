/**
 * The Freesound list: every kind the kit takes has searches; every link carries exactly one allowed licence filter
 * (Creative Commons 0 or Attribution), never NonCommercial or Sampling+; the written list is up to date.
 *
 *   node --test scripts/audio/freesound-search.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { KINDS } from './lib/kinds.mjs';
import { CHECKLIST, LICENCE_FILTERS, QUERIES, markdown, searchUrl } from './freesound-search.mjs';

test('every kind the kit takes has searches, with both allowed licence filters and nothing else', () => {
  assert.deepEqual(Object.keys(QUERIES), Object.keys(KINDS));
  assert.deepEqual(Object.keys(LICENCE_FILTERS), ['Creative Commons 0', 'Attribution']);
  for (const qs of Object.values(QUERIES)) {
    assert.ok(qs.length >= 3);
    for (const q of qs) {
      for (const l of Object.keys(LICENCE_FILTERS)) {
        const u = new URL(searchUrl(q, l));
        assert.equal(u.hostname, 'freesound.org');
        assert.equal(u.searchParams.get('q'), q);
        assert.equal(u.searchParams.get('f'), `license:"${l}" duration:[0 TO 10]`);
      }
    }
  }
  assert.throws(() => searchUrl('bat', 'Attribution NonCommercial'));
  assert.throws(() => searchUrl('bat', 'Sampling+'));
  const md = markdown();
  assert.doesNotMatch(md.replace(/Never use the filters “Attribution NonCommercial” or “Sampling\+”/, ''), /license%3A%22Attribution\+NonCommercial|Sampling%2B/);
  assert.equal(CHECKLIST.length, 6);
});

test('the sound folder’s FREESOUND-SEARCH.md is the current list', () => {
  const file = new URL('../../release/product-sequence/stage-1-practice/wedge/sound/FREESOUND-SEARCH.md', import.meta.url);
  assert.equal(readFileSync(file, 'utf8'), markdown());
});
