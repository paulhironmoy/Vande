// @vitest-environment node
/**
 * The golden fixture (P3 freeze for the Unity port): a few exact cases of the Director, with the numbers a port must reproduce.
 *
 * Each case is a seed (the delivery key and the person), the anchors as plain numbers, the test world that answers the three
 * callbacks (world.ts: a small analytic cricket world; the port re-implements those few functions), the plan's events and a
 * selection of trace frames as exact Int16 values, plus a hash of the whole trace. This test rebuilds every case and compares
 * it with fixtures/golden.json; any change to the Director's output (a parameter, a draw, a formula) fails here and must be a
 * deliberate new freeze: `UPDATE_GOLDEN=1 npx vitest run tests/unit/render3d/director/golden.test.ts` rewrites the file.
 *
 * What a port can promise: the keys, the draws and the events are integer arithmetic and float32 rounding of double results, the
 * trace is rounded to Int16 steps (channels.ts SCALE). Different `sin`, `cos`, `exp`, `log` implementations may differ in the
 * last bit of a double, so a port compares events within 1e-3 and trace samples within 2 steps (the hash is exact in the same
 * engine only and is there to catch a change here, not to be matched in C#).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import P from '@/render3d/core/motion/director/params.json';
import { CHANNELS, deliveryTakeKey, fnv1a32, prepare, type DirectorAnchors, type DirectorPlan } from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, type BallSpec } from './world';

const FILE = `${process.cwd()}/tests/unit/render3d/director/fixtures/golden.json`;

interface Case {
  name: string;
  role: 'bowler' | 'striker';
  person: string;
  key: string;
  /** The test world: the ball and the release (world.ts delivery), absent for a scene between balls. */
  world: (BallSpec & { release: number }) | { idleMs: number } ;
  /** The anchors options that are not in the world. */
  options: { reducedMotion: boolean; lead: boolean; headPx: number; outcome: string | null };
}

const CASES: Case[] = [
  { name: 'striker six, pace, extrapolated pursuit', role: 'striker', person: 'look-1', key: deliveryTakeKey({ seed: 'golden', overIndex: 2, ballIndex: 3 }), world: { speedKph: 136, lengthM: 6, lineM: 0.05, variation: 0, outcome: 'six', release: 2420 }, options: { reducedMotion: false, lead: true, headPx: 40, outcome: 'six' } },
  { name: 'striker wicket, Reduced Motion', role: 'striker', person: 'look-2', key: deliveryTakeKey({ seed: 'golden', overIndex: 2, ballIndex: 4 }), world: { speedKph: 128, lengthM: 4, lineM: -0.1, variation: 0, outcome: 'bowled', release: 2420 }, options: { reducedMotion: true, lead: true, headPx: 40, outcome: 'wicket' } },
  { name: 'bowler, pace', role: 'bowler', person: 'look-3', key: deliveryTakeKey({ seed: 'golden', overIndex: 2, ballIndex: 3 }), world: { speedKph: 136, lengthM: 6, lineM: 0.05, variation: 0, outcome: 'six', release: 2420 }, options: { reducedMotion: false, lead: true, headPx: 40, outcome: null } },
  { name: 'striker between balls, 20 s with the seam', role: 'striker', person: 'look-1', key: 'golden|idle.1', world: { idleMs: 20_000 }, options: { reducedMotion: false, lead: false, headPx: 40, outcome: null } },
  { name: 'bowler between balls, 20 s with the seam, small head', role: 'bowler', person: 'look-4', key: 'golden|idle.2', world: { idleMs: 20_000 }, options: { reducedMotion: false, lead: false, headPx: 20, outcome: null } },
];

function anchorsOf(c: Case): DirectorAnchors {
  if ('idleMs' in c.world) {
    return { ...idleAnchors(c.role, c.key, c.world.idleMs, { person: c.person, reducedMotion: c.options.reducedMotion }), start: -600, end: c.world.idleMs, seamMs: 600, headMode: 'space', headPx: c.options.headPx };
  }
  const { release, ...spec } = c.world;
  const d = delivery(spec, release);
  const a = anchorsFor(d, { role: c.role, key: c.key, person: c.person, reducedMotion: c.options.reducedMotion, lead: c.options.lead, headPx: c.options.headPx });
  return { ...a, headMode: 'space', outcome: c.options.outcome, runStart: c.role === 'bowler' ? 300 : null, followEnd: c.role === 'bowler' ? release + 1500 : null };
}

const f32 = (x: number): number => Number(Math.fround(x).toPrecision(9));
const round = (a: ArrayLike<number>): number[] => Array.from(a, f32);

/** FNV-1a 32 over the bytes of the trace (little-endian Int16). */
function traceHash(trace: Int16Array): number {
  const bytes = new Uint8Array(trace.buffer, trace.byteOffset, trace.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function build(c: Case) {
  const a = anchorsOf(c);
  const plan: DirectorPlan = prepare(a, { hz: 60 });
  // every 45th frame, the first two and the last: ~1 s of 60 Hz script a frame group
  const frames: number[] = [];
  for (let i = 0; i < plan.n; i += 45) frames.push(i);
  frames.push(1, plan.n - 1);
  frames.sort((x, y) => x - y);
  const picked = [...new Set(frames)];
  return {
    name: c.name,
    role: c.role,
    person: c.person,
    key: c.key,
    world: c.world,
    options: c.options,
    anchors: {
      start: a.start,
      end: a.end,
      gather: a.gather,
      release: a.release,
      swing: a.swing,
      contact: a.contact,
      taskEnd: a.taskEnd,
      outcomeAt: a.outcomeAt,
      outcome: a.outcome ?? null,
      dead: a.dead,
      strokeEnd: a.strokeEnd,
      runs: a.runs,
      runStart: a.runStart ?? null,
      followEnd: a.followEnd ?? null,
      seamMs: a.seamMs ?? null,
      headMode: a.headMode ?? 'overlay',
      reducedMotion: a.reducedMotion,
      headPx: a.headPx,
    },
    keys: { person: fnv1a32(`life|person|${c.person}|${c.role}`), ball: plan.key },
    plan: { t0: plan.t0, hz: plan.hz, n: plan.n, detail: plan.detail, amp: round(plan.amp), draw: round(plan.draw), fix: round(plan.fix), blink: round(plan.blink), micro: round(plan.micro.subarray(0, 30)), fidget: round(plan.fidget), react: round(plan.react) },
    trace: { channels: CHANNELS, hash: traceHash(plan.trace), frames: picked, values: picked.map((i) => Array.from(plan.trace.subarray(i * CHANNELS, (i + 1) * CHANNELS))) },
  };
}

describe('golden fixture: the Director\'s output is frozen for the Unity port', () => {
  const built = CASES.map(build);
  it('is rebuilt exactly from the seeds (UPDATE_GOLDEN=1 writes a new freeze)', () => {
    const doc = { contract: 'director/3', paramsBytes: JSON.stringify(P).length, channels: CHANNELS, cases: built };
    if (process.env.UPDATE_GOLDEN === '1') {
      writeFileSync(FILE, JSON.stringify(doc) + '\n');
      return;
    }
    const want = JSON.parse(readFileSync(FILE, 'utf8'));
    expect(want.contract).toBe(doc.contract);
    expect(want.channels).toBe(doc.channels);
    expect(want.cases.length).toBe(built.length);
    for (let k = 0; k < built.length; k++) {
      const w = want.cases[k];
      const g = JSON.parse(JSON.stringify(built[k]));
      expect(g.keys, built[k].name).toEqual(w.keys);
      expect(g.anchors, built[k].name).toEqual(w.anchors);
      expect(g.plan, built[k].name).toEqual(w.plan);
      expect(g.trace.frames, built[k].name).toEqual(w.trace.frames);
      expect(g.trace.values, built[k].name).toEqual(w.trace.values);
      expect(g.trace.hash, built[k].name).toBe(w.trace.hash);
    }
  });

  it('covers what a port must get right: every channel moves in some case, the events are there, and the sizes are a few kilobytes', () => {
    const moved = new Set<number>();
    for (const c of built) for (const row of c.trace.values) row.forEach((v, ch) => v !== 0 && moved.add(ch));
    // the head in space, the lids, the raw gaze, the breath, the sway, the exertion, the four expression weights the plan makes, the posture and the twist
    // (in 'space' mode the eyes' own channels 3-6 and 9 are not written: the stage takes the eyes from the gaze and the head it drew)
    for (const ch of [0, 1, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23]) expect(moved.has(ch), `channel ${ch} moves in some case`).toBe(true);
    // the effort (18) is the runtime's own, from the swing: never in a plan
    expect(moved.has(18)).toBe(false);
    expect(built.some((c) => c.plan.fidget.length > 0)).toBe(true);
    expect(built.some((c) => c.plan.react.length > 0)).toBe(true);
    expect(built.some((c) => c.plan.fix.some((_, i) => i % 5 === 1 && c.plan.fix[i] === 4))).toBe(true);
    const bytes = readFileSync(FILE).length;
    expect(bytes).toBeLessThan(60_000);
  });
});
