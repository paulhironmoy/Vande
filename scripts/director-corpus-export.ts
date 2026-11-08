// Exports the web Director's 490-plan parity corpus (corpus.jsonl + manifest.json) that the Unity DirectorCorpusReplay checks: VANDE_DIRECTOR_CORPUS_OUT=<dir> npx vitest run --config scripts/director-corpus-export.vitest.config.mjs
// @vitest-environment node
/**
 * UNITY-E1 extended parity corpus exporter (a development tool, never shipped). Runs the WEB Director over a few hundred plans (both roles,
 * with and without Reduced Motion, 'space' and 'overlay' head modes, live and result anchors, varied anchors/outcomes, seam
 * offsets, several laps, head sizes, trace rates, hand-over reuse) and writes, one JSON per line, the inputs (world spec,
 * options, the anchors as plain numbers) and the web's outputs: the events as exact float32 (base64) and the whole Int16 trace
 * (base64). The C# port replays them (DirectorCorpusReplay) and reports the largest |C# - web| in Int16 steps per channel.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { CHANNELS } from '@/render3d/core/motion/director/channels';
import { prepare } from '@/render3d/core/motion/director/director';
import { deliveryTakeKey, fnv1a32, personKey } from '@/render3d/core/motion/director/seeds';
import type { DirectorAnchors, DirectorPlan } from '@/render3d/core/motion/director/types';
import { OUTCOME_CATEGORY, anchorsFor, delivery, idleAnchors, randomSpec, rng, type BallSpec, type Delivery } from '@tests/unit/render3d/director/world';

const OUT = process.env.VANDE_DIRECTOR_CORPUS_OUT ?? '';

const b64 = (a: Float32Array | Int16Array): string => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const hashOf = (t: Int16Array): number => {
  const u = new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) {
    h ^= u[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

type Json = Record<string, unknown>;

function anchorBlock(a: DirectorAnchors): Json {
  return {
    start: a.start, end: a.end, gather: a.gather, release: a.release, swing: a.swing, contact: a.contact, taskEnd: a.taskEnd,
    outcomeAt: a.outcomeAt, outcome: a.outcome ?? null, dead: a.dead, strokeEnd: a.strokeEnd, runs: a.runs,
    runStart: a.runStart ?? null, followEnd: a.followEnd ?? null, seamMs: a.seamMs ?? null, headMode: a.headMode ?? 'overlay',
    reducedMotion: a.reducedMotion, headPx: a.headPx,
  };
}

interface CaseSpec {
  kind: 'delivery' | 'idle';
  role: 'bowler' | 'striker';
  person: string;
  key: string;
  hz: 60 | 120 | 240;
  world: (BallSpec & { release: number }) | { idleMs: number };
  options: { reducedMotion: boolean; lead: boolean; headPx: number; pre: boolean; clip: string; series: string | null; hostile?: string | null };
  /** changes to the world's own anchors (the callbacks stay the world's) */
  patch?: Partial<DirectorAnchors>;
  headMode: 'space' | 'overlay';
  stage?: boolean; // outcome category + the bowler's run anchors, as golden.test.ts anchorsOf
  reuse?: { untilMode: 'safe' | 'late' };
  tag: string;
}

/** A world that fails now and then (deterministic functions of the time): no ball, no aim, flaky answers, NaN and infinity. */
function hostile(a: DirectorAnchors, mode: string): DirectorAnchors {
  const aim = a.aim;
  const ball = a.visibleBall;
  const clip = a.clipHead;
  const idx = (t: number, p: number): number => Math.floor(t / p);
  switch (mode) {
    case 'noball':
      return { ...a, visibleBall: () => false };
    case 'noaim':
      return { ...a, aim: () => false };
    case 'flaky':
      return {
        ...a,
        aim: (tg, t, out) => (idx(t, 37) % 5 === 0 ? false : aim(tg, t, out)),
        visibleBall: (t, out, ahead) => (idx(t, 53) % 3 === 0 ? false : ball(t, out, ahead)),
      };
    case 'nan':
      return {
        ...a,
        aim: (tg, t, out) => {
          const ok = aim(tg, t, out);
          if (idx(t, 41) % 7 === 0) out[0] = NaN;
          return ok;
        },
        visibleBall: (t, out, ahead) => {
          const ok = ball(t, out, ahead);
          if (idx(t, 43) % 6 === 0) out[1] = Infinity;
          return ok;
        },
        clipHead: (t, out) => {
          clip(t, out);
          if (idx(t, 29) % 4 === 0) out[2] = NaN;
        },
      };
    default:
      return a;
  }
}

function buildAnchors(c: CaseSpec): { a: DirectorAnchors; d: Delivery | null } {
  const built = buildAnchors0(c);
  return c.options.hostile ? { a: hostile(built.a, c.options.hostile), d: built.d } : built;
}

function buildAnchors0(c: CaseSpec): { a: DirectorAnchors; d: Delivery | null } {
  if ('idleMs' in c.world) {
    const a = idleAnchors(c.role, c.key, c.world.idleMs, { person: c.person, reducedMotion: c.options.reducedMotion });
    return { a: { ...a, headPx: c.options.headPx, headMode: c.headMode, ...(c.patch ?? {}) }, d: null };
  }
  const { release, ...spec } = c.world;
  const d = delivery(spec, release);
  const base = anchorsFor(d, { role: c.role, key: c.key, person: c.person, reducedMotion: c.options.reducedMotion, lead: c.options.lead, headPx: c.options.headPx, pre: c.options.pre, clip: c.options.clip as 'real' | 'none', series: (c.options.series as 'pace' | 'pace-late' | 'spin' | null) ?? undefined });
  let a: DirectorAnchors = { ...base, headMode: c.headMode };
  if (c.stage) a = { ...a, outcome: c.options.pre || c.role === 'bowler' ? null : OUTCOME_CATEGORY[d.spec.outcome], runStart: c.role === 'bowler' ? 300 : null, followEnd: c.role === 'bowler' ? release + 1500 : null };
  return { a: { ...a, ...(c.patch ?? {}) }, d };
}

function run(c: CaseSpec, id: number): Json {
  const { a, d } = buildAnchors(c);
  const plan: DirectorPlan = prepare(a, { hz: c.hz });
  const rec: Json = {
    id, tag: c.tag, kind: c.kind, role: c.role, person: c.person, key: c.key, hz: c.hz, world: c.world, options: c.options, anchors: anchorBlock(a),
    expected: {
      keys: { person: personKey(c.person, c.role), ball: plan.key },
      plan: { t0: plan.t0, hz: plan.hz, n: plan.n, detail: plan.detail },
      amp: b64(plan.amp), draw: b64(plan.draw), fix: b64(plan.fix), blink: b64(plan.blink), micro: b64(plan.micro), fidget: b64(plan.fidget), react: b64(plan.react),
      trace: b64(plan.trace), hash: hashOf(plan.trace),
    },
  };
  if (c.reuse && d) {
    // the hand-over: the live plan (no result yet), then the plan built from the result with the live frames reused up to a time
    const liveA = anchorsFor(d, { role: c.role, key: c.key, person: c.person, reducedMotion: c.options.reducedMotion, lead: c.options.lead, headPx: c.options.headPx, pre: true, clip: c.options.clip as 'real' | 'none', series: (c.options.series as 'pace' | 'pace-late' | 'spin' | null) ?? undefined });
    const live: DirectorAnchors = { ...liveA, headMode: c.headMode, ...(c.stage ? { outcome: null, runStart: c.role === 'bowler' ? 300 : null, followEnd: c.role === 'bowler' ? (c.world as { release: number }).release + 1500 : null } : {}) };
    const t = d.timeline;
    const safe = Math.min(t.contact === null ? Infinity : t.contact + 125, t.outcomeAt + 180, c.role === 'striker' ? t.strokeEnd ?? Infinity : Infinity, t.dead + 125);
    const untilMs = c.reuse.untilMode === 'safe' ? safe : safe + 2000;
    const livePlan = prepare(live, { hz: c.hz });
    const reused = prepare(a, { hz: c.hz, reuse: { plan: livePlan, untilMs } });
    rec.reuse = { liveAnchors: anchorBlock(live), untilMs, expected: { trace: b64(reused.trace), hash: hashOf(reused.trace), liveHash: hashOf(livePlan.trace) } };
  }
  return rec;
}

it('exports the corpus', () => {
  const cases: CaseSpec[] = [];
  const r = rng(20261107);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const persons = ['look-0', 'look-1', 'look-2', 'look-3', 'look-4', 'look-5', 'look-6', 'look-7', 'seed-aa11', 'हिन्दी-7'];
  const OUTS = ['four', 'six', 'two', 'caught', 'dot', 'missed', 'leave', 'bowled'] as const;
  const series = ['pace', 'pace-late', 'spin'] as const;
  let n = 0;

  // 1. Deliveries: both roles, every outcome, stage ('space') and P1 ('overlay') modes, live and result anchors, Reduced Motion, head sizes.
  for (let i = 0; i < 260; i++) {
    const role = i % 2 === 0 ? 'striker' : 'bowler';
    const spec = randomSpec(r);
    if (i < 16) spec.outcome = OUTS[i % 8]; // every outcome first, both roles
    const release = pick([1500, 2000, 2420, 2420, 2800, 3500, 4200]);
    const rm = r() < 0.25;
    const space = r() < 0.65;
    const pre = r() < 0.2;
    const hz = r() < 0.8 ? 60 : pick([120, 240] as const);
    const clip = r() < 0.15 ? 'none' : 'real';
    const key = deliveryTakeKey({ seed: pick(['corp', 'golden', 'x9', 'over-7f3a']), overIndex: i % 4 === 3 ? undefined : Math.floor(i / 6), ballIndex: i % 5 === 4 ? undefined : i % 6 });
    const patch: Partial<DirectorAnchors> = {};
    if (r() < 0.15) patch.start = pick([-600, 200, 500]);
    if (r() < 0.1) patch.end = release + pick([2500, 3000, 4000]);
    if (r() < 0.2 && role === 'bowler') patch.runStart = pick([null, 0, 300, 900, 1500]);
    if (r() < 0.2 && role === 'bowler') patch.followEnd = release + pick([1000, 2500, 4000]);
    if (r() < 0.1) patch.gather = null;
    if (r() < 0.1 && role === 'striker') patch.strokeEnd = null;
    if (r() < 0.1 && role === 'striker') patch.taskEnd = null;
    if (r() < 0.1) patch.outcomeAt = null;
    if (r() < 0.1) patch.runs = pick([0, 1, 2, 3, 4, 6]);
    cases.push({
      kind: 'delivery', role, person: pick(persons), key, hz, world: { ...spec, release }, headMode: space ? 'space' : 'overlay', stage: space && r() < 0.8,
      options: { reducedMotion: rm, lead: r() < 0.7, headPx: pick([10, 12, 13.9, 20, 37, 38, 40, 44, 60]), pre, clip, series: clip === 'none' ? null : r() < 0.7 ? 'pace' : pick(series) },
      patch, tag: `delivery#${i}`,
    });
    n++;
  }

  // 2. Hand-over: the plan built from the result with the live plan's frames reused (safe moment, and too late on purpose).
  for (let i = 0; i < 24; i++) {
    const role = i % 2 === 0 ? 'striker' : 'bowler';
    const spec = randomSpec(r);
    cases.push({
      kind: 'delivery', role, person: pick(persons), key: deliveryTakeKey({ seed: 'reuse', overIndex: 0, ballIndex: i }), hz: 60, world: { ...spec, release: 2420 }, headMode: i % 3 === 0 ? 'overlay' : 'space', stage: i % 3 !== 0,
      options: { reducedMotion: i % 5 === 0, lead: true, headPx: 40, pre: false, clip: 'real', series: 'pace' }, reuse: { untilMode: i % 4 === 3 ? 'late' : 'safe' }, tag: `handover#${i}`,
    });
  }

  // 3. Scenes between balls: durations, seams (the stage's -600/600, others), Reduced Motion, head sizes, several laps ("key.lap").
  for (let i = 0; i < 96; i++) {
    const role = i % 2 === 0 ? 'striker' : 'bowler';
    const idleMs = pick([3000, 6000, 12000, 20000, 20000, 45000, 60000]);
    const lap = i % 4;
    const base = `${pick(['corp', 'golden', 'scene'])}|idle.${1 + (i % 7)}`;
    const key = lap === 0 ? base : `${base}.${lap}`;
    const seam = r() < 0.75 ? pick([600, 600, 600, 300, 1000]) : null;
    const patch: Partial<DirectorAnchors> = seam === null ? {} : { start: -seam, seamMs: seam };
    if (r() < 0.1) patch.start = pick([0, 250, -250]);
    cases.push({
      kind: 'idle', role, person: pick(persons), key, hz: r() < 0.85 ? 60 : pick([120, 240] as const), world: { idleMs }, headMode: r() < 0.85 ? 'space' : 'overlay',
      options: { reducedMotion: r() < 0.2, lead: false, headPx: pick([10, 20, 40, 60]), pre: false, clip: 'real', series: null }, patch, tag: `idle#${i}`,
    });
  }
  // 4. Pairs of laps of one scene (the next lap is a plan of its own with the key "{key}.{lap}"), and the same scene in Reduced Motion
  for (let i = 0; i < 12; i++) {
    for (const lap of [0, 1]) {
      cases.push({
        kind: 'idle', role: i % 2 ? 'bowler' : 'striker', person: `look-${i % 8}`, key: lap === 0 ? `golden|idle.${i + 1}` : `golden|idle.${i + 1}.${lap}`, hz: 60, world: { idleMs: 20000 },
        headMode: 'space', options: { reducedMotion: false, lead: false, headPx: 40, pre: false, clip: 'real', series: null }, patch: { start: -600, seamMs: 600 }, tag: `laps#${i}.${lap}`,
      });
    }
  }
  // 5. Worlds that fail now and then, and unusual anchors: unknown outcome categories, runs, an end before the release, ten-minute scenes
  const modes = ['noball', 'noaim', 'flaky', 'nan'] as const;
  for (let i = 0; i < 40; i++) {
    const role = i % 2 === 0 ? 'striker' : 'bowler';
    const spec = randomSpec(r);
    const release = pick([2000, 2420, 3000]);
    const patch: Partial<DirectorAnchors> = {};
    if (i % 8 === 5) patch.outcome = pick(['weird', '', 'constructor']);
    if (i % 8 === 6) patch.end = release - 300;
    if (i % 8 === 7) patch.runs = 7;
    cases.push({
      kind: 'delivery', role, person: pick(persons), key: deliveryTakeKey({ seed: 'hostile', overIndex: 1, ballIndex: i }), hz: 60, world: { ...spec, release }, headMode: i % 3 === 0 ? 'overlay' : 'space', stage: i % 3 !== 0,
      options: { reducedMotion: i % 6 === 4, lead: true, headPx: 40, pre: false, clip: 'real', series: 'pace', hostile: modes[i % 4] }, patch, tag: `hostile#${i}`,
    });
  }
  for (let i = 0; i < 16; i++) {
    cases.push({
      kind: 'idle', role: i % 2 ? 'bowler' : 'striker', person: pick(persons), key: `hostile|idle.${i}`, hz: 60, world: { idleMs: pick([6000, 20000, 60000]) }, headMode: 'space',
      options: { reducedMotion: false, lead: false, headPx: 40, pre: false, clip: 'real', series: null, hostile: modes[i % 4] }, patch: { start: -600, seamMs: 600 }, tag: `hostile-idle#${i}`,
    });
  }
  // a bowler who is given a result category (the stage never does; the plan's code has his reaction, weaker and of the opposite sign)
  const cats = ['six', 'four', 'runs', 'dot', 'leave', 'close_call', 'wicket'];
  for (let i = 0; i < 28; i++) {
    const spec = randomSpec(r);
    cases.push({
      kind: 'delivery', role: 'bowler', person: pick(persons), key: deliveryTakeKey({ seed: 'bowler-react', overIndex: 0, ballIndex: i }), hz: 60, world: { ...spec, release: 2420 }, headMode: i % 2 ? 'space' : 'overlay', stage: i % 2 === 1,
      options: { reducedMotion: i % 7 === 3, lead: true, headPx: 40, pre: false, clip: 'real', series: 'pace' }, patch: { outcome: cats[i % 7] }, tag: `bowler-react#${i}`,
    });
  }
  for (let i = 0; i < 2; i++) {
    cases.push({
      kind: 'idle', role: i ? 'bowler' : 'striker', person: `look-${i}`, key: `long|idle.${i}`, hz: 60, world: { idleMs: 600_000 }, headMode: 'space',
      options: { reducedMotion: false, lead: false, headPx: 40, pre: false, clip: 'real', series: null }, patch: { start: -600, seamMs: 600 }, tag: `long#${i}`,
    });
  }
  n = cases.length;

  const lines: string[] = [];
  const stats: Record<string, number> = {};
  let bytes = 0;
  cases.forEach((c, i) => {
    const rec = run(c, i);
    const line = JSON.stringify(rec);
    bytes += line.length + 1;
    lines.push(line);
    const k = (name: string) => (stats[name] = (stats[name] ?? 0) + 1);
    k(`kind:${c.kind}`);
    k(`role:${c.role}`);
    k(`rm:${c.options.reducedMotion}`);
    k(`mode:${c.headMode}`);
    k(`hz:${c.hz}`);
    k(`pre:${c.options.pre}`);
    if (c.reuse) k('reuse');
    if (c.kind === 'idle') k(`seam:${(rec.anchors as { seamMs: number | null }).seamMs}`);
    if ('outcome' in c.world) k(`outcome:${c.world.outcome}`);
  });
  if (!OUT) throw new Error('Set VANDE_DIRECTOR_CORPUS_OUT to the directory that should receive corpus.jsonl and manifest.json.');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/corpus.jsonl`, lines.join('\n') + '\n');
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ cases: cases.length, bytes, channels: CHANNELS, stats, fnvOfCorpus: fnv1a32(lines.join('\n')) }, null, 1) + '\n');
  console.log(`corpus: ${cases.length} cases, ${bytes} bytes`, JSON.stringify(stats));
  void n;
});
