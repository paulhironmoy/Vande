// @vitest-environment node
/// <reference types="node" />
/**
 * Seeds and sources of the Director. Reason: a replay is only identical if every draw comes from the delivery's key,
 * the key is the one the sound takes use (so the web and Unity agree), and nothing reads a clock or Math.random.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as takes from '@/audio/takes';
import * as seeds from '@/render3d/core/motion/director/seeds';
import { ballKey, deliveryTakeKey, fnv1a32, mix, personKey, u01 } from '@/render3d/core/motion/director';
import { mean, recordFile, record } from './gates';

recordFile('seeds');

/** `splitmix` as src/engine/prng.ts:32 has it (the function is module-private, so it is transcribed here). */
function splitmixSequential(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

describe('seeds: the keys are the ones the sound takes use', () => {
  it('re-exports deliveryTakeKey and fnv1a32 from src/audio/takes (same functions, not copies)', () => {
    expect(seeds.deliveryTakeKey).toBe(takes.deliveryTakeKey);
    expect(seeds.fnv1a32).toBe(takes.fnv1a32);
    expect(deliveryTakeKey).toBe(takes.deliveryTakeKey);
    expect(fnv1a32).toBe(takes.fnv1a32);
  });

  it('FNV-1a 32 gives the published test vectors (the C# port must match them)', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('a delivery key is stable on the exact-ball retry and differs per ball', () => {
    const a = deliveryTakeKey({ seed: 'S', overIndex: 2, ballIndex: 3 });
    expect(deliveryTakeKey({ seed: 'S', overIndex: 2, ballIndex: 3 })).toBe(a);
    expect(a).toBe('S#2.3');
    expect(deliveryTakeKey({ seed: 'S', overIndex: 2, ballIndex: 4 })).not.toBe(a);
    expect(deliveryTakeKey(null)).toBe('unseeded');
  });

  it('person and ball keys follow the documented strings and separate people and balls', () => {
    expect(personKey('look-9', 'striker')).toBe(fnv1a32('life|person|look-9|striker'));
    expect(personKey('look-9', 'bowler')).not.toBe(personKey('look-9', 'striker'));
    const p = personKey('look-9', 'striker');
    expect(ballKey('S#0.1', p)).toBe(fnv1a32(`S#0.1|life|${p}`));
    expect(ballKey('S#0.1', p)).not.toBe(ballKey('S#0.2', p));
    expect(ballKey('S#0.1', p)).not.toBe(ballKey('S#0.1', personKey('look-9', 'bowler')));
  });
});

describe('seeds: draws are splitmix32, stateless', () => {
  it('mix(seed, k) is output k of the engine splitmix, for any seed and any k', () => {
    for (const seed of [0, 1, 0xdeadbeef, 0xffffffff, fnv1a32('S#0.1'), 123456789]) {
      const g = splitmixSequential(seed);
      for (let k = 0; k < 64; k++) expect(mix(seed, k)).toBe(g());
    }
  });

  it('is a uint32, deterministic, and u01 stays in [0, 1)', () => {
    for (let k = 0; k < 1000; k++) {
      const m = mix(77, k);
      expect(Number.isInteger(m) && m >= 0 && m <= 0xffffffff).toBe(true);
      expect(mix(77, k)).toBe(m);
      const u = u01(77, k);
      expect(u >= 0 && u < 1).toBe(true);
    }
  });

  it('is uniform enough that no draw family is biased (mean of 200,000 draws within 0.003 of 0.5)', () => {
    const xs: number[] = [];
    for (let k = 0; k < 200_000; k++) xs.push(u01(fnv1a32('bias'), k));
    const m = mean(xs);
    record('seeds.meanOf200k', m);
    expect(Math.abs(m - 0.5)).toBeLessThan(0.003);
  });

  it('range and gauss use fixed indices (gauss k reads draws 3k .. 3k + 2) and gauss is bounded to +-3', () => {
    expect(seeds.range(5, 3, 2, 4)).toBe(2 + 2 * u01(5, 3));
    expect(seeds.gauss(5, 2)).toBe((u01(5, 6) + u01(5, 7) + u01(5, 8) - 1.5) * 2);
    let lo = Infinity;
    let hi = -Infinity;
    let s = 0;
    let q = 0;
    const n = 50_000;
    for (let k = 0; k < n; k++) {
      const z = seeds.gauss(9, k);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
      s += z;
      q += z * z;
    }
    expect(lo).toBeGreaterThanOrEqual(-3);
    expect(hi).toBeLessThanOrEqual(3);
    expect(Math.abs(s / n)).toBeLessThan(0.02);
    expect(Math.abs(q / n - 1)).toBeLessThan(0.03);
  });
});

describe('seeds: nothing in the Director reads a clock, a random source or a platform-dependent function', () => {
  // vitest runs from the repository root
  const dir = `${process.cwd()}/src/render3d/core/motion/director/`;
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  /** Source text with block and line comments removed (the comments say what is not used). */
  const code = (f: string) => readFileSync(dir + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('finds the director sources', () => {
    expect(files).toEqual(expect.arrayContaining(['seeds.ts', 'noise.ts', 'plan.ts', 'bake.ts', 'director.ts', 'channels.ts', 'types.ts', 'index.ts']));
  });

  it('has no Math.random, Date, performance.now, setTimeout or wall-clock access', () => {
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toMatch(/Math\.random|\bDate\b|performance\.now|setTimeout|setInterval|requestAnimationFrame|crypto\./);
    }
  });

  it('the stage binding (stage/) reads no clock and no random source either: spare time is budgeted by a `now` the stage passes in', () => {
    const sdir = `${dir}stage/`;
    const sfiles = readdirSync(sdir).filter((f) => f.endsWith('.ts'));
    expect(sfiles).toEqual(expect.arrayContaining(['face.ts', 'pose.ts', 'runtime.ts']));
    for (const f of sfiles) {
      const src = readFileSync(sdir + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(src, f).not.toMatch(/Math\.random|\bDate\b|performance\.now|setTimeout|setInterval|requestAnimationFrame|crypto\./);
    }
  });

  it('uses only arithmetic, sin, cos, exp, log, sqrt, pow and rounding (the set a C# port reproduces)', () => {
    const allowed = new Set(['sin', 'cos', 'exp', 'log', 'sqrt', 'pow', 'abs', 'min', 'max', 'floor', 'round', 'imul', 'PI']);
    for (const f of files) {
      for (const m of code(f).matchAll(/Math\.(\w+)/g)) expect(allowed.has(m[1]), `${f}: Math.${m[1]}`).toBe(true);
    }
  });
});
