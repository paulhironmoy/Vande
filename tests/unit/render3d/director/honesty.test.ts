// @vitest-environment node
/**
 * Honesty (unified spec H1, H2, H4 and the gates G-honesty and the hand-over): the Director may not tell the player
 * anything before it is visible.
 *   - draws are uncorrelated with length, line, speed, variation and outcome (|Spearman| <= 0.04, 10,000 balls);
 *   - nothing is read from the ball later than a pursuit lag (>= 125 ms) before it is shown (causality, bit-equal);
 *   - the outcome changes nothing until outcomeAt + 180 ms (bit-equal), and for the bowler nothing at all;
 *   - the plan built before the result and the one built after agree up to the first moment the result matters.
 * Reason: a face or a body that "knew" the length or the result would be a tell (constitution law 3, cricket causality).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CH,
  CHANNELS,
  DRAW,
  AMP,
  deliveryTakeKey,
  prepare,
  sample,
  createOut,
  type DirectorAnchors,
  type DirectorPlan,
  type Role,
} from '@/render3d/core/motion/director';
import {
  anchorsFor,
  delivery,
  OUTCOMES,
  randomSpec,
  rng,
  STOCK as STOCK_SPEC,
  type BallSpec,
  type Delivery,
} from './world';
import { gauss } from '@/render3d/core/motion/director/seeds';
import { FIDGET_N, T_SIDE } from '@/render3d/core/motion/director/plan';
import { ballKey, mix, personKey } from '@/render3d/core/motion/director';
import { frameOf, maxDiff, record, recordFile, spearman, stats, timeOf } from './gates';

recordFile('honesty');

// Heavy measurement runs: a slow CI runner gets a generous timeout (the config default is 30 s).
vi.setConfig({ testTimeout: 120_000 });

const PROPS = ['lengthM', 'lineM', 'speedKph', 'variation', 'outcome'] as const;
const propOf = (s: BallSpec, k: (typeof PROPS)[number]): number =>
  k === 'outcome' ? OUTCOMES.indexOf(s.outcome) : s[k];

/** Scalars that must not depend on the ball: the plan's draws and the channels at instants before the ball matters. */
function drawSummaries(
  p: DirectorPlan,
  role: Role,
  release: number,
  person: string,
  key: string,
): Record<string, number> {
  const out = createOut();
  const at = (t: number) => sample(p, t, out);
  const s: Record<string, number> = {};
  for (let k = 0; k < DRAW.N; k++) s[`draw${k}`] = p.draw[k];
  for (const k of [AMP.breathHz, AMP.swayRootMm, AMP.blinkMeanS]) s[`amp${k}`] = p.amp[k];
  // The first blink's own draws (a blink that falls in the task window is deferred to after it, which is the
  // window's doing and shows only afterwards, so the raw draws are what is compared; the early-blink test below
  // checks the event itself).
  const bk = ballKey(key, personKey(person, role));
  s.firstGapDraw = gauss(mix(bk, 11), 0);
  s.firstShapeDraw = gauss(mix(mix(bk, 12), 0), 0);
  s.firstMicroMs = p.micro.length ? p.micro[0] : -1;
  s.fixationsBeforeRelease = Array.from({ length: p.fix.length / 5 }, (_, i) => p.fix[i * 5]).filter(
    (t) => t < release - 300,
  ).length;
  s.secondFixationMs = p.fix.length > 5 ? p.fix[5] : -1;
  // P3: the fidgets and the glances are draws of the key too (their count and first events are summarised, and the channels they drive)
  s.fidgetCount = p.fidget.length / FIDGET_N;
  s.firstFidgetMs = p.fidget.length ? p.fidget[0] : -1;
  s.firstFidgetKind = p.fidget.length ? p.fidget[1] : -1;
  s.firstFidgetAmp = p.fidget.length ? p.fidget[3] : 0;
  s.sideGlances = Array.from({ length: p.fix.length / 5 }, (_, i) => p.fix[i * 5 + 1]).filter(
    (k, i) => k === T_SIDE && p.fix[i * 5] < release - 300,
  ).length;
  at(release - 1500);
  s.postureBefore = out[CH.posture];
  s.twistBefore = out[CH.twist];
  s.breathBefore = out[CH.breath];
  s.swayBefore = out[CH.swayX];
  s.swayRollBefore = out[CH.swayRoll];
  at(release - 1200);
  s.headYawBefore = out[CH.headYaw];
  s.headPitchBefore = out[CH.headPitch];
  s.eyeYawBefore = out[CH.eyeYawL];
  s.eyePitchBefore = out[CH.eyePitchL];
  at(release - 300);
  s.gazeYawLate = out[CH.gazeYaw];
  s.gazePitchLate = out[CH.gazePitch];
  s.blinkLate = out[CH.blinkL];
  if (role === 'bowler') {
    // the bowler's own body after the release does not depend on the ball (his window and exertion are fixed by the release)
    at(release + 2500);
    s.breathAfter = out[CH.breath];
    s.swayAfter = out[CH.swayX];
    s.exertionAfter = out[CH.exertion];
  }
  return s;
}

describe('G-honesty: draws are uncorrelated with the ball (10,000 deliveries per actor)', () => {
  const N = 10_000;
  for (const role of ['bowler', 'striker'] as const) {
    it(`${role}: |Spearman| <= 0.04 between every draw and length, line, speed, variation and outcome; the machinery does find a real dependence`, () => {
      const r = rng(role === 'bowler' ? 1234 : 4321);
      const specs: BallSpec[] = [];
      const rows: Record<string, number>[] = [];
      const control = { gazePitch: [] as number[], gazeYaw: [] as number[] };
      for (let k = 0; k < N; k++) {
        const spec = randomSpec(r);
        const d = delivery(spec);
        d.timeline.end = d.timeline.release + 3000;
        const key = deliveryTakeKey({ seed: `hon-${role}`, overIndex: Math.floor(k / 6), ballIndex: k % 6 });
        const a = anchorsFor(d, { role, key, person: `look-${k % 11}`, series: 'pace' });
        const p = prepare(a, { hz: 60 });
        specs.push(spec);
        rows.push(drawSummaries(p, role, d.timeline.release, `look-${k % 11}`, key));
        // positive control: where the striker looks 450 ms after release follows the visible ball
        const out = createOut();
        sample(p, d.timeline.release + 450, out);
        control.gazePitch.push(out[CH.gazePitch]);
        control.gazeYaw.push(out[CH.gazeYaw]);
      }
      const names = Object.keys(rows[0]);
      let worst = 0;
      let worstName = '';
      const table: Record<string, number> = {};
      for (const name of names) {
        const col = rows.map((x) => x[name]);
        for (const prop of PROPS) {
          const rho = spearman(
            col,
            specs.map((s) => propOf(s, prop)),
          );
          table[`${name}~${prop}`] = rho;
          if (Math.abs(rho) > worst) {
            worst = Math.abs(rho);
            worstName = `${name}~${prop}`;
          }
        }
      }
      const rhoLengthPitch = spearman(
        control.gazePitch,
        specs.map((s) => s.lengthM),
      );
      const rhoLineYaw = spearman(
        control.gazeYaw,
        specs.map((s) => s.lineM),
      );
      record(`${role}.spearman`, {
        balls: N,
        summaries: names.length,
        correlations: names.length * PROPS.length,
        worstAbsRho: worst,
        worstName,
        positiveControl: { gazePitchVsLength: rhoLengthPitch, gazeYawVsLine: rhoLineYaw },
      });
      expect(names.length).toBeGreaterThanOrEqual(40);
      expect(worst, worstName).toBeLessThanOrEqual(0.04);
      if (role === 'striker') {
        // the striker's gaze after release does follow the visible ball: the test sees it (so a pass above is not blindness)
        expect(Math.abs(rhoLengthPitch)).toBeGreaterThan(0.3);
        expect(Math.abs(rhoLineYaw)).toBeGreaterThan(0.1);
      }
    }, 120_000);
  }

  it('the draws are a function of the key alone: the same key with a different ball gives bit-identical draws and person amplitudes', () => {
    const r = rng(77);
    for (let k = 0; k < 50; k++) {
      const key = deliveryTakeKey({ seed: 'same-key', overIndex: 1, ballIndex: k % 6 });
      const a = prepare(anchorsFor(delivery(randomSpec(r)), { role: 'striker', key }));
      const b = prepare(anchorsFor(delivery(randomSpec(r)), { role: 'striker', key }));
      expect(Array.from(a.draw)).toEqual(Array.from(b.draw));
      expect(Array.from(a.amp)).toEqual(Array.from(b.amp));
      // and the micro-motion, and a first blink that falls before the task window, are the same too
      const m = Math.min(a.micro.length, b.micro.length, 30);
      expect(m).toBeGreaterThan(20);
      expect(Array.from(a.micro.subarray(0, m))).toEqual(Array.from(b.micro.subarray(0, m)));
      if (a.blink[0] < 1500 && b.blink[0] < 1500) expect(a.blink[0]).toBe(b.blink[0]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Causality

/** The anchors with the visible ball changed from time `from` on (an arbitrary perturbation, or gone). */
function perturbBall(a: DirectorAnchors, from: number, mode: 'shift' | 'gone'): DirectorAnchors {
  return {
    ...a,
    visibleBall: (t, out, ahead) => {
      const ok = a.visibleBall(t, out, ahead);
      if (t <= from) return ok;
      if (mode === 'gone') return false;
      out[0] += 31;
      out[1] -= 17;
      return ok;
    },
  };
}
const FRAME_MS = 1000 / 240;
const equalBefore = (a: DirectorPlan, b: DirectorPlan, tMs: number) => maxDiff(a, b, 0, frameOf(a, tMs) - 1);
const differsAfter = (a: DirectorPlan, b: DirectorPlan, tMs: number) => maxDiff(a, b, frameOf(a, tMs), a.n) > 0;

describe('H1: gaze and head read the ball no later than a pursuit lag before it is shown', () => {
  // `lead`: the P3 extrapolated pursuit (the ball carried on at the velocity it had a latency ago), which may use nothing later.
  for (const [role, lead] of [
    ['bowler', false],
    ['striker', false],
    ['bowler', true],
    ['striker', true],
  ] as const) {
    it(`${role}${lead ? ' (extrapolated pursuit)' : ''}: changing the visible ball after T changes nothing before T + 125 ms (bit-equal), and does change what follows`, () => {
      const r = rng(5 + (role === 'bowler' ? 1 : 2));
      let compared = 0;
      let changed = 0;
      for (let k = 0; k < 120; k++) {
        const d = delivery(randomSpec(r));
        const a = anchorsFor(d, {
          role,
          key: deliveryTakeKey({ seed: 'h1', overIndex: 0, ballIndex: k }),
          series: 'pace',
          lead,
        });
        const T = d.timeline.release + 120 + (k % 7) * 40;
        const base = prepare(a, { hz: 240 });
        for (const mode of ['shift', 'gone'] as const) {
          const alt = prepare(perturbBall(a, T, mode), { hz: 240 });
          expect(equalBefore(base, alt, T + 125), `${role} #${k} ${mode}`).toBe(0);
          compared++;
          if (differsAfter(base, alt, T + 200 + FRAME_MS * 4)) changed++;
        }
      }
      record(`${role}${lead ? '.lead' : ''}.noLookAhead`, { comparisons: compared, changedAfterwards: changed });
      expect(compared).toBe(240);
      // after the lag the ball does matter for the striker (he follows it) and, briefly, for the bowler
      expect(changed / compared).toBeGreaterThan(role === 'striker' ? 0.7 : 0.15);
    }, 60_000);
  }

  it('the pursuit lag the plan draws is never under 125 ms', () => {
    let lo = Infinity;
    for (let k = 0; k < 2000; k++)
      lo = Math.min(
        lo,
        prepare(anchorsFor(delivery(randomSpec(rng(k + 1))), { role: 'striker', key: `lag#${k}` }), { hz: 60 }).draw[
          DRAW.lagMs
        ],
      );
    record('pursuitLagMs.min', lo);
    expect(lo).toBeGreaterThanOrEqual(125);
  }, 60_000);
});

describe('H2: the outcome changes nothing before outcomeAt + 180 ms', () => {
  it('striker: two different outcomes of the same shot (the ball as drawn is the same) are bit-equal until outcomeAt + 180 ms and differ afterwards', () => {
    const r = rng(17);
    let pairs = 0;
    let differ = 0;
    const firstDiff: number[] = [];
    for (let k = 0; k < 150; k++) {
      const spec = randomSpec(r);
      const d = delivery(spec);
      const a = anchorsFor(d, { role: 'striker', key: deliveryTakeKey({ seed: 'h2', overIndex: 0, ballIndex: k }) });
      // The same drawn ball, a different outcome: confirmed later, a different dead ball, runs taken or not.
      const b: DirectorAnchors = {
        ...a,
        outcomeAt: a.outcomeAt! + 400 + (k % 5) * 100,
        dead: a.dead! + 900,
        runs: a.runs === 0 ? 2 : 0,
      };
      const pa = prepare(a, { hz: 240 });
      const pb = prepare(b, { hz: 240 });
      const t = Math.min(a.outcomeAt!, b.outcomeAt!) + 180;
      expect(equalBefore(pa, pb, t), `ball ${k} ${spec.outcome}`).toBe(0);
      pairs++;
      let first = -1;
      for (let i = frameOf(pa, t); i < pa.n && first < 0; i++)
        for (let c = 0; c < CHANNELS; c++)
          if (pa.trace[i * CHANNELS + c] !== pb.trace[i * CHANNELS + c]) {
            first = i;
            break;
          }
      if (first >= 0) {
        differ++;
        firstDiff.push(timeOf(pa, first) - a.outcomeAt!);
      }
    }
    record('striker.outcomeBlind', {
      pairs,
      differAfterwards: differ,
      firstDifferenceAfterOutcomeAtMs: stats(firstDiff),
    });
    expect(differ / pairs).toBeGreaterThan(0.9); // the test is not vacuous: after the latency the outcome does show
    expect(Math.min(...firstDiff)).toBeGreaterThanOrEqual(180 - FRAME_MS);
  });

  it('bowler: the outcome never changes anything (no outcome channel exists for him in P1): bit-equal at every frame', () => {
    const r = rng(19);
    for (let k = 0; k < 100; k++) {
      const d = delivery(randomSpec(r));
      const a = anchorsFor(d, {
        role: 'bowler',
        key: deliveryTakeKey({ seed: 'h2b', overIndex: 0, ballIndex: k }),
        series: 'pace',
      });
      const b: DirectorAnchors = { ...a, outcomeAt: a.outcomeAt! + 1500, dead: a.dead! + 2000, runs: 3 };
      const pa = prepare(a, { hz: 240 });
      const pb = prepare(b, { hz: 240 });
      expect(maxDiff(pa, pb, 0, pa.n)).toBe(0);
    }
  });
});

describe('hand-over: the live plan before the result and the plan built from the result agree up to the first moment the result matters', () => {
  for (const role of ['striker', 'bowler'] as const) {
    it(`${role}: bit-equal before the earliest of contact + 125 ms, outcomeAt + 180 ms, stroke end and dead ball + 125 ms; different afterwards`, () => {
      const r = rng(23);
      let compared = 0;
      let differ = 0;
      const margin: number[] = [];
      for (let k = 0; k < 200; k++) {
        const d: Delivery = delivery(randomSpec(r));
        const key = deliveryTakeKey({ seed: 'ho', overIndex: 0, ballIndex: k });
        const live = prepare(anchorsFor(d, { role, key, pre: true, series: 'pace' }), { hz: 240 });
        const full = prepare(anchorsFor(d, { role, key, series: 'pace' }), { hz: 240 });
        const t = d.timeline;
        const safe = Math.min(
          t.contact === null ? Infinity : t.contact + 125,
          t.outcomeAt + 180,
          role === 'striker' ? (t.strokeEnd ?? Infinity) : Infinity,
          t.dead + 125,
        );
        expect(equalBefore(live, full, safe), `${role} #${k}`).toBe(0);
        compared++;
        if (differsAfter(live, full, safe)) differ++;
        margin.push(safe - t.release);
      }
      record(`${role}.handOver`, { compared, differAfterwards: differ, safeAfterReleaseMs: stats(margin) });
      expect(compared).toBe(200);
      if (role === 'striker') expect(differ / compared).toBeGreaterThan(0.9);
    }, 60_000);
  }
});

describe('hand-over without work: prepare can reuse the live plan up to the safe moment', () => {
  it('a plan built from the result with reuse is bit-identical to one built from scratch, and asks the clip for fewer frames; reusing too much is caught', () => {
    const r = rng(37);
    let saved = 0;
    let total = 0;
    let wrongWhenTooMuch = 0;
    let n = 0;
    for (let k = 0; k < 100; k++) {
      for (const role of ['striker', 'bowler'] as const) {
        const d = delivery(randomSpec(r));
        const key = deliveryTakeKey({ seed: 'reuse', overIndex: 0, ballIndex: k });
        const liveA = anchorsFor(d, { role, key, pre: true, series: 'pace' });
        const fullA = anchorsFor(d, { role, key, series: 'pace' });
        const live = prepare(liveA);
        const t = d.timeline;
        const safe = Math.min(
          t.contact === null ? Infinity : t.contact + 125,
          t.outcomeAt + 180,
          role === 'striker' ? (t.strokeEnd ?? Infinity) : Infinity,
          t.dead + 125,
        );
        let calls = 0;
        const counted: DirectorAnchors = {
          ...fullA,
          clipHead: (ms, out) => {
            calls++;
            fullA.clipHead(ms, out);
          },
        };
        const fresh = prepare(fullA);
        const reused = prepare(counted, { reuse: { plan: live, untilMs: safe } });
        expect(Array.from(reused.trace), `${role} #${k}`).toEqual(Array.from(fresh.trace));
        expect(Array.from(reused.fix)).toEqual(Array.from(fresh.fix));
        expect(Array.from(reused.blink)).toEqual(Array.from(fresh.blink));
        saved += fresh.n - calls;
        total += fresh.n;
        // reusing past the safe moment would copy frames the result changes: the comparison sees it
        const tooMuch = prepare(fullA, { reuse: { plan: live, untilMs: safe + 2000 } });
        n++;
        if (traceDiffers(tooMuch, fresh)) wrongWhenTooMuch++;
      }
    }
    record('reuse', {
      plans: n,
      framesNotAskedFor: saved,
      framesTotal: total,
      shareSaved: saved / total,
      tooMuchCaught: wrongWhenTooMuch / n,
    });
    expect(saved / total).toBeGreaterThan(0.2);
    expect(wrongWhenTooMuch / n).toBeGreaterThan(0.4);
  }, 60_000);

  it('is ignored when the earlier plan has another rate or another start (never a silent mismatch)', () => {
    const d = delivery(STOCK_SPEC);
    const a = anchorsFor(d, { role: 'striker', key: 'reuse#1' });
    const other = prepare(a, { hz: 120 });
    expect(Array.from(prepare(a, { reuse: { plan: other, untilMs: 3000 } }).trace)).toEqual(
      Array.from(prepare(a).trace),
    );
    const shifted = prepare({ ...a, start: 500 });
    expect(Array.from(prepare(a, { reuse: { plan: shifted, untilMs: 3000 } }).trace)).toEqual(
      Array.from(prepare(a).trace),
    );
  });
});

const traceDiffers = (a: DirectorPlan, b: DirectorPlan) =>
  a.trace.length !== b.trace.length || a.trace.some((v, i) => v !== b.trace[i]);

describe('each anchor matters only from its own time', () => {
  /** [field, value in the second build, the instant before which the two traces must be bit-equal] */
  const cases: {
    name: string;
    make: (a: DirectorAnchors, t: ReturnType<typeof delivery>['timeline']) => DirectorAnchors;
    before: (t: ReturnType<typeof delivery>['timeline']) => number;
  }[] = [
    { name: 'strokeEnd', make: (a) => ({ ...a, strokeEnd: null }), before: (t) => t.strokeEnd! },
    { name: 'outcomeAt', make: (a) => ({ ...a, outcomeAt: null }), before: (t) => t.outcomeAt + 180 },
    {
      name: 'outcomeAt and dead',
      make: (a) => ({ ...a, outcomeAt: null, dead: null }),
      before: (t) => Math.min(t.outcomeAt + 180, t.dead + 300),
    },
    { name: 'runs', make: (a) => ({ ...a, runs: a.runs + 3 }), before: (t) => t.outcomeAt + 180 },
    { name: 'swing', make: (a) => ({ ...a, swing: null }), before: () => Infinity },
    { name: 'contact', make: (a) => ({ ...a, contact: null }), before: () => Infinity },
    {
      name: 'taskEnd (the blink window end)',
      make: (a) => ({ ...a, taskEnd: a.taskEnd! + 700 }),
      before: (t) => (t.contact ?? t.passAt) + 150,
    },
  ];
  for (const c of cases) {
    it(`striker: ${c.name}`, () => {
      const r = rng(29);
      for (let k = 0; k < 60; k++) {
        const d = delivery({ ...randomSpec(r), outcome: OUTCOMES[k % 4] });
        const a = anchorsFor(d, { role: 'striker', key: deliveryTakeKey({ seed: 'anc', overIndex: 0, ballIndex: k }) });
        const pa = prepare(a, { hz: 240 });
        const pb = prepare(c.make(a, d.timeline), { hz: 240 });
        const before = c.before(d.timeline);
        expect(
          Number.isFinite(before) ? equalBefore(pa, pb, before) : maxDiff(pa, pb, 0, pa.n),
          `${c.name} #${k}`,
        ).toBe(0);
      }
    });
  }
});

describe('the sources do not know the ball', () => {
  it('plan.ts and bake.ts never mention a flight, speed, length, line, variation, result or an outcome other than the time outcomeAt', () => {
    const dir = `${process.cwd()}/src/render3d/core/motion/director/`;
    const code = (f: string) =>
      readFileSync(dir + f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(readdirSync(dir)).toContain('plan.ts');
    // P3: the one thing about the result the plan may read is the outcome's category (anchor `outcome`, 'six', 'wicket', ...), in plan.ts
    // alone, and it matters from outcomeAt + 180 ms (the tests below prove it). The bake and the sampler never see it.
    const allowed = (f: string) =>
      f === 'plan.ts'
        ? code(f).replace(/\ba\.outcome\b/g, '')
        : f === 'types.ts'
          ? code(f).replace(/\boutcome\?: string \| null;/g, '')
          : code(f);
    for (const f of ['plan.ts', 'bake.ts', 'director.ts', 'types.ts']) {
      expect(allowed(f), f).not.toMatch(
        /\b(flight|speedKph|lengthM|lineM|variation|DeliveryResult|BallFlight|result)\b|\boutcome(?!At)\b/,
      );
    }
    expect(code('bake.ts')).not.toMatch(/\boutcome\b(?!At)/);
    expect((code('plan.ts').match(/\ba\.outcome\b/g) ?? []).length).toBe(4); // fixations() and reaction() (twice each), nothing else
  });
});
