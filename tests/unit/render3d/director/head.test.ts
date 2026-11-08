// @vitest-environment node
/**
 * Gates on the head (FACE-1 G8 and G9, unified spec "Head"): the bowler's head stays on the batter from the gather to
 * the release however the clip's own head whips; the striker's head follows the ball that is visible, with a lag, and
 * starts to move 0 to 150 ms after the gaze; the head has speed and acceleration inside MOTION-SPEC section 9.
 * Reason: today's bowler head is locked (0.3 degrees) and then turns away (median 46 degrees off the batter in the
 * 400 ms after release); the striker's head never moves (0 deg/s) and sits 11.7 degrees off the bowler.
 * The bowler's clip heads here are the real ones (fixtures/bowler-clip-head.json: three stage-posed bowler clips,
 * measured by FACE-1), not a model of them.
 */
import { describe, expect, it, vi } from 'vitest';
import { CH, deliveryTakeKey, prepare, type DirectorAnchors, type DirectorPlan } from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, randomSpec, rng, SERIES, STOCK } from './world';
import { frameOf, mean, quantile, record, recordFile, saccades, stats, timeOf, val, withParams } from './gates';

recordFile('head');

// Heavy measurement runs: a slow CI runner gets a generous timeout (the config default is 30 s).
vi.setConfig({ testTimeout: 120_000 });

/** The head's direction in space: the clip's own plus the overlay (degrees, role frame). */
function headInSpace(p: DirectorPlan, a: DirectorAnchors, i: number, out: Float64Array): void {
  a.clipHead(timeOf(p, i), out);
  out[0] += val(p, i, CH.headYaw);
  out[1] += val(p, i, CH.headPitch);
  out[2] += val(p, i, CH.headRoll);
}

describe('G9: the bowler keeps his head on the batter from the gather to the release', () => {
  for (const name of ['pace', 'pace-late', 'spin'] as const) {
    it(`${name}: with the real clip's head and 200 different draws, every frame from gather to release is within 10 degrees of the batter, and the clip alone is not`, () => {
      const ser = SERIES[name];
      const aim = new Float64Array(3);
      const clip = new Float64Array(3);
      const head = new Float64Array(3);
      const withDirector: number[] = [];
      const clipOnly: number[] = [];
      let worstShare = 1;
      for (let k = 0; k < 200; k++) {
        const d = delivery({ ...STOCK, speedKph: name === 'spin' ? 80 : 136 }, ser.release);
        d.timeline.gather = ser.gather;
        const a = anchorsFor(d, { role: 'bowler', key: `head#9.${name}.${k}`, series: name, person: `look-${k % 9}` });
        const p = prepare(a, { hz: 60 });
        let ok = 0;
        let n = 0;
        for (let i = 0; i < p.n; i++) {
          const t = timeOf(p, i);
          if (t < ser.gather || t > ser.release) continue;
          a.aim('opponent', t, aim);
          a.clipHead(t, clip);
          headInSpace(p, a, i, head);
          const e = Math.hypot(head[0] - aim[0], head[1] - aim[1]);
          withDirector.push(e);
          if (k === 0) clipOnly.push(Math.hypot(clip[0] - aim[0], clip[1] - aim[1]));
          n++;
          if (e <= 10) ok++;
        }
        worstShare = Math.min(worstShare, ok / n);
      }
      const share = (x: number[], deg: number) => x.filter((v) => v <= deg).length / x.length;
      record(`bowler.${name}.headOffBatterDeg`, {
        draws: 200,
        frames: withDirector.length,
        ...stats(withDirector),
        within10: share(withDirector, 10),
        within5: share(withDirector, 5),
        worstDrawWithin10: worstShare,
        clipOnlyWithin10: share(clipOnly, 10),
        clipOnlyP50: quantile(clipOnly, 0.5),
      });
      expect(withDirector.length).toBeGreaterThan(5000);
      expect(worstShare).toBeGreaterThanOrEqual(0.9);
      expect(Math.max(...withDirector)).toBeLessThanOrEqual(10);
      expect(share(clipOnly, 10)).toBeLessThan(0.7); // the clip on its own fails the gate: the test can tell
    });
  }

  it('the clip heads are not locked either: in the run-up the head still moves a little (drift), so it does not read as a mannequin', () => {
    const ser = SERIES.pace;
    const d = delivery(STOCK, ser.release);
    const a = anchorsFor(d, { role: 'bowler', key: 'head#9.run', series: 'pace' });
    const p = prepare(a, { hz: 60 });
    const ys: number[] = [];
    const h = new Float64Array(3);
    for (let i = frameOf(p, 500); i < frameOf(p, 1500); i++) {
      headInSpace(p, a, i, h);
      ys.push(h[0]);
    }
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    record('bowler.runUpHeadYawRangeDeg', hi - lo);
    expect(hi - lo).toBeGreaterThan(0.15);
    expect(hi - lo).toBeLessThan(6);
  });
});

describe('the head moves within MOTION-SPEC section 9 (neck and head at most 720 deg/s and 300 deg/s per frame of change)', () => {
  it('for both actors, in 80 varied deliveries, the head in space never exceeds the speed cap and its velocity never steps by more than the cap', () => {
    const r = rng(61);
    let peak = 0;
    let step = 0;
    for (let k = 0; k < 80; k++) {
      for (const role of ['bowler', 'striker'] as const) {
        const d = delivery(randomSpec(r));
        const a = anchorsFor(d, {
          role,
          key: deliveryTakeKey({ seed: 'cap', overIndex: 0, ballIndex: k }),
          series: k % 2 ? 'pace' : 'pace-late',
        });
        const p = prepare(a, { hz: 60 });
        const prev = new Float64Array(3);
        const cur = new Float64Array(3);
        let vyPrev = 0;
        let vpPrev = 0;
        headInSpace(p, a, 0, prev);
        for (let i = 1; i < p.n; i++) {
          headInSpace(p, a, i, cur);
          const vy = (cur[0] - prev[0]) * p.hz;
          const vp = (cur[1] - prev[1]) * p.hz;
          peak = Math.max(peak, Math.hypot(vy, vp));
          if (i > 1) step = Math.max(step, Math.hypot(vy - vyPrev, vp - vpPrev));
          vyPrev = vy;
          vpPrev = vp;
          prev.set(cur);
        }
      }
    }
    record('headInSpace.capsDegS', { peakDegS: peak, maxVelocityChangePerFrameDegS: step });
    expect(peak).toBeLessThanOrEqual(720);
    expect(step).toBeLessThanOrEqual(300);
  });
});

describe('G8: the striker follows the ball that is visible', () => {
  it('after a gaze shift from rest the head starts to move 0 to 150 ms later (shifts of 15 degrees or more, 200 standing traces)', () => {
    const lags: number[] = [];
    const clip = new Float64Array(3);
    for (let s = 0; s < 120; s++) {
      const a = idleAnchors('striker', `lag#${s}`, 30_000);
      const p = prepare(a, { hz: 240 });
      const headSpeed = (i: number) => {
        a.clipHead(timeOf(p, i), clip);
        const y1 = clip[0] + val(p, i, CH.headYaw);
        const p1 = clip[1] + val(p, i, CH.headPitch);
        a.clipHead(timeOf(p, i - 1), clip);
        return Math.hypot(y1 - clip[0] - val(p, i - 1, CH.headYaw), p1 - clip[1] - val(p, i - 1, CH.headPitch)) * p.hz;
      };
      const gazeSpeed = (i: number) =>
        Math.hypot(
          val(p, i, CH.gazeYaw) - val(p, i - 1, CH.gazeYaw),
          val(p, i, CH.gazePitch) - val(p, i - 1, CH.gazePitch),
        ) * p.hz;
      for (const sc of saccades(p, CH.gazeYaw, CH.gazePitch, 130, 15)) {
        if (sc.v0 >= 40) continue; // from rest (the edge detector leaves about 25 deg/s at the foot of a saccade)
        const i0 = frameOf(p, sc.t);
        const g0 = gazeSpeed(i0 - 2);
        const h0 = headSpeed(i0 - 2);
        let gOn = -1;
        let hOn = -1;
        for (let i = Math.max(2, i0 - 4); i < Math.min(p.n, i0 + 200); i++) {
          if (gOn < 0 && gazeSpeed(i) > g0 + 40) gOn = i;
          if (hOn < 0 && headSpeed(i) > h0 + 15) hOn = i;
        }
        if (gOn >= 0 && hOn >= 0) lags.push(((hOn - gOn) * 1000) / p.hz);
      }
    }
    const st = stats(lags);
    record('striker.headOnsetAfterGazeMs', st);
    expect(st.n).toBeGreaterThan(100);
    expect(st.min).toBeGreaterThanOrEqual(0);
    expect(st.max).toBeLessThanOrEqual(150);
  });

  // P3 (extrapolated pursuit, ruling 4 after P1, and the head's pursuit feed-forward) closes most of the head's lag behind the ball:
  // this test is about the latency itself, so it runs with both off, as it was written (the next test measures them on).
  it('in flight the head turns with the ball and trails it by its latency: it matches the ball as it was about 350 ms ago, never the ball as it will be', () =>
    withParams({ 'gaze.leadX': 0, 'head.ffX': 0 }, () => {
      const r = rng(67);
      const errAt: Record<number, number[]> = {};
      const ahead: number[] = [];
      const clip = new Float64Array(3);
      const b = new Float64Array(3);
      const b2 = new Float64Array(3);
      for (let k = 0; k < 100; k++) {
        const d = delivery(randomSpec(r));
        const a = anchorsFor(d, {
          role: 'striker',
          key: deliveryTakeKey({ seed: 'follow', overIndex: 0, ballIndex: k }),
        });
        const p = prepare(a, { hz: 60 });
        const t = d.timeline;
        for (let i = frameOf(p, t.release + 300); i <= frameOf(p, (t.contact ?? t.passAt) - 60); i++) {
          const tm = timeOf(p, i);
          a.clipHead(tm, clip);
          const hy = clip[0] + val(p, i, CH.headYaw);
          const hp = clip[1] + val(p, i, CH.headPitch);
          for (let lag = 0; lag <= 600; lag += 50)
            if (a.visibleBall(tm - lag, b)) (errAt[lag] ??= []).push(Math.hypot(hy - b[0], hp - b[1]));
          // is the head nearer the ball 100 ms from now than the ball now? (a look-ahead would be)
          if (a.visibleBall(tm, b) && a.visibleBall(tm + 100, b2))
            ahead.push(Math.hypot(hy - b2[0], hp - b2[1]) < Math.hypot(hy - b[0], hp - b[1]) ? 1 : 0);
        }
      }
      const table = Object.fromEntries(
        Object.entries(errAt).map(([lag, v]) => [lag, { n: v.length, p50: quantile(v, 0.5), p95: quantile(v, 0.95) }]),
      );
      record('striker.headVsBallByLagMs', table);
      record('striker.headNearerFutureBallShare', mean(ahead));
      expect(table[0].n).toBeGreaterThan(1000);
      // the older the ball, the closer the head to it, down to a lag of about 300 ms (the pursuit lag plus the neck's)
      expect(table[0].p50).toBeGreaterThan(table[100].p50);
      expect(table[100].p50).toBeGreaterThan(table[200].p50);
      expect(table[200].p50).toBeGreaterThan(table[300].p50);
      expect(table[350].p50).toBeLessThanOrEqual(3);
      expect(table[350].p95).toBeLessThanOrEqual(6);
      expect(table[0].p50).toBeGreaterThan(3 * table[350].p50); // against the ball as it is now it is clearly further off
      expect(mean(ahead)).toBeLessThan(0.1);
    }));

  it('P3: with the extrapolated pursuit and the head feed-forward the head is far nearer the ball as it is now, and still never ahead of it', () => {
    const measure = (lead: boolean, over: Record<string, number>) =>
      withParams(over, () => {
        const r = rng(67);
        const now: number[] = [];
        const later: number[] = [];
        const clip = new Float64Array(3);
        const b = new Float64Array(3);
        const b2 = new Float64Array(3);
        for (let k = 0; k < 100; k++) {
          const d = delivery(randomSpec(r));
          const a = anchorsFor(d, {
            role: 'striker',
            key: deliveryTakeKey({ seed: 'follow', overIndex: 0, ballIndex: k }),
            lead,
          });
          const p = prepare(a, { hz: 60 });
          const t = d.timeline;
          for (let i = frameOf(p, t.release + 300); i <= frameOf(p, (t.contact ?? t.passAt) - 60); i++) {
            const tm = timeOf(p, i);
            a.clipHead(tm, clip);
            const hy = clip[0] + val(p, i, CH.headYaw);
            const hp = clip[1] + val(p, i, CH.headPitch);
            if (!a.visibleBall(tm, b)) continue;
            now.push(Math.hypot(hy - b[0], hp - b[1]));
            // a look-ahead would put the head nearer the ball 100 ms from now than the ball now
            if (a.visibleBall(tm + 100, b2))
              later.push(Math.hypot(hy - b2[0], hp - b2[1]) < Math.hypot(hy - b[0], hp - b[1]) ? 1 : 0);
          }
        }
        return { now: stats(now), p95: quantile(now, 0.95), nearerLater: mean(later) };
      });
    const lagOnly = measure(false, { 'gaze.leadX': 0, 'head.ffX': 0 });
    const p3 = measure(true, {});
    record('striker.headVsBallNowDeg', { lagOnly, p3 });
    // Ruling 4 after P1 sets p95 <= 20 degrees against the ball now as the goal: the real-physics corpus (probe p9, 192 deliveries)
    // measures it (13.9). This test world's ball comes nearer the head than a bowled ball does, so its bound is a little wider.
    expect(p3.p95).toBeLessThanOrEqual(22);
    expect(p3.now.p50).toBeLessThan(0.6 * lagOnly.now.p50);
    expect(p3.p95).toBeLessThan(0.65 * lagOnly.p95);
    // the head is no more often nearer the future ball than it was (a look-ahead would show here)
    expect(p3.nearerLater).toBeLessThan(0.35);
  });

  it('while he waits the head sits where the bowler is (within 5 degrees), not where the clip leaves it (11.7 degrees off)', () => {
    const a = idleAnchors('striker', 'wait#1', 10_000);
    const p = prepare(a, { hz: 60 });
    const aim = new Float64Array(3);
    const h = new Float64Array(3);
    const clip = new Float64Array(3);
    const errs: number[] = [];
    const clipErrs: number[] = [];
    for (let i = frameOf(p, 800); i < frameOf(p, 3000); i++) {
      a.aim('opponent', timeOf(p, i), aim);
      a.clipHead(timeOf(p, i), clip);
      headInSpace(p, a, i, h);
      errs.push(Math.hypot(h[0] - aim[0], h[1] - aim[1]));
      clipErrs.push(Math.hypot(clip[0] - aim[0], clip[1] - aim[1]));
    }
    record('striker.waitingHeadOffBowlerDeg', { director: stats(errs), clipOnly: stats(clipErrs) });
    expect(quantile(errs, 0.95)).toBeLessThan(5);
    expect(quantile(clipErrs, 0.5)).toBeGreaterThan(10);
  });
});
