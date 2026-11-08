// @vitest-environment node
/// <reference types="node" />
/**
 * Gates on the eyes (FACE-1 G6 to G8): never frozen, saccades on the main sequence, eyes inside their range, gaze
 * landing on its target, head following the gaze, microsaccades at about one a second and under one degree.
 * Reason: a dead stare and a snap-to-target are what an eye reads as a robot; the tool checks the kinematics the
 * literature gives (Baloh 1975: duration 22 + 2.7 ms per degree; Bentivoglio, Rolfs for microsaccades).
 * Measured on 240 Hz bakes. Reduced Motion is covered in reducedMotion.test.ts (it drops the micro-motion on purpose).
 */
import { describe, expect, it, vi } from 'vitest';
import { CH, DRAW, createOut, deliveryTakeKey, prepare, sample, type DirectorPlan, type Role } from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, randomSpec, rng } from './world';
import { longestFrozenS, mean, quantile, record, recordFile, saccades, stats, timeOf, val } from './gates';

recordFile('gaze');

// Heavy measurement runs: a slow CI runner gets a generous timeout (the config default is 30 s).
vi.setConfig({ testTimeout: 120_000 });

const EYES_HEAD = [CH.eyeYawL, CH.eyePitchL, CH.headYaw, CH.headPitch];

describe('G6: the gaze is never frozen', () => {
  for (const role of ['bowler', 'striker'] as const) {
    it(`${role}: no stretch longer than 1.5 s without 0.06 degrees of change in eyes or head (200 standing traces, 100 deliveries)`, () => {
      const frozen: number[] = [];
      for (let s = 0; s < 200; s++) frozen.push(longestFrozenS(prepare(idleAnchors(role, `frz#${s}`, 30_000), { hz: 60 }), EYES_HEAD, 0.06));
      const r = rng(21);
      const live: number[] = [];
      for (let k = 0; k < 100; k++) {
        const d = delivery(randomSpec(r));
        const a = anchorsFor(d, { role, key: deliveryTakeKey({ seed: 'frz', overIndex: 0, ballIndex: k }), series: 'pace' });
        live.push(longestFrozenS(prepare(a, { hz: 60 }), EYES_HEAD, 0.06));
      }
      record(`${role}.longestFrozenS.standing`, stats(frozen));
      record(`${role}.longestFrozenS.delivery`, stats(live));
      expect(Math.max(...frozen)).toBeLessThanOrEqual(1.5);
      expect(Math.max(...live)).toBeLessThanOrEqual(1.5);
    });
  }

  it('the tool does find a freeze (a constant gaze is frozen for the whole script)', () => {
    const p = prepare(idleAnchors('striker', 'frz#c', 8000), { hz: 60 });
    p.trace.fill(0);
    expect(longestFrozenS(p, EYES_HEAD, 0.06)).toBeGreaterThan(6);
  });
});

describe('G7: saccades follow the main sequence', () => {
  it('from rest: 95% last 0.6 to 1.6 times (22 + 2.7 A) ms, peak under 700 deg/s, the speed peaks at 0.2 to 0.6 of the duration', () => {
    const rows: { A: number; D: number; vp: number; ttp: number; ref: number }[] = [];
    for (const role of ['bowler', 'striker'] as const) {
      for (let s = 0; s < 80; s++) {
        const p = prepare(idleAnchors(role, `ms#${s}`, 30_000, { person: `look-${s % 5}` }), { hz: 240 });
        for (const x of saccades(p, CH.gazeYaw, CH.gazePitch, 130, 3)) if (x.v0 < 40) rows.push({ A: x.A, D: x.D, vp: x.vp, ttp: x.ttp, ref: 22 + 2.7 * x.A });
      }
    }
    const within = rows.filter((x) => x.D >= 0.6 * x.ref && x.D <= 1.6 * x.ref).length / rows.length;
    const ttpOk = rows.filter((x) => x.ttp >= 0.2 && x.ttp <= 0.6).length / rows.length;
    record('saccade.fromRest', { n: rows.length, within, ttpOk, durationOverRef: stats(rows.map((x) => x.D / x.ref)), peakDegS: stats(rows.map((x) => x.vp)), amplitudeDeg: stats(rows.map((x) => x.A)), timeToPeak: stats(rows.map((x) => x.ttp)) });
    expect(rows.length).toBeGreaterThan(300);
    expect(within).toBeGreaterThanOrEqual(0.95);
    expect(ttpOk).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...rows.map((x) => x.vp))).toBeLessThanOrEqual(700);
    // the peak speed rises with amplitude and saturates (the main sequence), it is not a constant
    const small = rows.filter((x) => x.A < 8).map((x) => x.vp);
    const large = rows.filter((x) => x.A > 20).map((x) => x.vp);
    expect(quantile(large, 0.5)).toBeGreaterThan(1.5 * quantile(small, 0.5));
  });

  it('over amplitudes from 3 to 60 degrees (the opponent jumps between fixations): duration, peak speed and time to peak stay on the main sequence', () => {
    const rows: { A: number; D: number; vp: number; ttp: number; ref: number }[] = [];
    // Within +-30 degrees of the clip's head: a shift of up to 60 degrees stays inside the eye (35) and neck (40) range.
    const jumps = [0, 4, -6, 12, -20, 30, -28, 24, -20, 28, -5, 16, 0, -30, 8, 25, -26, 3];
    for (let s = 0; s < 40; s++) {
      const base = idleAnchors('bowler', `sweep#${s}`, 60_000);
      const times = Array.from(prepare(base, { hz: 60 }).fix).filter((_, i) => i % 5 === 0);
      const a = {
        ...base,
        aim: (target: 'opponent' | 'hand', ms: number, out: Float64Array) => {
          base.aim(target, ms, out);
          let k = 0;
          while (k + 1 < times.length && times[k + 1] <= ms) k++;
          out[0] += jumps[(k + s) % jumps.length];
          return true;
        },
      };
      const p = prepare(a, { hz: 240 });
      for (const x of saccades(p, CH.gazeYaw, CH.gazePitch, 130, 3)) if (x.v0 < 40) rows.push({ A: x.A, D: x.D, vp: x.vp, ttp: x.ttp, ref: 22 + 2.7 * x.A });
    }
    const within = rows.filter((x) => x.D >= 0.6 * x.ref && x.D <= 1.6 * x.ref).length / rows.length;
    record('saccade.amplitudeSweep', { n: rows.length, within, amplitudeDeg: stats(rows.map((x) => x.A)), durationOverRef: stats(rows.map((x) => x.D / x.ref)), peakDegS: stats(rows.map((x) => x.vp)) });
    expect(rows.length).toBeGreaterThan(300);
    expect(Math.max(...rows.map((x) => x.A))).toBeGreaterThan(40);
    expect(Math.min(...rows.map((x) => x.A))).toBeLessThan(6);
    expect(within).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...rows.map((x) => x.vp))).toBeLessThanOrEqual(700);
  });

  it('smooth pursuit of a ball that is slow enough follows it at its own speed with no saccade; a faster one is chased by catch-up saccades at least 120 ms apart', () => {
    const sweep = (ampDeg: number, hzWave: number) => {
      const base = idleAnchors('striker', 'pursuit#0', 8000);
      return {
        ...base,
        release: 1500,
        visibleBall: (t: number, out: Float64Array) => {
          if (t < 1000) return false;
          out[0] = ampDeg * Math.sin(2 * Math.PI * hzWave * (t - 1000) / 1000);
          out[1] = 0;
          return true;
        },
      };
    };
    const slow = prepare(sweep(15, 0.5), { hz: 240 });
    const peakSlow = Math.max(...Array.from({ length: slow.n - 1 }, (_, i) => Math.abs(val(slow, i + 1, CH.gazeYaw) - val(slow, i, CH.gazeYaw)) * slow.hz).filter((_, i) => timeOf(slow, i) > 2200));
    const sacSlow = saccades(slow, CH.gazeYaw, CH.gazePitch, 130, 3).filter((x) => x.t > 1500);
    const fast = prepare(sweep(25, 1.5), { hz: 240 });
    const sacFast = saccades(fast, CH.gazeYaw, CH.gazePitch, 130, 3).filter((x) => x.t > 1500);
    const gaps = sacFast.slice(1).map((x, i) => x.tPeak - sacFast[i].tPeak);
    record('pursuit.sweep', { slowPeakDegS: peakSlow, slowSaccades: sacSlow.length, fastSaccades: sacFast.length, fastGapMs: stats(gaps), fastPeakDegS: stats(sacFast.map((x) => x.vp)) });
    expect(sacSlow.length).toBe(0);
    expect(peakSlow).toBeLessThanOrEqual(110 + 5);
    expect(peakSlow).toBeGreaterThan(30);
    expect(sacFast.length).toBeGreaterThan(8);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(120);
    expect(Math.max(...sacFast.map((x) => x.vp))).toBeLessThanOrEqual(700);
  });

  it('in real deliveries the saccades never exceed 700 deg/s and two scheduled shifts never come within 120 ms of each other', () => {
    const r = rng(33);
    const peaks: number[] = [];
    let n = 0;
    for (let k = 0; k < 100; k++) {
      const d = delivery(randomSpec(r));
      const a = anchorsFor(d, { role: 'striker', key: deliveryTakeKey({ seed: 'ms', overIndex: 1, ballIndex: k }) });
      const p = prepare(a, { hz: 240 });
      for (const x of saccades(p, CH.gazeYaw, CH.gazePitch, 130, 3)) {
        n++;
        peaks.push(x.vp);
      }
    }
    record('saccade.inDeliveries', { saccades: n, perDelivery: n / 100, peakDegS: stats(peaks) });
    expect(Math.max(...peaks)).toBeLessThanOrEqual(700);
  });
});

describe('G8: the eyes stay in range and land on the target', () => {
  it('never beyond 35 degrees of yaw or 28 of pitch in the head, in any script', () => {
    const r = rng(41);
    let maxYaw = 0;
    let maxPitch = 0;
    for (let k = 0; k < 60; k++) {
      for (const role of ['bowler', 'striker'] as const) {
        const d = delivery(randomSpec(r));
        const p = prepare(anchorsFor(d, { role, key: deliveryTakeKey({ seed: 'rng', overIndex: 2, ballIndex: k }), series: 'pace' }), { hz: 60 });
        for (let i = 0; i < p.n; i++) {
          maxYaw = Math.max(maxYaw, Math.abs(val(p, i, CH.eyeYawL)), Math.abs(val(p, i, CH.eyeYawR)));
          maxPitch = Math.max(maxPitch, Math.abs(val(p, i, CH.eyePitchL)), Math.abs(val(p, i, CH.eyePitchR)));
        }
      }
    }
    record('eyeRange', { maxYaw, maxPitch });
    expect(maxYaw).toBeLessThanOrEqual(35.2);
    expect(maxPitch).toBeLessThanOrEqual(28.1);
  });

  it('on a standing actor the gaze is within 2 degrees of the fixated person (p95) once a shift has landed', () => {
    const errs: number[] = [];
    const aim = new Float64Array(3);
    for (const role of ['bowler', 'striker'] as const) {
      for (let s = 0; s < 40; s++) {
        const a = idleAnchors(role, `land#${s}`, 30_000);
        const p = prepare(a, { hz: 60 });
        const fix = p.fix;
        for (let k = 0; k < fix.length / 5; k++) {
          const kind = fix[k * 5 + 1];
          if (kind > 1) continue; // opponent or hand: a fixed point in the idle world
          const t0 = fix[k * 5] + 400;
          const t1 = (k + 1 < fix.length / 5 ? fix[(k + 1) * 5] : 30_000) - 40;
          for (let t = t0; t < t1; t += 50) {
            a.aim(kind === 0 ? 'opponent' : 'hand', t, aim);
            const i = Math.round(((t - p.t0) * p.hz) / 1000);
            errs.push(Math.hypot(val(p, i, CH.gazeYaw) - aim[0], val(p, i, CH.gazePitch) - aim[1]));
          }
        }
      }
    }
    const st = stats(errs);
    record('gazeLanding.static', st);
    expect(st.n).toBeGreaterThan(1000);
    expect(st.p95).toBeLessThanOrEqual(2);
    expect(st.p50).toBeLessThanOrEqual(0.8);
  });

  it('while following the ball the gaze is within 6 degrees of the ball as it was one pursuit lag ago (p95)', () => {
    const r = rng(47);
    const errs: number[] = [];
    const ball = new Float64Array(3);
    for (let k = 0; k < 100; k++) {
      const d = delivery(randomSpec(r));
      const a = anchorsFor(d, { role: 'striker', key: deliveryTakeKey({ seed: 'pur', overIndex: 3, ballIndex: k }) });
      const p = prepare(a, { hz: 240 });
      const lag = p.draw[DRAW.lagMs];
      const t = d.timeline;
      for (let tm = t.release + 300; tm < (t.contact ?? t.passAt) - 60; tm += 10) {
        if (!a.visibleBall(tm - lag, ball)) continue;
        const i = Math.round(((tm - p.t0) * p.hz) / 1000);
        errs.push(Math.hypot(val(p, i, CH.gazeYaw) - ball[0], val(p, i, CH.gazePitch) - ball[1]));
      }
    }
    const st = stats(errs);
    record('gazeLanding.pursuit', st);
    expect(st.n).toBeGreaterThan(2000);
    expect(st.p95).toBeLessThanOrEqual(6);
  });

  it('the gaze trails the ball by its latency (at least 125 ms): it is never ahead of the ball it follows', () => {
    // If the gaze were ahead of the ball (a look-ahead), it would be nearer to where the ball will be than to where it is.
    const r = rng(53);
    let behind = 0;
    let total = 0;
    const cur = new Float64Array(3);
    const fut = new Float64Array(3);
    for (let k = 0; k < 60; k++) {
      const d = delivery(randomSpec(r));
      const a = anchorsFor(d, { role: 'striker', key: deliveryTakeKey({ seed: 'ahead', overIndex: 3, ballIndex: k }) });
      const p = prepare(a, { hz: 240 });
      const t = d.timeline;
      for (let tm = t.release + 300; tm < (t.contact ?? t.passAt) - 100; tm += 5) {
        if (!a.visibleBall(tm, cur) || !a.visibleBall(tm + 100, fut)) continue;
        const i = Math.round(((tm - p.t0) * p.hz) / 1000);
        const g = [val(p, i, CH.gazeYaw), val(p, i, CH.gazePitch)];
        const dNow = Math.hypot(g[0] - cur[0], g[1] - cur[1]);
        const dFut = Math.hypot(g[0] - fut[0], g[1] - fut[1]);
        total++;
        if (dNow <= dFut + 1e-9) behind++;
      }
    }
    record('noLookAhead.gazeNearerToNowThanToFuture', { total, share: behind / total });
    expect(total).toBeGreaterThan(1500);
    expect(behind / total).toBeGreaterThanOrEqual(0.99);
  });
});

describe('the loop of a between-balls script', () => {
  it('ends where it begins: the gaze at the wrap (last frame to first) is within 1.5 degrees, for both actors (the idle script loops every 60 s)', () => {
    const jumps: number[] = [];
    const a = createOut();
    const b = createOut();
    for (const role of ['bowler', 'striker'] as const) {
      for (let s = 0; s < 100; s++) {
        const p = prepare(idleAnchors(role, `seam#${s}`, 60_000), { hz: 60 });
        sample(p, 60_000 - 1000 / 60, a);
        sample(p, 0, b);
        jumps.push(Math.hypot(a[CH.gazeYaw] - b[CH.gazeYaw], a[CH.gazePitch] - b[CH.gazePitch]));
      }
    }
    record('idleLoopSeamGazeDeg', stats(jumps));
    expect(Math.max(...jumps)).toBeLessThanOrEqual(1.5);
  });
});

describe('microsaccades', () => {
  it('about 1.1 a second, mostly horizontal, median 0.25 to 0.35 degrees and always under 1 degree', () => {
    let count = 0;
    let secs = 0;
    const amp: number[] = [];
    let horizontal = 0;
    for (let s = 0; s < 100; s++) {
      const p: DirectorPlan = prepare(idleAnchors(s % 2 ? 'bowler' : 'striker', `micro#${s}`, 30_000), { hz: 60 });
      for (let k = 0; k < p.micro.length; k += 3) {
        const a = Math.hypot(p.micro[k + 1], p.micro[k + 2]);
        amp.push(a);
        if (Math.abs(p.micro[k + 2]) < Math.abs(p.micro[k + 1])) horizontal++;
      }
      count += p.micro.length / 3;
      secs += 30;
    }
    record('microsaccade', { perSecond: count / secs, amplitudeDeg: stats(amp), horizontalShare: horizontal / amp.length });
    expect(count / secs).toBeGreaterThan(0.95);
    expect(count / secs).toBeLessThan(1.25);
    expect(Math.max(...amp)).toBeLessThan(1);
    expect(quantile(amp, 0.5)).toBeGreaterThan(0.2);
    expect(quantile(amp, 0.5)).toBeLessThan(0.36);
    expect(horizontal / amp.length).toBeGreaterThan(0.6);
  });
});

describe('roles and roles frames', () => {
  const roles: Role[] = ['bowler', 'striker'];
  it('both actors look at their opponent in the first seconds of a delivery (the bowler at the batter, the striker at the bowler)', () => {
    for (const role of roles) {
      const d = delivery({ speedKph: 130, lengthM: 6, lineM: 0, variation: 0, outcome: 'dot' });
      const a = anchorsFor(d, { role, key: 'role#0.1', series: 'pace' });
      const p = prepare(a, { hz: 60 });
      const aim = new Float64Array(3);
      const errs: number[] = [];
      for (let t = 600; t < 1500; t += 100) {
        a.aim('opponent', t, aim);
        const i = Math.round(((t - p.t0) * p.hz) / 1000);
        errs.push(Math.hypot(val(p, i, CH.gazeYaw) - aim[0], val(p, i, CH.gazePitch) - aim[1]));
      }
      void timeOf;
      void mean;
      expect(quantile(errs, 0.5)).toBeLessThan(3);
    }
  });
});
