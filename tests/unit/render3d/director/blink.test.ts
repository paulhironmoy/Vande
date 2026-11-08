// @vitest-environment node
/// <reference types="node" />
/**
 * Gates on the lids (FACE-1 G1 to G5, unified spec "Blink"): rate, spread of the intervals, shape, left-right skew,
 * none while the actor's eyes are busy with the ball, a cluster just after it, and a blink on some large gaze shifts.
 * Reason: today's blink is a metronome (exactly 4.3 s, 175 ms, wall clock); a metronome is the face's loudest tell.
 * All measured on 240 Hz bakes of the same plans, so that a 70 ms closing is not under-sampled.
 */
import { describe, expect, it, vi } from 'vitest';
import { CH, deliveryTakeKey, prepare, type Role } from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, randomSpec, rng } from './world';
import { blinkEvents, cvOf, frameOf, intervals, record, recordFile, saccades, stats, timeOf } from './gates';

recordFile('blink');

// Heavy measurement runs: a slow CI runner gets a generous timeout (the config default is 30 s).
vi.setConfig({ testTimeout: 120_000 });

const ROLES: Role[] = ['bowler', 'striker'];

/** Measurements over 200 standing 30 s traces of one actor (computed once, on first use). */
const idleCache = new Map<Role, ReturnType<typeof measureIdle>>();
function measureIdle(role: Role) {
  const counts: number[] = [];
  const whole: number[] = [];
  const closing: number[] = [];
  const ratio: number[] = [];
  const skew: number[] = [];
  const single: number[] = [];
  const pooled: number[] = [];
  const all: number[] = [];
  let batch: number[] = [];
  for (let s = 0; s < 200; s++) {
    const a = idleAnchors(role, `idle#${s}`, 30_000, { person: `look-${s % 7}` });
    const p = prepare(a, { hz: 240 });
    const ev = blinkEvents(p, CH.blinkL);
    const evR = blinkEvents(p, CH.blinkR);
    counts.push(ev.length);
    // The edges of a blink cut off by the end of the script are not blinks to measure.
    for (const e of ev.filter((x) => x.on > 100 && x.off < 29_900)) {
      whole.push(e.duration);
      closing.push(e.closeMs);
      ratio.push(e.openMs / e.closeMs);
    }
    for (const e of ev) {
      const m = evR.reduce((b, x) => (Math.abs(x.on - e.on) < Math.abs(b.on - e.on) ? x : b), evR[0]);
      if (m && Math.abs(m.on - e.on) < 100) skew.push(Math.abs(m.on - e.on));
    }
    const iv = intervals(ev);
    if (iv.length > 2) single.push(cvOf(iv));
    batch.push(...iv);
    all.push(...iv);
    if ((s + 1) % 5 === 0) {
      pooled.push(cvOf(batch));
      batch = [];
    }
  }
  return { counts, whole, closing, ratio, skew, single, pooled, all };
}
const idle = (role: Role) => {
  if (!idleCache.has(role)) idleCache.set(role, measureIdle(role));
  return idleCache.get(role)!;
};

describe('G1 to G4: a standing actor blinks like a person, not a clock', () => {
  for (const role of ROLES) {
    it(`${role}: G1 blinks per 30 s stand between 4 and 11 (8 to 22 per minute) for 90% of traces`, () => {
      const st = stats(idle(role).counts);
      record(`${role}.blinksPer30s`, st);
      expect(st.p5).toBeGreaterThanOrEqual(4);
      expect(st.p95).toBeLessThanOrEqual(11.5);
      expect(st.p50).toBeGreaterThanOrEqual(5);
      expect(st.p50).toBeLessThanOrEqual(10);
    });

    it(`${role}: G2 the intervals spread (coefficient of variation pooled over at least 20 intervals is 0.30 or more; a metronome is 0)`, () => {
      const { pooled, single, all } = idle(role);
      const st = stats(pooled);
      record(`${role}.intervalCvPooled5`, st);
      record(`${role}.intervalCvSingle`, stats(single));
      record(`${role}.intervalSeconds`, stats(all));
      expect(st.min).toBeGreaterThanOrEqual(0.3);
      expect(st.max).toBeLessThanOrEqual(0.9);
      expect(stats(single).p5).toBeGreaterThanOrEqual(0.15);
      expect(stats(all).max).toBeLessThan(20);
      // MOTION-1 G11: the mean interval of a person at rest is 3.0 to 4.6 s
      expect(stats(all).mean).toBeGreaterThanOrEqual(3.0);
      expect(stats(all).mean).toBeLessThanOrEqual(4.6);
    });

    it(`${role}: G3 every blink is 200 to 450 ms whole, closes in 60 to 130 ms and opens at least 1.6 times slower`, () => {
      const { whole, closing, ratio } = idle(role);
      record(`${role}.wholeMs`, stats(whole));
      record(`${role}.closingMs`, stats(closing));
      record(`${role}.openOverClose`, stats(ratio));
      expect(whole.length).toBeGreaterThan(1000);
      expect(Math.min(...whole)).toBeGreaterThanOrEqual(200);
      expect(Math.max(...whole)).toBeLessThanOrEqual(450);
      expect(Math.min(...closing)).toBeGreaterThanOrEqual(60);
      expect(Math.max(...closing)).toBeLessThanOrEqual(130);
      expect(Math.min(...ratio)).toBeGreaterThanOrEqual(1.6);
    });

    it(`${role}: G4 the two eyes start within 30 ms of each other`, () => {
      const { skew } = idle(role);
      record(`${role}.leftRightSkewMs`, stats(skew));
      expect(Math.max(...skew)).toBeLessThanOrEqual(30);
      expect(stats(skew).p50).toBeGreaterThan(0); // a bilateral reflex is not frame-exact
    });
  }

  it('the metronome it replaces fails the same gates (the tool tells them apart)', () => {
    // players.ts:941: closure from fract(t / 4300 + phase), 54 ms closing, 175 ms whole, exactly 4.3 s apart.
    const sstep = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const blinkAt = (t: number, phase: number) => {
      const bt = (t / 4300 + phase) % 1;
      return sstep(0, 0.014, bt) * (1 - sstep(0.026, 0.045, bt));
    };
    const dt = 1000 / 240;
    const on: number[] = [];
    let prev = 0;
    for (let i = 0; i <= 30_000 / dt; i++) {
      const v = blinkAt(i * dt, 0.2);
      if (prev < 0.5 && v >= 0.5) on.push(i * dt);
      prev = v;
    }
    const iv = on.slice(1).map((v, i) => (v - on[i]) / 1000);
    record('metronome.intervalCv', cvOf(iv));
    expect(cvOf(iv)).toBeLessThan(0.01);
  });
});

describe('G5: no blink while the eyes are on the ball, and a cluster just after', () => {
  for (const role of ROLES) {
    it(`${role}: 0 blinks overlap the task window in 600 varied deliveries; blinks cluster in the 100 to 620 ms after it`, () => {
      const r = rng(7);
      let inWindow = 0;
      let blinks = 0;
      let bunch = 0;
      let baseline = 0;
      const n = 600;
      for (let k = 0; k < n; k++) {
        const d = delivery(randomSpec(r));
        const a = anchorsFor(d, {
          role,
          key: deliveryTakeKey({ seed: 'g5', overIndex: Math.floor(k / 6), ballIndex: k % 6 }),
          person: `look-${k % 5}`,
          series: 'pace',
        });
        const t = d.timeline;
        const win =
          role === 'bowler' ? [t.gather - 120, t.release + 150] : [t.release - 150, (t.contact ?? t.passAt) + 150];
        const ev = blinkEvents(prepare(a, { hz: 240 }), CH.blinkL, 0.05);
        for (const e of ev) {
          blinks++;
          if (e.off > win[0] && e.on < win[1]) inWindow++;
        }
        if (ev.some((e) => e.on >= win[1] + 100 && e.on <= win[1] + 620)) bunch++;
        if (ev.some((e) => e.on >= win[1] + 3100 && e.on <= win[1] + 3620)) baseline++;
      }
      record(`${role}.window`, {
        deliveries: n,
        blinks,
        blinksInWindow: inWindow,
        afterWindowShare: bunch / n,
        sameSpanLaterShare: baseline / n,
      });
      expect(inWindow).toBe(0);
      expect(bunch / n).toBeGreaterThanOrEqual(0.3);
      expect(bunch).toBeGreaterThanOrEqual(2 * baseline);
    });
  }
});

describe('blinks ride on large gaze shifts', () => {
  it('about a third of the 15 degree or larger gaze shifts of a standing actor carry a blink, several times the chance rate', () => {
    let shifts = 0;
    let carry = 0;
    let span = 0;
    let anyBlink = 0;
    for (let s = 0; s < 120; s++) {
      const p = prepare(idleAnchors('striker', `shift#${s}`, 30_000), { hz: 240 });
      const ev = blinkEvents(p, CH.blinkL);
      for (const sc of saccades(p, CH.gazeYaw, CH.gazePitch, 130, 15)) {
        shifts++;
        if (ev.some((e) => e.on >= sc.t - 60 && e.on <= sc.t + 200)) carry++;
      }
      // chance rate: the share of 260 ms windows that contain a blink onset
      for (let t = 1000; t < 29_000; t += 260) {
        span++;
        if (ev.some((e) => e.on >= t && e.on < t + 260)) anyBlink++;
      }
      void frameOf;
      void timeOf;
    }
    record('shiftBlink', { shifts, carry, share: carry / shifts, chance: anyBlink / span });
    expect(shifts).toBeGreaterThan(100);
    expect(carry / shifts).toBeGreaterThanOrEqual(0.25);
    expect(carry / shifts).toBeGreaterThanOrEqual(2 * (anyBlink / span));
  });
});
