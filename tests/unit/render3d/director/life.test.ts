// @vitest-environment node
/**
 * Gates on the body's ambient life (MOTION-1 G2d, G4a to G4c, and H3 of the unified spec): breath and sway are
 * irregular, aperiodic and the size the parameter file says; they stop inside the quiet windows so that nothing
 * the physics checks (the bat, the hands, the pads, the release) can move because of them; exertion raises the breath.
 * Reason: today's idle is one sinusoid per loop (autocorrelation 1.000 at the 4.0 s period) and the same every ball.
 * The head proxy is 1.8 x sway X (mm) + 1.2 x breath (deg) as in the MOTION-1 prototype; P2 replaces it by the
 * real head of the posed rig.
 */
import { describe, expect, it, vi } from 'vitest';
import { AMP, CH, DRAW, deliveryTakeKey, prepare, type DirectorPlan, type Role } from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, randomSpec, rng } from './world';
import { frameOf, mean, quantile, record, recordFile, sd, stats, timeOf, val, withParams } from './gates';

recordFile('life');

// Heavy measurement runs: a slow CI runner gets a generous timeout (the config default is 30 s).
vi.setConfig({ testTimeout: 120_000 });

// P3: the posture and the twist (fidgets, reactions) are body channels too: zero inside the quiet windows like the others.
const LIFE = [CH.breath, CH.swayX, CH.swayZ, CH.swayRoll, CH.posture, CH.twist];

function autocorr(x: number[], lag: number): number {
  const n = x.length - lag;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += x[i];
    mb += x[i + lag];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - ma;
    const b = x[i + lag] - mb;
    sab += a * b;
    saa += a * a;
    sbb += b * b;
  }
  return sab / Math.sqrt(saa * sbb || 1);
}

function strongestLinePercent(x: number[], fs: number): number {
  const m = mean(x);
  const pw: number[] = [];
  for (let f = 0.05; f <= 3; f += 0.01) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      const a = (2 * Math.PI * f * i) / fs;
      re += (x[i] - m) * Math.cos(a);
      im -= (x[i] - m) * Math.sin(a);
    }
    pw.push((re * re + im * im) / (x.length * x.length));
  }
  return (Math.max(...pw) / pw.reduce((s, v) => s + v, 0)) * 100;
}

interface RestRow {
  rate: number;
  cv: number;
  depth: number;
  headRms: number;
  rollRms: number;
  swayRms: number;
  ac: number;
  line: number;
}
const restCache = new Map<Role, RestRow[]>();
/** 120 standing actors (different look seeds and keys), 70 s each, at 60 Hz (computed once per role). */
function atRest(role: Role): RestRow[] {
  const hit = restCache.get(role);
  if (hit) return hit;
  const rows: RestRow[] = [];
  for (let s = 0; s < 120; s++) {
    // The continuous channels alone: the fidgets (P3) are bigger moves on the same channels and have their own gates below.
    const p = withParams({ 'fidget.idleEndMs': 1e9 }, () => prepare(idleAnchors(role, `rest#${s}`, 70_000, { person: `look-${s % 8}` }), { hz: 60 }));
    const i0 = 180; // past the 400 ms ramp and a little more
    const br: number[] = [];
    const head: number[] = [];
    const roll: number[] = [];
    const sway: number[] = [];
    for (let i = i0; i < p.n; i++) {
      br.push(val(p, i, CH.breath));
      sway.push(val(p, i, CH.swayX));
      roll.push(val(p, i, CH.swayRoll));
      head.push(1.8 * val(p, i, CH.swayX) + 1.2 * val(p, i, CH.breath));
    }
    const ups: number[] = [];
    for (let k = 1; k < br.length; k++) if (br[k - 1] < 0 && br[k] >= 0) ups.push(k / 60);
    const iv = ups.slice(1).map((v, j) => v - ups[j]);
    let ac = -1;
    for (let lag = 90; lag <= 600; lag += 3) ac = Math.max(ac, autocorr(head, lag));
    rows.push({ rate: 60 / mean(iv), cv: (sd(iv) / mean(iv)) * 100, depth: Math.max(...br.map(Math.abs)), headRms: sd(head), rollRms: sd(roll), swayRms: sd(sway), ac, line: strongestLinePercent(head.slice(0, 60 * 40), 60) });
  }
  restCache.set(role, rows);
  return rows;
}

describe('G4b: breathing at rest', () => {
  for (const role of ['striker', 'bowler'] as const) {
    it(`${role}: 12 to 20 breaths a minute, interval variation 8 to 20%, chest swing 0.6 to 2.0 degrees, in every one of 120 draws`, () => {
      const rows = atRest(role);
      record(`${role}.breathPerMin`, stats(rows.map((r) => r.rate)));
      record(`${role}.breathIntervalCvPercent`, stats(rows.map((r) => r.cv)));
      record(`${role}.breathChestDeg`, stats(rows.map((r) => r.depth)));
      for (const r of rows) {
        expect(r.rate).toBeGreaterThanOrEqual(12);
        expect(r.rate).toBeLessThanOrEqual(20);
        expect(r.cv).toBeGreaterThanOrEqual(8);
        expect(r.cv).toBeLessThanOrEqual(20);
        expect(r.depth).toBeGreaterThanOrEqual(0.6);
        expect(r.depth).toBeLessThanOrEqual(2.0);
      }
    });
  }
});

describe('G4a and G4c: the sway is broadband, aperiodic and small', () => {
  for (const role of ['striker', 'bowler'] as const) {
    it(`${role}: no dominant line (at most 40% of the 0.05 to 3 Hz power), autocorrelation at lags 1.5 to 10 s at most 0.85, head proxy rms inside its band`, () => {
      const rows = atRest(role);
      const band = role === 'striker' ? [2, 7] : [3, 9];
      record(`${role}.swayStrongestLinePercent`, stats(rows.map((r) => r.line)));
      record(`${role}.swayMaxAutocorr`, stats(rows.map((r) => r.ac)));
      record(`${role}.headProxyRmsMm`, stats(rows.map((r) => r.headRms)));
      record(`${role}.swayXRmsMm`, stats(rows.map((r) => r.swayRms)));
      record(`${role}.swayRollRmsDeg`, stats(rows.map((r) => r.rollRms)));
      expect(Math.max(...rows.map((r) => r.line))).toBeLessThanOrEqual(40);
      expect(Math.max(...rows.map((r) => r.ac))).toBeLessThanOrEqual(0.85);
      const rms = rows.map((r) => r.headRms);
      // the rms of a 70 s record of slow noise itself varies by +-30%, so the band is judged on 90% of draws
      expect(quantile(rms, 0.05)).toBeGreaterThanOrEqual(band[0]);
      expect(quantile(rms, 0.95)).toBeLessThanOrEqual(band[1]);
      expect(quantile(rows.map((r) => r.rollRms), 0.95)).toBeLessThanOrEqual(1.5);
    });
  }
});

describe('H3: the quiet windows (nothing that moves the torso, hips, arms or hands inside them)', () => {
  it('batter: breath, sway and roll are exactly zero from release - 600 ms to stroke end + 800 ms; they are alive before and after', () => {
    const r = rng(91);
    let inside = 0;
    let before = 0;
    let beforeAlive = 0;
    let after = 0;
    let afterAlive = 0;
    for (let k = 0; k < 200; k++) {
      const d = delivery(randomSpec(r));
      const a = anchorsFor(d, { role: 'striker', key: deliveryTakeKey({ seed: 'h3', overIndex: 0, ballIndex: k }), person: `look-${k % 4}` });
      const p = prepare(a, { hz: 60 });
      const t = d.timeline;
      const from = t.release - 600;
      const to = (t.strokeEnd ?? t.end) + 800;
      for (let i = 0; i < p.n; i++) {
        const tm = timeOf(p, i);
        if (tm >= from && tm <= to) {
          for (const c of LIFE) expect(p.trace[i * 24 + c], `ball ${k} t=${tm.toFixed(0)} channel ${c}`).toBe(0);
          inside++;
        } else if (tm < from - 900 && tm > 800) {
          before++;
          if (LIFE.some((c) => p.trace[i * 24 + c] !== 0)) beforeAlive++;
        } else if (tm > to + 600 && tm < t.end) {
          after++;
          if (LIFE.some((c) => p.trace[i * 24 + c] !== 0)) afterAlive++;
        }
      }
    }
    record('quiet.batter', { framesInsideAllZero: inside, framesBefore: before, aliveBefore: beforeAlive / before, framesAfter: after, aliveAfter: afterAlive / after });
    expect(inside).toBeGreaterThan(10_000);
    expect(beforeAlive / before).toBeGreaterThan(0.99);
    expect(afterAlive / after).toBeGreaterThan(0.99);
  });

  it('bowler: breath, sway and roll are exactly zero from the gather to release + 150 ms', () => {
    const r = rng(93);
    let inside = 0;
    for (let k = 0; k < 200; k++) {
      const d = delivery(randomSpec(r));
      const a = anchorsFor(d, { role: 'bowler', key: deliveryTakeKey({ seed: 'h3b', overIndex: 0, ballIndex: k }), series: 'pace' });
      const p = prepare(a, { hz: 60 });
      const t = d.timeline;
      for (let i = 0; i < p.n; i++) {
        const tm = timeOf(p, i);
        if (tm >= t.gather && tm <= t.release + 150) {
          for (const c of LIFE) expect(p.trace[i * 24 + c], `ball ${k} t=${tm.toFixed(0)} channel ${c}`).toBe(0);
          inside++;
        }
      }
    }
    record('quiet.bowler', { framesInsideAllZero: inside });
    expect(inside).toBeGreaterThan(4000);
  });

  it('head rotation about the neck is allowed in the windows (the gaze moves the head there) and the life channels return smoothly', () => {
    const d = delivery({ speedKph: 130, lengthM: 6, lineM: 0, variation: 0, outcome: 'four' });
    const a = anchorsFor(d, { role: 'striker', key: 'h3#0.1' });
    const p = prepare(a, { hz: 60 });
    const t = d.timeline;
    let headMoves = false;
    for (let i = frameOf(p, t.release - 600); i < frameOf(p, t.release + 600); i++) if (Math.abs(val(p, i, CH.headPitch) - val(p, i - 1, CH.headPitch)) > 0.2) headMoves = true;
    expect(headMoves).toBe(true);
    // the way back is a ramp, not a step: no frame changes the sway by more than 0.5 mm or the breath by 0.15 degrees
    let worstSway = 0;
    let worstBreath = 0;
    for (let i = 1; i < p.n; i++) {
      worstSway = Math.max(worstSway, Math.abs(val(p, i, CH.swayX) - val(p, i - 1, CH.swayX)));
      worstBreath = Math.max(worstBreath, Math.abs(val(p, i, CH.breath) - val(p, i - 1, CH.breath)));
    }
    record('life.maxStepPerFrame', { swayMm: worstSway, breathDeg: worstBreath });
    expect(worstSway).toBeLessThan(0.5);
    expect(worstBreath).toBeLessThan(0.15);
  });
});

describe('exertion', () => {
  const longBowl = (role: Role, key: string, extra: Partial<{ outcome: 'four' | 'two' | 'dot' }> = {}) => {
    const d = delivery({ speedKph: 130, lengthM: 6, lineM: 0, variation: 0, outcome: extra.outcome ?? 'dot' });
    d.timeline.end = d.timeline.release + 40_000;
    return { d, a: anchorsFor(d, { role, key, series: 'pace' }) };
  };
  const breathRate = (p: DirectorPlan, from: number, to: number) => {
    const ups: number[] = [];
    for (let i = frameOf(p, from) + 1; i < frameOf(p, to); i++) if (val(p, i - 1, CH.breath) < 0 && val(p, i, CH.breath) >= 0) ups.push(timeOf(p, i) / 1000);
    return ups.length > 1 ? (60 * (ups.length - 1)) / (ups[ups.length - 1] - ups[0]) : NaN;
  };

  it('the bowler breathes about twice as fast after his delivery as at rest, and slows back down', () => {
    const ratios: number[] = [];
    const late: number[] = [];
    for (let k = 0; k < 30; k++) {
      const { d, a } = longBowl('bowler', `ex#0.${k}`);
      const p = prepare({ ...a, person: `look-${k}` }, { hz: 60 });
      const rest = breathRate(p, 500, d.timeline.gather - 300);
      const hot = breathRate(p, d.timeline.release + 1000, d.timeline.release + 6000);
      const cool = breathRate(p, d.timeline.release + 28_000, d.timeline.release + 38_000);
      ratios.push(hot / (60 * p.amp[AMP.breathHz]));
      late.push(cool / hot);
      void rest;
    }
    record('exertion.bowlerRateRatioAfterRelease', stats(ratios));
    record('exertion.bowlerRateRatioLateOverHot', stats(late));
    expect(quantile(ratios, 0.05)).toBeGreaterThan(1.6);
    expect(quantile(ratios, 0.95)).toBeLessThan(2.8);
    expect(quantile(late, 0.95)).toBeLessThan(0.8);
  });

  it('the batter breathes harder after a stroke, and after two runs harder than after a dot ball; nothing before', () => {
    const level = (outcome: 'dot' | 'two', k: number) => {
      const { d, a } = longBowl('striker', `exs#0.${k}`, { outcome });
      const p = prepare(a, { hz: 60 });
      const t = d.timeline;
      return { before: val(p, frameOf(p, t.release - 200), CH.exertion), afterStroke: val(p, frameOf(p, (t.strokeEnd ?? 0) + 2500), CH.exertion), afterRuns: val(p, frameOf(p, t.outcomeAt + 1500), CH.exertion) };
    };
    for (let k = 0; k < 10; k++) {
      const dot = level('dot', k);
      const two = level('two', k);
      expect(dot.before).toBe(0);
      expect(dot.afterStroke).toBeGreaterThan(0.05);
      expect(two.afterRuns).toBeGreaterThan(dot.afterRuns + 0.2);
    }
  });
});

describe('G2d: the same man, a different ball', () => {
  it('person traits are constant for the over; per-ball draws and the first seconds of the stance differ every ball', () => {
    const plans: DirectorPlan[] = [];
    const proxies: number[][] = [];
    for (let b = 0; b < 20; b++) {
      const a = idleAnchors('striker', deliveryTakeKey({ seed: 'over', overIndex: 7, ballIndex: b }), 4000, { person: 'look-7' });
      const p = prepare(a, { hz: 60 });
      plans.push(p);
      proxies.push(Array.from({ length: frameOf(p, 1750) }, (_, i) => 1.8 * val(p, i, CH.swayX) + 1.2 * val(p, i, CH.breath)));
    }
    for (const c of [AMP.breathHz, AMP.breathDepthDeg, AMP.breathSkew, AMP.swayRootMm, AMP.swayRollDeg, AMP.blinkMeanS, AMP.blinkCv]) expect(new Set(plans.map((p) => p.amp[c])).size).toBe(1);
    for (const c of [DRAW.breathPhase, DRAW.swayPhase, DRAW.swayAxis, DRAW.headDrift, DRAW.lagMs, DRAW.reactionMs]) expect(new Set(plans.map((p) => p.draw[c])).size).toBe(20);
    const tuples = new Set(plans.map((p) => `${Math.round(p.blink[0] / 50)}|${Math.round(p.draw[DRAW.breathPhase] * 10)}`));
    record('variation.distinctFirstBlinkAndBreathPhase', tuples.size);
    expect(tuples.size).toBeGreaterThanOrEqual(8);
    const diffs: number[] = [];
    for (let i = 0; i < 20; i += 2) {
      const n = Math.min(proxies[i].length, proxies[i + 1].length);
      let s = 0;
      for (let k = 0; k < n; k++) s += (proxies[i][k] - proxies[i + 1][k]) ** 2;
      diffs.push(Math.sqrt(s / n));
    }
    record('variation.headProxyRmsDifferenceMm', stats(diffs));
    expect(quantile(diffs, 0.5)).toBeGreaterThanOrEqual(2.5);
    expect(quantile(diffs, 0.1)).toBeGreaterThanOrEqual(0.8);
  });

  it('a different person has different traits (so two players do not breathe in step)', () => {
    const a = prepare(idleAnchors('striker', 'p#0.1', 3000, { person: 'look-1' }));
    const b = prepare(idleAnchors('striker', 'p#0.1', 3000, { person: 'look-2' }));
    expect(a.amp[AMP.breathHz]).not.toBe(b.amp[AMP.breathHz]);
    expect(a.amp[AMP.blinkMeanS]).not.toBe(b.amp[AMP.blinkMeanS]);
  });
});
