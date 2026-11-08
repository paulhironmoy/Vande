/**
 * The owner's one command, end to end, on synthetic recordings made here (original, seeded) in a throwaway copy of the
 * files it touches: licence refusals, clipped, crowded and noisy hits refused with their reasons, the onset of every
 * staged take where src/audio/takes.ts finds it, determinism, the proposed patches applying cleanly, and --apply
 * swapping a sound's placeholders for the recordings in one step.
 *
 *   node --test scripts/audio/ingest-recordings.test.mjs     (needs ffmpeg; Node 22.22.2+ or 23.6+)
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { hitLoudness, rng, samplePeak } from './lib/dsp.mjs';
import { PATHS, loadManifest } from './lib/manifest.mjs';
import { decodeMono, sha256, writeWav } from './lib/media.mjs';
import { renderTake } from './lib/synth.mjs';
import { ingest } from './ingest-recordings.mjs';
import { LEVELS, SOUND_DIR } from './placeholders.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const takes = await import('../../src/audio/takes.ts');
const TMP = mkdtempSync(join(process.env.VANDE_SOUNDKIT_TMP || tmpdir(), 'vande-ingest-test-'));

/** The files the tool reads and writes, copied into a throwaway root. */
function repoCopy(name) {
  const r = join(TMP, name);
  for (const p of [PATHS.manifestTs, PATHS.publicDir, PATHS.unityManifest, PATHS.unityDir, `${SOUND_DIR}/REGISTER.md`, LEVELS, 'scripts/generate-notices.mjs']) {
    mkdirSync(join(r, p, '..'), { recursive: true });
    cpSync(join(ROOT, p), join(r, p), { recursive: true });
  }
  return r;
}

/** A recording: hits of one recipe placed at `at` seconds, over seeded room noise. Returns the true onsets (s). */
function record(file, { sound, sr = 44100, at, scale = [], noise = 3e-4, channels = 2, before = [], seed = 1 }) {
  const n = Math.round((Math.max(...at) + 1.5) * sr);
  const ch = Array.from({ length: channels }, () => new Float64Array(n));
  const r = rng(seed);
  for (const c of ch) for (let i = 0; i < n; i++) c[i] = (r() * 2 - 1) * noise * Math.sqrt(3);
  const truth = [];
  at.forEach((s, k) => {
    const h = renderTake(sound, k + 1, sr);
    const g = (scale[k] ?? 1) * (0.5 / samplePeak(h));
    const a = Math.round(s * sr) - Math.round(0.01 * sr);
    const scaled = h.map((v) => v * g);
    truth.push((a + takes.findOnset(scaled)) / sr);
    for (const c of ch) for (let i = 0; i < h.length && a + i < n; i++) c[a + i] += scaled[i];
    if (before[k]) for (const c of ch) for (let i = -Math.round(0.03 * sr); i < -Math.round(0.02 * sr); i++) c[a + Math.round(0.01 * sr) + i] += before[k] * Math.sin(i * 0.9);
  });
  writeWav(file, ch.map((c) => Float32Array.from(c, (v) => Math.max(-1, Math.min(1, v)))), sr);
  return truth;
}

function inbox(name) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const truth = record(join(dir, 'bat-middle.wav'), { sound: 'middle', at: [0.6, 2.6, 4.6, 6.6, 8.6, 10.6, 12.6], scale: [1, 1, 1, 1, 1, 4, 1], before: [0, 0, 0, 0, 0, 0, 0.03] });
  record(join(dir, 'gloves-fs.wav'), { sound: 'gloves', sr: 48000, channels: 1, at: [0.5, 2.5, 4.5, 6.5], seed: 2 });
  record(join(dir, 'gloves-standin.wav'), { sound: 'gloves', sr: 48000, channels: 1, at: [0.5, 2.5, 4.5], seed: 3 });
  record(join(dir, 'pad-noisy.wav'), { sound: 'pad', at: [0.5, 2.5, 4.5], noise: 1e-2, scale: [0.6, 0.6, 0.6], seed: 4 });
  record(join(dir, 'nick-nc.wav'), { sound: 'edge_thin', at: [0.5, 2.5, 4.5], seed: 5 });
  record(join(dir, 'unlisted.wav'), { sound: 'bounce', at: [0.5], seed: 6 });
  writeFileSync(
    join(dir, 'sources.csv'),
    [
      'file,kind,sound,source,licence,author,url,date,title,label,description,start,end',
      '# synthetic test recordings (original, seeded)',
      'bat-middle.wav,1,middle,owner,owner-made,VANDE owner,,2026-11-05,,,"willow bat, leather ball",,',
      'gloves-fs.wav,8,gloves,freesound,CC-BY-4.0,someuser,https://freesound.org/people/someuser/sounds/123456/,2021-04-02,"Keeper, glove catch",,,,',
      'gloves-standin.wav,8,gloves,stand-in,CC0,Kenney,https://kenney.nl/assets/impact-sounds,2020-01-01,Impact,stand-in,,,',
      'pad-noisy.wav,6,,owner,owner-made,VANDE owner,,2026-11-05,,,,,',
      'nick-nc.wav,3,,freesound,CC-BY-NC-4.0,other,https://freesound.org/people/other/sounds/42/,2019-01-01,Nick,,,,',
    ].join('\n'),
  );
  return { dir, truth };
}

const repo = repoCopy('repo');
const box = inbox('inbox');
const first = await ingest({ inbox: box.dir, out: join(TMP, 'out-1'), root: repo });

test('licence and description problems are refused with their reasons; nothing else is lost', () => {
  const p = first.problems.map((x) => `${x.file}: ${x.reason}`);
  assert.ok(p.some((s) => /^nick-nc\.wav: .*non-commercial/.test(s)), p.join('\n'));
  assert.ok(p.some((s) => /^unlisted\.wav: no line in sources\.csv/.test(s)), p.join('\n'));
  assert.equal(p.length, 2, p.join('\n'));
});

test('clipped, crowded and noisy hits are refused, each with its reason; stand-ins give way to real recordings', () => {
  const r = first.refused.map((x) => `${x.file}@${x.at}: ${x.reason}`);
  assert.ok(r.some((s) => /^bat-middle\.wav@10\.6\d*: clipped/.test(s)), r.join('\n'));
  assert.ok(r.some((s) => /^bat-middle\.wav@12\.6\d*: something else was sounding just before/.test(s)), r.join('\n'));
  assert.equal(first.refused.filter((x) => x.file === 'pad-noisy.wav' && /too noisy/.test(x.reason)).length, 3, r.join('\n'));
  assert.ok(first.dropped.filter((d) => d.file === 'gloves-standin.wav').every((d) => /stand-ins only stand in when nothing real exists/.test(d.reason)));
  assert.equal(first.dropped.filter((d) => d.file === 'gloves-standin.wav').length, 3);
  assert.deepEqual(Object.keys(first.ready).sort(), ['gloves', 'middle']);
  assert.equal(first.ready.middle.length, 5);
  assert.equal(first.ready.gloves.length, 4);
});

test('each hit is found where it is, and every staged take has its onset where takes.ts finds it: 3 ms in, ± 0.5 ms', () => {
  first.ready.middle.forEach((t, i) => assert.ok(Math.abs(t.at - box.truth[i]) <= 0.001, `${t.file}: ${t.at} vs ${box.truth[i]}`));
  const levels = JSON.parse(readFileSync(join(repo, LEVELS), 'utf8'));
  for (const [sound, list] of Object.entries(first.ready)) {
    for (const t of list) {
      const x = decodeMono(join(first.stage, 'audio', t.file), 48000);
      assert.ok(Math.abs((takes.findOnset(x) / 48000) * 1000 - 3) <= 0.5, `${t.file} onset ${(takes.findOnset(x) / 48) | 0}`);
      assert.ok(samplePeak(x) <= 0.95, `${t.file} peak`);
      if (!t.m.limitedByPeak) assert.ok(Math.abs(hitLoudness(x, 48000) - levels.voices[sound].hit_lufs) <= 0.5, `${t.file} level`);
      assert.equal(sha256(readFileSync(join(first.stage, 'audio', t.file))), t.sha256);
    }
  }
});

test('names, register rows and honest labels: stable names, the next free register ids, the truth about the source', () => {
  assert.deepEqual(first.ready.middle.map((t) => t.file), ['middle-1.mp3', 'middle-2.mp3', 'middle-3.mp3', 'middle-4.mp3', 'middle-5.mp3']);
  assert.deepEqual(first.ready.middle.map((t) => t.register), ['TC-01-01', 'TC-01-02', 'TC-01-03', 'TC-01-04', 'TC-01-05']);
  assert.equal(first.ready.gloves[0].register, 'TC-08-02', 'TC-08-01 is already in the register');
  assert.match(first.sets.middle.honest, /^Recorded by the VANDE owner \(owner-made, phone recording, 2026-11-05\): willow bat, leather ball\. A staged recording, not from a match\.$/);
  assert.match(first.sets.gloves.honest, /^Licensed recording from Freesound \(CC BY 4\.0\) by someuser: "Keeper, glove catch"\./);
  const md = readFileSync(join(first.stage, 'SUMMARY.md'), 'utf8');
  assert.match(md, /\*\*Ready for the game:\*\* middle \(5 takes\), gloves \(4 takes\)/);
});

test('the proposed manifest and notices patches apply cleanly, and the notices credit every CC BY take', () => {
  for (const patch of ['recordedManifest.patch', 'ProductionRecordedManifest.patch', 'notices.patch']) {
    const text = readFileSync(join(first.stage, patch), 'utf8');
    assert.match(text, /^--- a\/.+\n\+\+\+ b\/.+\n@@ /, patch);
    execFileSync('git', ['apply', '--check', join(first.stage, patch)], { cwd: repo });
  }
  // Applied, the lead's generator still parses (an apostrophe once broke its single-quoted strings).
  const n = join(TMP, 'notices-check');
  mkdirSync(join(n, 'scripts'), { recursive: true });
  cpSync(join(repo, 'scripts/generate-notices.mjs'), join(n, 'scripts/generate-notices.mjs'));
  execFileSync('git', ['apply', join(first.stage, 'notices.patch')], { cwd: n });
  execFileSync(process.execPath, ['--check', join(n, 'scripts/generate-notices.mjs')]);
  // Wrapped as the existing notice block is (continuation lines indented by two spaces).
  const notices = readFileSync(join(first.stage, 'notices-lines.txt'), 'utf8').replace(/\n {2}/g, ' ');
  for (const t of first.ready.gloves) assert.match(notices, new RegExp(`- ${t.file}: "Keeper, glove catch" by someuser \\(https://freesound\\.org/people/someuser/sounds/123456/\\), licensed CC BY 4\\.0 \\(https://creativecommons\\.org/licenses/by/4\\.0/\\)\\. Changed\\.`));
  assert.doesNotMatch(notices, /middle-/, 'owner-made needs no third-party notice');
  assert.match(readFileSync(join(first.stage, 'notices.patch'), 'utf8'), /\+line\('Fonts: .*except the licensed recordings listed below and VANDE\\'s own recordings\.'\);/);
});

test('deterministic: the same inbox gives the same bytes and the same patches', async () => {
  const again = await ingest({ inbox: box.dir, out: join(TMP, 'out-2'), root: repo });
  const files = (d) => readdirSync(join(d, 'audio')).sort().map((f) => [f, sha256(readFileSync(join(d, 'audio', f)))]);
  assert.deepEqual(files(again.stage), files(first.stage));
  for (const f of ['recordedManifest.patch', 'ProductionRecordedManifest.patch', 'notices.patch', 'register-rows.md']) assert.equal(readFileSync(join(again.stage, f), 'utf8'), readFileSync(join(first.stage, f), 'utf8'), f);
});

test('--apply swaps a sound’s placeholders for its recordings in one step, and leaves every other sound alone', async () => {
  const r = repoCopy('repo-apply');
  const ph = (dir) => readdirSync(join(r, dir)).filter((f) => /^ph-(middle|gloves)-/.test(f));
  assert.ok(ph(PATHS.publicDir).length >= 6, 'placeholders before');
  const before = await loadManifest(r);
  assert.equal(before.sets.middle.placeholder, true);
  const applied = await ingest({ inbox: box.dir, out: join(TMP, 'out-apply'), root: r, apply: true });
  assert.ok(applied.applied.removed.length >= 12);
  assert.deepEqual(ph(PATHS.publicDir), [], 'no placeholder of a swapped sound is left on the web');
  assert.deepEqual(ph(PATHS.unityDir), [], 'nor in Unity (files and .meta)');
  const after = await loadManifest(r);
  for (const sound of ['middle', 'gloves']) {
    const s = after.sets[sound];
    assert.equal(s.placeholder, false, sound);
    assert.doesNotMatch(s.honest, /placeholder/i);
    for (const t of s.takes) {
      for (const dir of [PATHS.publicDir, PATHS.unityDir]) assert.equal(sha256(readFileSync(join(r, dir, t.file))), t.sha256, `${dir}/${t.file}`);
      assert.ok(existsSync(join(r, PATHS.unityDir, `${t.file}.meta`)));
    }
    const kind = after.kinds.find((k) => k.key === sound);
    assert.equal(kind.placeholder, undefined);
    assert.equal(kind.takes.length, s.takes.length);
  }
  for (const k of after.contactKeys.filter((k) => !['middle', 'gloves'].includes(k))) assert.deepEqual(after.sets[k], before.sets[k], `${k} untouched`);
  const cs = readFileSync(join(r, PATHS.unityManifest), 'utf8');
  assert.match(cs, /"middle", new ProductionContactTakeSet\(false,/);
  assert.doesNotMatch(cs, /ph-middle-|ph-gloves-/);
  const reg = readFileSync(join(r, SOUND_DIR, 'REGISTER.md'), 'utf8');
  assert.equal((reg.match(/\| TC-01-0\d \| `middle-\d\.mp3` \|/g) ?? []).length, 5);
  assert.doesNotMatch(reg, /`ph-(middle|gloves)-\d\.mp3`/, 'their placeholder rows (§8) go with their files');
  assert.match(reg, /`ph-pad-1\.mp3`/, 'other placeholder rows stay');
  // A second apply of the same inbox changes nothing and duplicates no register row.
  const snapshot = [readFileSync(join(r, PATHS.manifestTs), 'utf8'), cs, reg];
  await ingest({ inbox: box.dir, out: join(TMP, 'out-apply-2'), root: r, apply: true });
  assert.deepEqual([readFileSync(join(r, PATHS.manifestTs), 'utf8'), readFileSync(join(r, PATHS.unityManifest), 'utf8'), readFileSync(join(r, SOUND_DIR, 'REGISTER.md'), 'utf8')], snapshot);
});

test('a refusal never touches the repository: without --apply, nothing outside the staging folder changes', () => {
  for (const p of [PATHS.manifestTs, PATHS.unityManifest, `${SOUND_DIR}/REGISTER.md`]) assert.equal(readFileSync(join(repo, p), 'utf8'), readFileSync(join(ROOT, p), 'utf8'), p);
  assert.deepEqual(readdirSync(join(repo, PATHS.publicDir)).sort(), readdirSync(join(ROOT, PATHS.publicDir)).sort());
});
