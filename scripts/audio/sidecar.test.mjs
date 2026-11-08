/**
 * The inbox description and licence rules: every refusal the owner can meet, in plain words, and the kinds table
 * against the shipped manifest.
 *
 *   node --test scripts/audio/sidecar.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_SOUNDS, KINDS, kindOf } from './lib/kinds.mjs';
import { normaliseLicence, parseCsv, validateEntry } from './lib/sidecar.mjs';

const manifest = await import('../../src/audio/recordedManifest.ts');

test('allowed licences: owner-made, CC0 1.0, CC BY 3.0 and 4.0, however they are written', () => {
  const ok = { 'owner-made': 'owner-made', owner: 'owner-made', CC0: 'CC0-1.0', 'CC0-1.0': 'CC0-1.0', 'cc0 1.0': 'CC0-1.0', 'Creative Commons 0': 'CC0-1.0', 'CC-BY-3.0': 'CC-BY-3.0', 'CC BY 4.0': 'CC-BY-4.0', 'Attribution 4.0': 'CC-BY-4.0', 'cc_by_3.0': 'CC-BY-3.0' };
  for (const [raw, id] of Object.entries(ok)) assert.deepEqual(normaliseLicence(raw), { id }, raw);
});

test('each refused licence says why: NC, Sampling+, share-alike, no-derivatives, non-CC0 public domain, unknown, missing', () => {
  const refused = {
    'CC-BY-NC-4.0': /non-commercial/,
    'CC BY-NC 3.0': /non-commercial/,
    'Attribution NonCommercial 4.0': /non-commercial/,
    'Attribution Noncommercial': /non-commercial/,
    'Sampling+': /Sampling\+/,
    'sampling plus 1.0': /Sampling\+/,
    'CC-BY-SA-4.0': /share-alike/,
    'Attribution-ShareAlike 4.0': /share-alike/,
    'CC BY-ND 4.0': /forbids changes/,
    'Public Domain': /public domain but not CC0.*O-C4/,
    'PDM 1.0': /O-C4/,
    'PD-self': /O-C4/,
    'CC-PDM-1.0': /O-C4/,
    Attribution: /say which version/,
    'CC BY': /say which version/,
    'CC BY 2.0': /only CC BY 3.0 and 4.0/,
    GPL: /not a licence this kit knows/,
    'royalty free': /not a licence this kit knows/,
    '': /missing/,
  };
  for (const [raw, why] of Object.entries(refused)) {
    const r = normaliseLicence(raw);
    assert.ok(r.error, `${raw} must be refused`);
    assert.match(r.error, why, raw);
  }
});

const owner = { where: 't', file: 'a.wav', kind: '1', sound: 'middle', source: 'owner', licence: 'owner-made', author: 'VANDE owner', url: '', date: '2026-11-05' };
const fs = { where: 't', file: 'b.wav', kind: '6', sound: '', source: 'freesound', licence: 'CC-BY-4.0', author: 'someuser', url: 'https://freesound.org/people/someuser/sounds/123456/', date: '2021-04-02', title: 'Ball hits pad' };
const si = { where: 't', file: 'c.wav', kind: '10', sound: 'stumps', source: 'stand-in', licence: 'CC0', author: 'Kenney', url: 'https://kenney.nl/assets/impact-sounds', date: '2020-01-01', label: 'stand-in' };

test('valid entries pass and are normalised; a kind with one sound needs no sound column', () => {
  for (const e of [owner, fs, si]) assert.equal(validateEntry(e).ok, true, JSON.stringify(validateEntry(e).problems));
  assert.equal(validateEntry(fs).value.sound, 'pad');
  assert.equal(validateEntry(fs).value.licenceUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.deepEqual(validateEntry(fs).warnings, []);
  assert.match(validateEntry({ ...fs, author: 'Some Person' }).warnings[0], /not the Freesound user/);
});

test('every missing or wrong field is refused, with the reason', () => {
  const bad = [
    [{ ...owner, file: '' }, /file name is missing/],
    [{ ...owner }, /no file called/, { fileExists: false }],
    [{ ...owner, kind: '' }, /kind .* is missing/],
    [{ ...owner, kind: '15' }, /not a number from 1 to 11/],
    [{ ...owner, kind: '12' }, /crowd sounds/],
    [{ ...owner, kind: '13' }, /no bowler footsteps/],
    [{ ...owner, sound: '' }, /needs the sound column: one of sweet, middle, mistimed/],
    [{ ...owner, sound: 'pad' }, /not part of kind 1/],
    [{ ...owner, source: '' }, /source .* is missing/],
    [{ ...owner, source: 'youtube' }, /must be owner, freesound or stand-in/],
    [{ ...owner, licence: 'CC0' }, /must say owner-made/],
    [{ ...fs, licence: 'owner-made' }, /cannot be owner-made/],
    [{ ...fs, licence: 'CC-BY-NC-4.0' }, /non-commercial/],
    [{ ...owner, author: '' }, /author .* is missing/],
    [{ ...fs, url: '' }, /url .* is missing/],
    [{ ...fs, url: 'https://freesound.org/search/?q=bat' }, /not a Freesound sound page/],
    [{ ...si, label: '' }, /must have the label stand-in/],
    [{ ...si, url: 'https://example.com/hit.wav' }, /stand-ins come from kenney.nl, opengameart.org, freesound.org only/],
    [{ ...owner, label: 'stand-in' }, /only for source stand-in/],
    [{ ...owner, date: '' }, /date .* is missing/],
    [{ ...owner, date: '2026-02-30' }, /not a real date/],
    [{ ...owner, date: '05/11/2026' }, /not a real date/],
    [{ ...owner, start: '2', end: '1' }, /end must be after start/],
    [{ ...owner, start: 'x' }, /must be a number of seconds/],
  ];
  for (const [e, why, opt] of bad) {
    const r = validateEntry(e, opt);
    assert.equal(r.ok, false, JSON.stringify(e));
    assert.ok(r.problems.some((p) => why.test(p)), `${why}: ${r.problems.join(' | ')}`);
  }
});

test('the CSV reader handles quotes, commas, doubled quotes, comments, a BOM and Windows line ends', () => {
  const rows = parseCsv('﻿file,title\r\n# a comment\r\n"a, b.wav","say ""tock"", twice"\r\n\r\nc.wav,plain\n');
  assert.deepEqual(rows.map((r) => r.cells), [['file', 'title'], ['a, b.wav', 'say "tock", twice'], ['c.wav', 'plain']]);
});

test('the kinds table is the shipped manifest: every contact sound, in its inventory kind', () => {
  const contacts = manifest.RECORDED_KINDS.filter((k) => k.align === 'onset');
  assert.deepEqual([...ALL_SOUNDS].sort(), contacts.map((k) => k.key).sort());
  for (const k of contacts) assert.equal(kindOf(k.key), k.inventory, k.key);
  for (const k of Object.values(KINDS)) for (const words of Object.values(k.sounds)) assert.ok(words.length > 10);
});
