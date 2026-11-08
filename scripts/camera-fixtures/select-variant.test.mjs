/** Tests of the variant selection rule (scripts/camera-fixtures/select-variant.mjs). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { score, select } from './select-variant.mjs';

const clip = (validRate, rms) => ({ validRate, landmarks: { wristL: { rmsU: rms }, wristR: { rmsU: rms } } });

test('the score rewards valid frames and punishes wrist error', () => {
  assert.ok(score(clip(1, 0.05)) > score(clip(1, 0.2)));
  assert.ok(score(clip(0.99, 0.05)) > score(clip(0.9, 0.05)));
});

test('the best look wins when the hero skin is clearly worse', () => {
  const w = select({ clips: { navy_dark: clip(0.7, 0.1), navy_mid: clip(0.98, 0.06), tee_dark: clip(0.6, 0.2), tee_mid: clip(0.95, 0.07) } });
  assert.equal(w.name, 'navy_mid');
});

test("a hero-skin look within 0.02 of the best wins (it keeps the fixtures closest to the game's character)", () => {
  const w = select({ clips: { navy_dark: clip(0.985, 0.06), navy_mid: clip(1, 0.05), tee_dark: clip(0.5, 0.2), tee_mid: clip(0.9, 0.1) } });
  assert.equal(w.name, 'navy_dark');
});

test('a variant that was not measured is ignored and nothing measured is an error', () => {
  assert.equal(select({ clips: { tee_mid: clip(0.9, 0.1) } }).name, 'tee_mid');
  assert.throws(() => select({ clips: {} }));
});
