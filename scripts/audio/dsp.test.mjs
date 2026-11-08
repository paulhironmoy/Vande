/**
 * Sound-kit DSP: the onset is src/audio/takes.ts's own (checked against the module itself), BS.1770 is BS.1770,
 * trimming keeps exactly the runtime's pre-roll, and the noise, clipping and hit detectors behave on synthetic signals
 * made here (original test signals, seeded).
 *
 *   node --test scripts/audio/dsp.test.mjs        (Node 22.22.2+ or 23.6+, which read the TypeScript sources directly)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ONSET_RATIO, PREROLL_MS, clipCheck, detectHits, findOnset, hitLoudness, integratedLufs, kWeighting, noiseFloor, rng, trimToOnset } from './lib/dsp.mjs';

const takes = await import('../../src/audio/takes.ts');
const manifest = await import('../../src/audio/recordedManifest.ts');
const SR = 48000;

function hit(len, at, { peak = 0.8, f = 1500, decay = 0.02, sr = SR } = {}) {
  const x = new Float64Array(len);
  for (let i = at; i < len; i++) {
    const t = (i - at) / sr;
    x[i] += peak * Math.exp(-t / decay) * Math.sin(2 * Math.PI * f * t + 0.3);
  }
  return x;
}

test('findOnset is takes.ts findOnset, on every signal tried, and the ratio and pre-roll are the shipped ones', () => {
  assert.equal(ONSET_RATIO, takes.ONSET_RATIO);
  for (const k of manifest.RECORDED_KINDS.filter((k) => k.align === 'onset')) assert.equal(k.prerollMs, PREROLL_MS, k.key);
  const cs = readFileSync(new URL('../../unity/VandePractice/Assets/VandePractice/Runtime/Audio/Production/ProductionRecordedTakes.cs', import.meta.url), 'utf8');
  assert.match(cs, /ContactPrerollSeconds\s*=\s*0\.003\b/);
  const r = rng(20261103);
  for (let n = 0; n < 300; n++) {
    const len = 1 + Math.floor(r() * 3000);
    const x = new Float32Array(len);
    const kind = n % 5;
    for (let i = 0; i < len; i++) x[i] = kind === 0 ? 0 : (r() * 2 - 1) * (kind === 1 ? 1e-3 : 1) * (kind === 2 && i < len / 2 ? 0.01 : 1);
    if (kind === 3) x[Math.floor(r() * len)] = -1.5;
    if (kind === 4 && len > 10) x.fill(0.25, 3, 7);
    assert.equal(findOnset(x), takes.findOnset(x), `signal ${n}`);
    assert.equal(findOnset(x, 0.3), takes.findOnset(x, 0.3), `signal ${n} at 0.3`);
  }
  const d = new Float32Array(4800);
  for (let i = 0; i < 300; i++) d[i] = 0.004 * Math.sin(i);
  d[336] = 0.05;
  d[337] = -0.9;
  d[338] = 0.7;
  assert.equal(findOnset(d), 337);
  assert.equal(takes.findOnset(d), 337);
});

test('the K-weighting at 48 kHz is BS.1770-4’s published filter, and a full-scale 997 Hz sine reads −3.01 LUFS', () => {
  const [shelf, hp] = kWeighting(48000);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
  [1.53512485958697, -2.69169618940638, 1.19839281085285].forEach((v, i) => near(shelf.b[i], v));
  [1.0, -1.69065929318241, 0.73248077421585].forEach((v, i) => near(shelf.a[i], v));
  [1.0, -1.99004745483398, 0.99007225036621].forEach((v, i) => near(hp.a[i], v));
  const x = new Float64Array(SR * 3);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 997 * i) / SR);
  assert.ok(Math.abs(integratedLufs(x, SR) + 3.01) < 0.05, String(integratedLufs(x, SR)));
  assert.equal(integratedLufs(x.subarray(0, SR * 0.3), SR), null, 'no 400 ms block: no integrated loudness');
  const half = x.map((v) => v * 0.5);
  assert.ok(Math.abs(hitLoudness(half, SR) - (integratedLufs(half, SR) ?? 0)) < 0.1, 'a steady tone: the loudest block is the integrated level');
});

test('trimToOnset keeps exactly the 3 ms pre-roll before the takes.ts onset, fading in over it', () => {
  for (const at of [500, 1000, 4801]) {
    const x = hit(SR / 2, at);
    for (let i = 0; i < at; i++) x[i] += 1e-4 * Math.sin(i * 1.7);
    const { seg, onset, pre } = trimToOnset(x, SR);
    assert.equal(onset, takes.findOnset(x));
    assert.equal(pre, Math.round((PREROLL_MS * SR) / 1000));
    assert.equal(takes.findOnset(seg), pre, 'the onset sits at the pre-roll in the trimmed take');
    assert.ok(seg[0] === 0, 'the fade-in starts at silence');
    assert.equal(seg[pre], x[onset], 'the onset sample is untouched');
  }
});

test('the noise floor is measured, not assumed: seeded white noise reads within 2 dB of its RMS', () => {
  const r = rng(7);
  for (const rms of [1e-4, 1e-3, 1e-2]) {
    const x = new Float64Array(SR * 2);
    for (let i = 0; i < x.length; i++) x[i] = (r() * 2 - 1) * rms * Math.sqrt(3);
    const got = noiseFloor(x, SR);
    assert.ok(Math.abs(20 * Math.log10(got / rms)) < 2, `${got} vs ${rms}`);
  }
});

test('clipping: a full-scale sample or a flat top in any channel is caught; a clean hit is not', () => {
  const clean = Float32Array.from(hit(4800, 100, { peak: 0.9 }));
  assert.equal(clipCheck([clean], 0, clean.length), null);
  const full = clean.slice();
  full[400] = 1;
  assert.match(clipCheck([clean, full], 0, full.length), /channel 2 reaches full scale/);
  const flat = clean.slice();
  flat.fill(0.7, 600, 605);
  assert.match(clipCheck([flat], 0, flat.length), /flat top/);
  assert.equal(clipCheck([full], 0, 300), null, 'outside the window it does not count');
});

test('detectHits finds each of several hits 2 s apart, over measured room noise', () => {
  const r = rng(11);
  const x = new Float64Array(SR * 9);
  for (let i = 0; i < x.length; i++) x[i] = (r() * 2 - 1) * 3e-4;
  const at = [0.5, 2.5, 4.5, 6.5, 8.2].map((s) => Math.round(s * SR));
  for (const a of at) {
    const h = hit(SR * 0.4, 0, { peak: 0.5 });
    for (let i = 0; i < h.length && a + i < x.length; i++) x[a + i] += h[i];
  }
  const { hits } = detectHits(x, SR);
  assert.equal(hits.length, at.length);
  hits.forEach((h, i) => assert.ok(Math.abs(h.start + takes.findOnset(x.subarray(h.start, h.end)) - at[i]) <= 2, `hit ${i}`));
});
