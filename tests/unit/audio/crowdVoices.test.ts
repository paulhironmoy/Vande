/**
 * The synthesised crowd reactions (src/audio/crowdVoices.ts, src/audio/dsp.ts) and the voice bank (src/audio/bank.ts):
 * deterministic renders, each at its own loudness (ITU-R BS.1770) under a safe peak, distinct timbres and shapes, a
 * contiguous effects sprite, and banks that build in idle slices but never during a delivery.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CROWD_RATE, CROWD_RECIPES, crowdRender, renderCrowd } from '@/audio/crowdVoices';
import { integratedLoudness } from '@/audio/loudness';
import { FX_SOURCES, fxLayout, type FxId } from '@/audio/bank';
import type { CrowdReaction } from '@/audio/emotion';
import { FakeContext, installFakeAudio, type FakeSource } from './fakeAudio';

const KINDS = Object.keys(CROWD_RECIPES) as CrowdReaction[];
const renders = new Map(KINDS.map((k) => [k, renderCrowd(k)]));
const brightness = (x: Float32Array) => {
  let d = 0;
  let a = 0;
  for (let i = 1; i < x.length; i++) {
    d += Math.abs(x[i] - x[i - 1]);
    a += Math.abs(x[i]);
  }
  return d / a;
};
/** Where the energy sits in time (s). */
const centre = (x: Float32Array) => {
  let e = 0;
  let te = 0;
  for (let i = 0; i < x.length; i++) {
    e += x[i] * x[i];
    te += i * x[i] * x[i];
  }
  return te / e / CROWD_RATE;
};

describe('crowd reactions', () => {
  it('render deterministically, finite, at their length, under a 0.95 peak, at their own loudness', () => {
    for (const k of KINDS) {
      const x = renders.get(k)!;
      expect(x.length).toBe(Math.ceil(CROWD_RECIPES[k].seconds * CROWD_RATE));
      expect(x.every(Number.isFinite)).toBe(true);
      expect(Math.max(...x.map(Math.abs))).toBeLessThanOrEqual(0.95 + 1e-6);
      expect(integratedLoudness([x], CROWD_RATE)).toBeCloseTo(CROWD_RECIPES[k].lufs, 0);
    }
    expect(renderCrowd('ooh')).toEqual(renders.get('ooh'));
  });

  it('render the same in idle-sized chunks as in one go', () => {
    const job = crowdRender('cheer');
    const out = new Float32Array(job.length);
    for (let i = 0; i < job.length; i += 512) job.render(out, i, Math.min(job.length, i + 512));
    job.finish(out);
    expect(out).toEqual(renders.get('cheer'));
  });

  it('keep their order and character: a six above a four, dark vowels for dismay, bright claps', () => {
    const lufs = (k: CrowdReaction) => CROWD_RECIPES[k].lufs;
    expect(lufs('eruption')).toBeGreaterThan(lufs('cheer'));
    expect(lufs('cheer')).toBeGreaterThan(lufs('applause'));
    expect(lufs('applause')).toBeGreaterThan(lufs('relief'));
    const b = (k: CrowdReaction) => brightness(renders.get(k)!);
    expect(b('ooh')).toBeLessThan(b('cheer') - 0.1);
    expect(b('groan')).toBeLessThan(b('cheer') - 0.1);
    expect(b('dismay')).toBeLessThan(b('cheer') - 0.1);
    for (const k of ['ooh', 'groan', 'lift', 'cheer', 'eruption', 'dismay'] as const) expect(b('applause')).toBeGreaterThan(b(k) + 0.2);
    // A gasp is front-loaded; dismay rises slowly out of the silence; an ovation is sustained.
    expect(centre(renders.get('ooh')!)).toBeLessThan(0.45);
    expect(centre(renders.get('dismay')!)).toBeGreaterThan(0.5);
    expect(centre(renders.get('ovation')!)).toBeGreaterThan(1.5);
  });
});

describe('the voice bank', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('lays every effect out once, in order, without overlaps', () => {
    const { slots, seconds } = fxLayout();
    const ids = FX_SOURCES.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    let end = 0;
    for (const id of ids as FxId[]) {
      const [offset, len] = slots[id];
      expect(offset).toBeGreaterThan(end);
      end = offset + len;
    }
    expect(seconds).toBeGreaterThan(end);
    expect(seconds).toBeLessThan(12);
  });

  it('renders the sprite offline, then plays each cue from it with two nodes; crowd reactions build in idle slices, never while quiet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.resetModules();
    installFakeAudio();
    const engine = await import('@/audio/engine');
    const bank = await import('@/audio/bank');
    engine.installAudioUnlock();
    window.dispatchEvent(new Event('pointerdown'));
    const g = engine.currentGraph()!;
    expect(g).not.toBeNull();
    expect(bank.playFx(g, 'sweet', 0.1, 1)).toBe(false);
    engine.setQuiet(true);
    bank.prepareBanks();
    await vi.advanceTimersByTimeAsync(40);
    expect(bank.fxReady()).toBe(true);
    // Every effect was rendered into the offline context inside its own slot.
    const offline = FakeContext.made[1];
    const { slots } = fxLayout();
    const starts = offline.sources().flatMap((s) => s.starts.map((x) => x.when));
    for (const [id] of FX_SOURCES) expect(starts.some((t) => t >= slots[id][0] && t < slots[id][0] + slots[id][1])).toBe(true);
    // Quiet: the crowd build waits.
    await vi.advanceTimersByTimeAsync(2000);
    expect(bank.crowdReady('lift')).toBe(false);
    engine.setQuiet(false);
    for (let i = 0; i < 400 && !bank.crowdReady('ovation'); i++) await vi.advanceTimersByTimeAsync(30);
    for (const k of KINDS) expect(bank.crowdReady(k)).toBe(true);
    // A cue: one buffer source and one gain, its slot exactly.
    const count = (g.ctx as unknown as FakeContext).nodes.length;
    expect(bank.playFx(g, 'sweet', 0.5, 0.8)).toBe(true);
    const made = (g.ctx as unknown as FakeContext).nodes.slice(count);
    expect(made.map((n) => n.kind)).toEqual(['buffer', 'gain']);
    expect((made[0] as FakeSource).starts).toEqual([{ when: 0.5, offset: slots.sweet[0], duration: slots.sweet[1] }]);
    expect(bank.playCrowdReaction(g, 'eruption', 1, 0.7)).toBe(true);
  });
});
