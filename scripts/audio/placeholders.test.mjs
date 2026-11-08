/**
 * The shipped placeholders are exactly what scripts/audio/placeholders.mjs renders today (byte for byte), both
 * manifests' generated blocks are untouched by hand, the Unity copies are byte-identical, every take keeps the rules
 * (onset at the 3 ms pre-roll where src/audio/takes.ts finds it, peak ≤ 0.95, levelled to the live synthesised voice,
 * the applause takes' MP3 format), and the labels say placeholder.
 *
 *   node --test scripts/audio/placeholders.test.mjs     (needs ffmpeg; Node 22.22.2+ or 23.6+)
 */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { hitLoudness, samplePeak } from './lib/dsp.mjs';
import { PATHS, PLACEHOLDER_HONEST, loadManifest, unityMeta } from './lib/manifest.mjs';
import { decodeMono, formatProblems, measureReference, sha256 } from './lib/media.mjs';
import { RECIPES } from './lib/synth.mjs';
import { LEVELS, SOUND_DIR, TAKES, generate, placeholderRegisters } from './placeholders.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const takes = await import('../../src/audio/takes.ts');
const shipped = await loadManifest(ROOT);
const fresh = await generate({ root: ROOT, out: mkdtempSync(join(process.env.VANDE_SOUNDKIT_TMP || tmpdir(), 'vande-ph-test-')) });

test('every contact sound without a recording has placeholders, and every recipe is used', () => {
  const unrecorded = shipped.contactKeys.filter((k) => !shipped.sets[k] || shipped.sets[k].placeholder);
  assert.deepEqual(fresh.keys, unrecorded);
  for (const k of unrecorded) {
    assert.ok(RECIPES[k], k);
    assert.equal(shipped.sets[k].takes.length, TAKES, k);
  }
});

test('reproducible: today’s render is the shipped placeholders byte for byte, and neither manifest block was edited by hand', () => {
  for (const k of fresh.keys) assert.deepEqual(fresh.sets[k], shipped.sets[k], k);
  assert.equal(fresh.proposal.tsPatch, '', 'the TypeScript block is what the tool writes');
  assert.equal(fresh.proposal.csPatch, '', 'the C# block is what the tool writes');
});

test('the Unity copies are byte-identical, each with a stable .meta that keeps the take’s own rate', () => {
  const guids = new Set();
  for (const k of fresh.keys) {
    for (const t of shipped.sets[k].takes) {
      const web = readFileSync(join(ROOT, PATHS.publicDir, t.file));
      assert.equal(sha256(readFileSync(join(ROOT, PATHS.unityDir, t.file))), sha256(web), t.file);
      const meta = readFileSync(join(ROOT, PATHS.unityDir, `${t.file}.meta`), 'utf8');
      assert.equal(meta, unityMeta(t.file));
      assert.match(meta, /sampleRateSetting: 0\n/);
      guids.add(/guid: ([0-9a-f]{32})/.exec(meta)[1]);
    }
  }
  assert.equal(guids.size, fresh.keys.length * TAKES, 'no GUID is shared');
});

test('every take keeps the rules on its decoded audio: onset at 3 ms (takes.ts), peak ≤ 0.95, the live voice’s level, the shipped format', () => {
  const ref = measureReference(join(ROOT, PATHS.publicDir));
  const levels = JSON.parse(readFileSync(join(ROOT, LEVELS), 'utf8'));
  for (const k of fresh.keys) {
    for (const t of shipped.sets[k].takes) {
      const bytes = readFileSync(join(ROOT, PATHS.publicDir, t.file));
      assert.deepEqual(formatProblems(bytes, ref), [], t.file);
      const x = decodeMono(join(ROOT, PATHS.publicDir, t.file), ref.sampleRate);
      assert.ok(Math.abs((takes.findOnset(x) / ref.sampleRate) * 1000 - 3) <= 0.5, `${t.file} onset`);
      assert.ok(samplePeak(x) <= 0.95, `${t.file} peak`);
      assert.ok(Math.abs(hitLoudness(x, ref.sampleRate) - levels.voices[k].hit_lufs) <= 0.5, `${t.file}: ${hitLoudness(x, ref.sampleRate)} vs ${levels.voices[k].hit_lufs}`);
    }
  }
});

test('labelled as placeholders everywhere: the flag, the honest text, ph- names and P register rows', () => {
  for (const k of fresh.keys) {
    const s = shipped.sets[k];
    assert.equal(s.placeholder, true);
    assert.equal(s.honest, PLACEHOLDER_HONEST);
    assert.match(s.honest, /^Placeholder: original synthesised .*not a recording; replace with a recording\.$/);
    for (const t of s.takes) assert.match(t.file, new RegExp(`^ph-${k}-\\d\\.mp3$`));
  }
  const regs = placeholderRegisters(shipped.kinds, ['middle', 'bounce', 'mistimed'], 3);
  assert.deepEqual(regs.middle, ['TC-01-P04', 'TC-01-P05', 'TC-01-P06']);
  assert.deepEqual(regs.bounce, ['TC-09-P04', 'TC-09-P05', 'TC-09-P06']);
  assert.deepEqual(regs.mistimed, ['TC-01-P07', 'TC-01-P08', 'TC-01-P09'], 'ids never move when another sound leaves');
  assert.deepEqual(Object.keys(regs), ['middle', 'mistimed', 'bounce']);
  const onDisk = readdirSync(join(ROOT, PATHS.publicDir)).filter((f) => f.startsWith('ph-'));
  assert.deepEqual(onDisk.sort(), fresh.keys.flatMap((k) => shipped.sets[k].takes.map((t) => t.file)).sort(), 'no stray placeholder file');
});

test('--drop removes one sound’s placeholders in one step (its live voice plays again) and leaves the rest byte-identical', async () => {
  const r = mkdtempSync(join(process.env.VANDE_SOUNDKIT_TMP || tmpdir(), 'vande-ph-drop-'));
  for (const p of [PATHS.manifestTs, PATHS.publicDir, PATHS.unityManifest, PATHS.unityDir, `${SOUND_DIR}/REGISTER.md`, LEVELS]) {
    mkdirSync(join(r, p, '..'), { recursive: true });
    cpSync(join(ROOT, p), join(r, p), { recursive: true });
  }
  await generate({ root: r, write: true, drop: ['pad'], out: join(r, 'stage') });
  const after = await loadManifest(r);
  assert.equal(after.sets.pad, undefined);
  const pad = after.kinds.find((k) => k.key === 'pad');
  assert.equal(pad.takes.length, 0);
  assert.match(pad.honest, /synthesised voice plays \(not a recording\)/);
  for (const dir of [PATHS.publicDir, PATHS.unityDir]) assert.deepEqual(readdirSync(join(r, dir)).filter((f) => f.startsWith('ph-pad-')), [], dir);
  assert.doesNotMatch(readFileSync(join(r, SOUND_DIR, 'REGISTER.md'), 'utf8'), /`ph-pad-/);
  for (const k of fresh.keys.filter((k) => k !== 'pad')) assert.deepEqual(after.sets[k], shipped.sets[k], k);
  assert.doesNotMatch(readFileSync(join(r, PATHS.unityManifest), 'utf8'), /"pad", new ProductionContactTakeSet/);
});
